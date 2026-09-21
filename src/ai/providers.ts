import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import * as vscode from "vscode";
import log from "../logger";

const subLog = log.createSubLogger("Providers");

/**
 * Where the two brains live.
 *
 * Both can be reached either directly from their vendor or through the Vercel
 * AI Gateway, and the two routes do not speak the same dialect — the direct
 * TypeSafe API calls a boolean question a `noul` and answers `{ noul }`, while
 * the gateway calls it a `boolean` and answers `{ probability }`; direct OpenAI
 * needs `/v1/responses` for a reasoning model with tools, while the gateway
 * speaks `/v1/chat/completions`. Those differences live in `jev.ts` and
 * `llm.ts`. This file only decides route, model and key.
 */

export type LlmProviderId = "openai" | "vercel";
export type JevProviderId = "typesafe" | "vercel";
export type ReasoningEffort = "none" | "low" | "medium" | "high";

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const TYPESAFE_DEFAULT_BASE_URL = "https://api.typesafe.ai/v1";
export const VERCEL_DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1";

export const DEFAULT_LLM_PROVIDER: LlmProviderId = "openai";
export const DEFAULT_LLM_MODEL = "gpt-5.4-nano";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "none";
export const DEFAULT_JEV_PROVIDER: JevProviderId = "typesafe";
export const DEFAULT_JEV_MODEL = "jev-latest";

export const GATEWAY_LLM_MODEL = "deepseek/deepseek-v3.1";
export const GATEWAY_JEV_MODEL = "typesafe-ai/jev";

/**
 * Only used on the gateway route, where a model can be gated or rate-limited.
 * Every entry must support tool calling — every structured answer in the agent
 * comes back as one. Verified live 2026-09-21:
 *
 * - `deepseek/deepseek-v4-flash` — cheapest, but returns NO tool_calls under
 *   `tool_choice: "required"`. Useless here; deliberately absent.
 * - `deepseek/deepseek-v4-pro` — 403 on a free-tier key, so as a candidate it
 *   never succeeds and its error masks whatever really failed. Also absent.
 * - `moonshotai/kimi-k2` — tool calls work, but rate-limited 3 of 8 back to
 *   back. Absent for that reason.
 */
export const GATEWAY_LLM_FALLBACKS = [
  "openai/gpt-4o-mini",
  "alibaba/qwen3-next-80b-a3b-instruct",
];

export interface LlmAuth {
  provider: LlmProviderId;
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  /** Tried in order after `model`; empty on the direct route. */
  fallbackModels: string[];
}

export interface JevAuth {
  provider: JevProviderId;
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
}

/**
 * A setting the user actually chose, or undefined.
 *
 * Deliberately not `get()`: that returns the package.json default whenever the
 * user has not touched the setting, so a declared default would always outrank
 * the environment and the code default below it. `inspect()` separates "this is
 * what the manifest declares" from "this is what someone set", which is what
 * the documented precedence — setting, then environment, then built-in — needs.
 */
export function settingValue<T>(key: string): T | undefined {
  try {
    const info = vscode.workspace.getConfiguration("llmDebugger").inspect<T>(key);
    const chosen = info?.workspaceFolderValue ?? info?.workspaceValue ?? info?.globalValue;
    if (typeof chosen === "string" && chosen.trim() === "") return undefined;
    return chosen ?? undefined;
  } catch {
    // Outside an extension host (unit tests, benchmark tooling).
    return undefined;
  }
}

const setting = settingValue;

/** First of `names` found in the environment, then in a nearby api.env / .env. */
function readKey(names: string[]): string | undefined {
  for (const name of names) {
    const fromEnv = process.env[name];
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  }
  const files = [path.join(process.cwd(), "api.env"), path.join(process.cwd(), ".env")];
  try {
    let dir = __dirname;
    for (let i = 0; i < 5; i++) {
      files.push(path.join(dir, "api.env"), path.join(dir, ".env"));
      dir = path.dirname(dir);
    }
  } catch {
    /* __dirname is not always defined; the cwd candidates still stand */
  }
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf-8");
      for (const name of names) {
        const match = text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, "m"));
        const value = match?.[1].replace(/^["']|["']$/g, "").trim();
        if (value) {
          subLog.debug(`loaded ${name} from ${path.basename(file)}`);
          return value;
        }
      }
    } catch {
      /* unreadable candidate; try the next */
    }
  }
  return undefined;
}

const GATEWAY_KEYS = ["AI_GATEWAY_API_KEY", "VERCEL_AI_GATEWAY_API_KEY"];

