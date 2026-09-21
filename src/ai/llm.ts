import type { ChatCompletionTool } from "../types";
import log from "../logger";
import { authHeaders, resolveLlmAuth, type LlmAuth } from "./providers";
import { TransientError, fetchWithTimeout, isTransient, withRetry } from "./retry";

const subLog = log.createSubLogger("Llm");

/**
 * Timeouts are tiered because the calls are not alike. A routing decision is a
 * small prompt answered in a few seconds; a closing write-up is a long one.
 *
 * This matters more than it looks. Observed live in an Extension Development
 * Host: a first decision call stalled and the old flat 120s x 4 retries burned
 * 8 minutes on it, which was long enough for the benchmark harness to abandon
 * the whole task. The same call takes 3-6 seconds from a plain node process, so
 * the stall is environmental and intermittent — which is exactly the case a
 * short timeout and few retries are for. A stuck decision now costs about a
 * minute, and the loop absorbs it as a failed step rather than a lost hunt.
 */
const DECISION_TIMEOUT_MS = 30000;
const DECISION_ATTEMPTS = 2;
const LONG_TIMEOUT_MS = 90000;

export interface LlmToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface LlmResult {
  toolCall: LlmToolCall | null;
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmRequest {
  system: string;
  user: string;
  /** When present, the model must answer with one of these and no prose. */
  tools?: ChatCompletionTool[];
  maxTokens?: number;
  /** Short, retried twice (default) for per-step decisions; long for write-ups. */
  patience?: "decision" | "long";
}

function budget(request: LlmRequest): { timeoutMs: number; attempts: number } {
  return request.patience === "long"
    ? { timeoutMs: LONG_TIMEOUT_MS, attempts: 3 }
    : { timeoutMs: DECISION_TIMEOUT_MS, attempts: DECISION_ATTEMPTS };
}

/**
 * The agent's single door to the generation model.
 *
 * Direct OpenAI uses `/v1/responses`: a reasoning model refuses function tools
 * on `/v1/chat/completions` unless reasoning is switched off entirely, which
 * would defeat the point of choosing one. The gateway route keeps the
 * OpenAI-compatible chat shape and a fallback chain, because a gateway model
 * can be gated or rate-limited out from under you.
 */
export async function callLlm(request: LlmRequest): Promise<LlmResult> {
  const auth = resolveLlmAuth();
  if (!auth.apiKey) {
    throw new Error(
      auth.provider === "openai"
        ? "No OpenAI API key. Set llmDebugger.llmApiKey in Settings, or OPENAI_API_KEY in the environment or api.env."
        : "No gateway API key. Set llmDebugger.llmApiKey, or AI_GATEWAY_API_KEY in the environment or api.env.",
    );
  }
  return auth.provider === "openai" ? callResponses(auth, request) : callChat(auth, request);
}

// --------------------------------------------------------------------------
// Direct OpenAI, /v1/responses
// --------------------------------------------------------------------------

async function callResponses(auth: LlmAuth, request: LlmRequest): Promise<LlmResult> {
  const apiKey = auth.apiKey as string;
  const { timeoutMs, attempts } = budget(request);
  const body: Record<string, unknown> = {
    model: auth.model,
    input: [
      { role: "developer", content: request.system },
      { role: "user", content: request.user },
    ],
    max_output_tokens: request.maxTokens ?? 1200,
  };
  if (auth.reasoningEffort !== "none") body.reasoning = { effort: auth.reasoningEffort };
  if (request.tools?.length) {
    body.tools = request.tools.map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
    body.tool_choice = "required";
  }

  const json = await withRetry(
    async () => {
      const res = await fetchWithTimeout(
        `${auth.baseUrl}/responses`,
        { method: "POST", headers: authHeaders(apiKey), body: JSON.stringify(body) },
        timeoutMs,
      );
      if (!res.ok) {
        const text = await res.text();
        const message = `${res.status} from openai/${auth.model}: ${text.slice(0, 300)}`;
        throw isTransient(res.status) ? new TransientError(message) : new Error(message);
      }
      return (await res.json()) as ResponsesPayload;
    },
    { label: `responses ${auth.model}`, attempts },
  );

  // Reasoning models answer with a list: reasoning items, then the function
  // call or the message. A run that hits its output cap comes back
  // `incomplete` with only the reasoning item, which is a miss, not an answer.
  let toolCall: LlmToolCall | null = null;
  const textParts: string[] = [];
  for (const item of json.output ?? []) {
    if (item.type === "function_call" && item.name) {
      toolCall = { name: item.name, args: parseArgs(item.arguments, auth.model) };
    } else if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (typeof part.text === "string") textParts.push(part.text);
      }
    }
  }
  const text = (json.output_text ?? textParts.join("")).trim();
  if (!toolCall && !text) {
    subLog.warn(`${auth.model} returned nothing usable (status ${json.status})`);
  }
  return {
    toolCall,
    text,
    model: json.model || auth.model,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
}

// --------------------------------------------------------------------------
// Vercel AI Gateway, /v1/chat/completions
// --------------------------------------------------------------------------

async function callChat(auth: LlmAuth, request: LlmRequest): Promise<LlmResult> {
  const apiKey = auth.apiKey as string;
  const { timeoutMs, attempts } = budget(request);
  const candidates = [auth.model, ...auth.fallbackModels].filter(
    (m, i, all) => all.indexOf(m) === i,
  );
  const failures: string[] = [];

  for (const model of candidates) {
    try {
      // Rate limits and 5xx retry against the SAME model first: falling
      // straight through on a 429 would silently change which model ran.
      const json = await withRetry(
        async () => {
          const res = await fetchWithTimeout(
            `${auth.baseUrl}/chat/completions`,
            {
              method: "POST",
              headers: authHeaders(apiKey),
              body: JSON.stringify({
                model,
                messages: [
                  { role: "system", content: request.system },
                  { role: "user", content: request.user },
                ],
                ...(request.tools?.length
                  ? { tools: request.tools, tool_choice: "required" }
                  : {}),
                max_tokens: request.maxTokens ?? 1200,
              }),
            },
            timeoutMs,
          );
          if (!res.ok) {
            const text = await res.text();
            const message = `${res.status} for ${model}: ${text.slice(0, 300)}`;
            throw isTransient(res.status) ? new TransientError(message) : new Error(message);
          }
          return (await res.json()) as ChatPayload;
        },
        { label: `chat ${model}`, attempts },
      );

      const message = json.choices?.[0]?.message;
      const call = message?.tool_calls?.[0];
      const text = (message?.content || "").trim();
      // With `tool_choice: "required"` an empty `content` is normal — the answer
      // is in tool_calls. Only a reply with neither is a miss.
      if (!call && !text) {
        failures.push(`${model}: neither content nor tool calls`);
        continue;
      }
      return {
        toolCall: call
          ? { name: call.function.name, args: parseArgs(call.function.arguments, model) }
          : null,
        text,
        model,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      failures.push(String(err).replace(/^Error:\s*/, "").slice(0, 200));
      subLog.warn(`gateway call failed for ${model}: ${String(err).slice(0, 200)}`);
    }
  }
  throw new Error(`LLM call failed on every candidate — ${failures.join(" | ")}`);
}

function parseArgs(raw: string | undefined, model: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    subLog.warn(`unparseable tool arguments from ${model}: ${(raw || "").slice(0, 200)}`);
    return {};
  }
}

interface ResponsesPayload {
  model?: string;
  status?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    name?: string;
    arguments?: string;
    content?: Array<{ text?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface ChatPayload {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{ function: { name: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
