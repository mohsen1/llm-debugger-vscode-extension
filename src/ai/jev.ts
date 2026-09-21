import log from "../logger";
import { authHeaders, resolveJevAuth } from "./providers";
import { TransientError, fetchWithTimeout, isTransient, withRetry } from "./retry";

const subLog = log.createSubLogger("Jev");

/**
 * Client for TypeSafe's Jev — a System One model, not a generative one. You post
 * `state` plus typed `questions` and get typed probabilistic answers back, every
 * question evaluated in parallel in one request. That is what makes it worth
 * routing high-volume decisions through.
 *
 * Two routes, two dialects, both verified live 2026-09-21:
 *
 *                   direct (api.typesafe.ai)   gateway (ai-gateway.vercel.sh)
 *   path            POST /v1/systemone         POST /v1/evaluate
 *   model           jev-latest                 typesafe-ai/jev
 *   yes/no type     "noul"                     "boolean"
 *   question text   "instructions"             "question"
 *   yes/no answer   { noul: 0.62 }             { probability: 0.62 }
 *   usage           { input_tokens }           { inputTokens }
 *
 * Callers write their questions once, in the neutral shape below.
 *
 * There is deliberately no offline heuristic fallback: a local guess would be
 * indistinguishable from a real Jev answer in the benchmark numbers, so an
 * unreachable Jev fails loudly instead.
 */

export interface JevBooleanQuestion {
  type: "boolean";
  question: string;
  criteria?: { true: string; false: string };
}

export interface JevChoiceQuestion {
  type: "choice";
  question: string;
  choices: string[];
  /** One sentence per choice; required by both routes. */
  criteria: Record<string, string>;
}

export interface JevScoreQuestion {
  type: "score";
  question: string;
  /** Ordered level descriptions, lowest first (2–10 of them). */
  criteria: string[];
}

export type JevQuestion = JevBooleanQuestion | JevChoiceQuestion | JevScoreQuestion;

export type JevAnswer =
  | { kind: "boolean"; probability: number }
  | { kind: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { kind: "score"; score01: number; confidence: number };

export type JevAnswers = Record<string, JevAnswer | undefined>;

export interface JevResponse {
  answers: JevAnswers;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

const MAX_STATE_CHARS = 24000;
/** Jev answers well under a second warm; 30s is a stall, not slowness. */
const EVALUATE_TIMEOUT_MS = 30000;

export async function evaluateWithJev(
  state: string,
  questions: Record<string, JevQuestion>,
): Promise<JevResponse> {
  const auth = resolveJevAuth();
  const apiKey = auth.apiKey;
  if (!apiKey) {
    throw new Error(
      auth.provider === "typesafe"
        ? "No TypeSafe API key. Set llmDebugger.jevApiKey in Settings, or TYPESAFE_API_KEY in the environment or api.env."
        : "No gateway API key for Jev. Set llmDebugger.jevApiKey, or AI_GATEWAY_API_KEY in the environment or api.env.",
    );
  }
  const direct = auth.provider === "typesafe";
  const url = direct ? `${auth.baseUrl}/systemone` : `${auth.baseUrl}/evaluate`;
  const body = {
    model: auth.model,
    state: state.slice(0, MAX_STATE_CHARS),
    questions: direct ? toDirectQuestions(questions) : toGatewayQuestions(questions),
  };

  const t0 = Date.now();
  const json = await withRetry(
    async () => {
      const res = await fetchWithTimeout(
        url,
        { method: "POST", headers: authHeaders(apiKey), body: JSON.stringify(body) },
        EVALUATE_TIMEOUT_MS,
      );
      if (!res.ok) {
        const text = await res.text();
        const message = `Jev ${res.status} from ${auth.provider}: ${text.slice(0, 300)}`;
        throw isTransient(res.status) ? new TransientError(message) : new Error(message);
      }
      return (await res.json()) as RawJevResponse;
    },
    { label: `jev ${auth.provider}` },
  );

  const latencyMs = Date.now() - t0;
  const answers = normalizeAnswers(json.answers ?? {}, questions);
  subLog.debug(`jev answered ${Object.keys(answers).length} question(s) in ${latencyMs}ms`);
  return {
    answers,
    latencyMs,
    inputTokens: json.usage?.input_tokens ?? json.usage?.inputTokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? json.usage?.outputTokens ?? 0,
    model: json.model || auth.model,
  };
}

function toDirectQuestions(questions: Record<string, JevQuestion>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === "boolean") {
      out[name] = {
        type: "noul",
        instructions: q.question,
        ...(q.criteria ? { criteria: q.criteria } : {}),
      };
    } else if (q.type === "choice") {
      out[name] = { type: "choice", instructions: q.question, criteria: q.criteria };
    } else {
      out[name] = { type: "score", instructions: q.question, criteria: q.criteria };
    }
  }
  return out;
}

function toGatewayQuestions(questions: Record<string, JevQuestion>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === "boolean") {
      out[name] = {
        type: "boolean",
        question: q.question,
        criteria: q.criteria ?? { true: "yes", false: "no" },
      };
    } else if (q.type === "choice") {
      out[name] = {
        type: "choice",
        question: q.question,
        choices: q.choices,
        criteria: q.criteria,
      };
    } else {
      out[name] = {
        type: "score",
        question: q.question,
        min: 0,
        max: q.criteria.length - 1,
        criteria: q.criteria,
      };
    }
  }
  return out;
}

function normalizeAnswers(
  raw: Record<string, RawAnswer>,
  questions: Record<string, JevQuestion>,
): JevAnswers {
  const out: JevAnswers = {};
  for (const [name, answer] of Object.entries(raw)) {
    const asked = questions[name];
    if (!asked || !answer) continue;
    if (asked.type === "boolean") {
      const probability = answer.noul ?? answer.probability;
      if (typeof probability === "number") out[name] = { kind: "boolean", probability };
    } else if (asked.type === "choice") {
      if (typeof answer.choice === "string") {
        out[name] = {
          kind: "choice",
          choice: answer.choice,
          probabilities: answer.probabilities ?? {},
          confidence: answer.confidence ?? 0,
        };
      }
    } else if (typeof answer.score === "number") {
      // The score is a level index on the criteria ladder; normalise to 0..1 so
      // callers need not know how many rungs the question had.
      const top = Math.max(1, asked.criteria.length - 1);
      out[name] = {
        kind: "score",
        score01: Math.min(1, Math.max(0, answer.score / top)),
        confidence: answer.confidence ?? 0,
      };
    }
  }
  return out;
}

/** Narrowing helpers so call sites do not repeat the union check. */
export function booleanProbability(answers: JevAnswers, name: string): number | undefined {
  const answer = answers[name];
  return answer?.kind === "boolean" ? answer.probability : undefined;
}

export function choiceAnswer(
  answers: JevAnswers,
  name: string,
): { choice: string; probabilities: Record<string, number>; confidence: number } | undefined {
  const answer = answers[name];
  return answer?.kind === "choice" ? answer : undefined;
}

interface RawAnswer {
  type?: string;
  noul?: number;
  probability?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  score?: number;
}

interface RawJevResponse {
  model?: string;
  answers?: Record<string, RawAnswer>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}