export function resolveLlmAuth(): LlmAuth {
  const provider = (setting<string>("llmProvider") || DEFAULT_LLM_PROVIDER) as LlmProviderId;
  const configured = setting<string>("llmApiKey");
  if (provider === "vercel") {
    return {
      provider,
      apiKey: configured || readKey(GATEWAY_KEYS),
      baseUrl: setting<string>("gatewayBaseUrl") || VERCEL_DEFAULT_BASE_URL,
      model: setting<string>("llmModel") || GATEWAY_LLM_MODEL,
      reasoningEffort: (setting<string>("llmReasoningEffort") || "none") as ReasoningEffort,
      fallbackModels: GATEWAY_LLM_FALLBACKS,
    };
  }
  return {
    provider: "openai",
    apiKey: configured || readKey(["OPENAI_API_KEY"]),
    baseUrl: setting<string>("openaiBaseUrl") || OPENAI_DEFAULT_BASE_URL,
    // The env override exists so the benchmark can sweep models without
    // rewriting a dev host's settings between runs.
    model: setting<string>("llmModel") || process.env.LLMDBG_MODEL || DEFAULT_LLM_MODEL,
    reasoningEffort: (setting<string>("llmReasoningEffort") ||
      process.env.LLMDBG_REASONING_EFFORT ||
      DEFAULT_REASONING_EFFORT) as ReasoningEffort,
    fallbackModels: [],
  };
}

export function resolveJevAuth(): JevAuth {
  const provider = (setting<string>("jevProvider") || DEFAULT_JEV_PROVIDER) as JevProviderId;
  const configured = setting<string>("jevApiKey");
  if (provider === "vercel") {
    return {
      provider,
      apiKey: configured || readKey(GATEWAY_KEYS),
      baseUrl: setting<string>("gatewayBaseUrl") || VERCEL_DEFAULT_BASE_URL,
      model: setting<string>("jevModel") || process.env.LLMDBG_JEV_MODEL || GATEWAY_JEV_MODEL,
    };
  }
  return {
    provider: "typesafe",
    apiKey: configured || readKey(["TYPESAFE_API_KEY"]),
    baseUrl: setting<string>("typesafeBaseUrl") || TYPESAFE_DEFAULT_BASE_URL,
    model: setting<string>("jevModel") || process.env.LLMDBG_JEV_MODEL || DEFAULT_JEV_MODEL,
  };
}

export function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

export function resolveStrategy(): "jev" | "llm" {
  return setting<string>("strategy") === "llm" ? "llm" : "jev";
}

// ---------------------------------------------------------------------------
// Legacy surface: the sidebar loop (debug/DebugLoopController.ts) still talks to
// the gateway through ai/gateway.ts and ai/Chat.ts.
// ---------------------------------------------------------------------------

export type ProviderKind = "jev" | "llm";
export const LLM_FALLBACK_MODELS = GATEWAY_LLM_FALLBACKS;

export interface ProviderAuth {
  provider: string;
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
}

/** Always resolves the GATEWAY route — that is all the legacy client speaks. */
export function resolveAuth(kind: ProviderKind): ProviderAuth {
  const configured = setting<string>(kind === "jev" ? "jevApiKey" : "llmApiKey");
  const usingGateway =
    (kind === "jev" ? resolveJevAuth() : resolveLlmAuth()).provider === "vercel";
  return {
    provider: "vercel",
    apiKey: (usingGateway ? configured : undefined) || readKey(GATEWAY_KEYS),
    baseUrl: setting<string>("gatewayBaseUrl") || VERCEL_DEFAULT_BASE_URL,
    model: usingGateway
      ? setting<string>(kind === "jev" ? "jevModel" : "llmModel") ||
        (kind === "jev" ? GATEWAY_JEV_MODEL : GATEWAY_LLM_MODEL)
      : kind === "jev"
        ? GATEWAY_JEV_MODEL
        : GATEWAY_LLM_MODEL,
  };
}

export interface AIProvider {
  readonly baseUrl: string;
  chatEndpoint(): string;
  evaluateEndpoint(): string;
  authHeaders(apiKey: string): Record<string, string>;
}

export function createProvider(_id: string, baseUrl: string): AIProvider {
  return {
    baseUrl,
    chatEndpoint: () => `${baseUrl}/chat/completions`,
    evaluateEndpoint: () => `${baseUrl}/evaluate`,
    authHeaders,
  };
}
