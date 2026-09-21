import type { ChatCompletionMessageParam, ChatCompletionTool } from "../types";
import type { ChatCompletion } from "openai/resources/chat/completions";
import log from "../logger";
import { TransientError, fetchWithTimeout, isTransient, withRetry } from "./retry";
import {
  LLM_FALLBACK_MODELS,
  VERCEL_DEFAULT_BASE_URL,
  createProvider,
  resolveAuth,
} from "./providers";

const subLog = log.createSubLogger("Gateway");

/** A long report can legitimately take half a minute; past this it is a stall. */
const CHAT_TIMEOUT_MS = 90000;

/** Default endpoint; the live value comes from settings/env via resolveAuth. */
export const GATEWAY_BASE_URL = VERCEL_DEFAULT_BASE_URL;

/** Preferred model first, then free-tier-compatible fallbacks (v4-pro is gated without paid credits). */
export function modelCandidates(configured: string): string[] {
  return [configured, ...LLM_FALLBACK_MODELS].filter((v, i, a) => a.indexOf(v) === i);
}

/** Backwards-compatible: resolved LLM key (Settings > env > api.env). */
export function getGatewayApiKey(): string | undefined {
  return resolveAuth("llm").apiKey;
}

interface GatewayChatOptions {
  maxTokens?: number;
  temperature?: number;
  modelOverride?: string;
}

function toGatewayTools(tools?: ChatCompletionTool[]) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));
}

/**
 * Call a chat model via Vercel AI Gateway (OpenAI-compatible).
 * Tries MODEL_CANDIDATES in order; on 403 restricted-model errors falls through
 * to the next candidate so free-tier keys still work (v3.1 / v4-flash).
 */
export async function callGatewayChat(
  messages: ChatCompletionMessageParam[],
  tools?: ChatCompletionTool[],
  opts: GatewayChatOptions = {},
): Promise<{ completion: ChatCompletion; modelUsed: string; fallbackUsed: boolean }> {
  const auth = resolveAuth("llm");
  const apiKey = auth.apiKey;
  if (!apiKey) {
    throw new Error(
      "LLM API key not found. Set llmDebugger.llmApiKey in Settings, or AI_GATEWAY_API_KEY in env/api.env.",
    );
  }
  const provider = createProvider(auth.provider, auth.baseUrl);

  const candidates = [
    ...(opts.modelOverride ? [opts.modelOverride] : []),
    ...modelCandidates(auth.model),
  ].filter((v, i, a) => a.indexOf(v) === i);

  const withTools = !!tools && tools.length > 0;
  // Every candidate's outcome, so a failure reports what actually happened to
  // each rather than just whatever the last model said.
  const attempts: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      // Rate limits and 5xx are retried against the SAME model first: falling
      // straight through to a fallback on a 429 would silently change which
      // model a benchmark arm actually ran on.
      const completion = await withRetry(
        async () => {
          const res = await fetchWithTimeout(
            provider.chatEndpoint(),
            {
              method: "POST",
              headers: provider.authHeaders(apiKey),
              body: JSON.stringify({
                model,
                messages,
                tools: withTools ? toGatewayTools(tools) : undefined,
                tool_choice: withTools ? "required" : undefined,
                max_tokens: opts.maxTokens ?? 1000,
                ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
              }),
            },
            CHAT_TIMEOUT_MS,
          );
          if (!res.ok) {
            const text = await res.text();
            const message = `${res.status} for ${model}: ${text.slice(0, 300)}`;
            throw isTransient(res.status) ? new TransientError(message) : new Error(message);
          }
          return (await res.json()) as ChatCompletion;
        },
        { label: `chat ${model}` },
      );

      const message = completion.choices?.[0]?.message;
      const content = message?.content || "";
      // With `tool_choice: "required"` the answer lives in tool_calls and
      // content is legitimately empty — only a reply with neither is a miss.
      // (Reasoning-style models can also put everything in reasoning_content.)
      if (!content.trim() && !(message?.tool_calls && message.tool_calls.length > 0)) {
        attempts.push(`${model}: neither content nor tool calls`);
        subLog.warn(`Model ${model} returned neither content nor tool calls, trying fallback.`);
        continue;
      }
      if (i > 0) {
        subLog.debug(`Used fallback model ${model} (preferred ${candidates[0]} unavailable)`);
      }
      return { completion, modelUsed: model, fallbackUsed: i > 0 };
    } catch (err) {
      attempts.push(String(err).replace(/^Error:\s*/, "").slice(0, 200));
      subLog.warn(`Gateway call failed for ${model}: ${String(err).slice(0, 200)}`);
    }
  }
  throw new Error(`Gateway chat failed on every candidate — ${attempts.join(" | ")}`);
}

/**
 * Streaming chat call (OpenAI-compatible SSE). Forwards each text delta to
 * onToken as it arrives so chat renders progressively instead of all-at-once.
 * Falls back across model candidates the same way as the non-streaming call.
 */
export async function callGatewayChatStream(
  messages: ChatCompletionMessageParam[],
  opts: GatewayChatOptions & { onToken?: (chunk: string) => void } = {},
): Promise<{ text: string; modelUsed: string; fallbackUsed: boolean }> {
  const auth = resolveAuth("llm");
  const apiKey = auth.apiKey;
  if (!apiKey) {
    throw new Error(
      "LLM API key not found. Set llmDebugger.llmApiKey in Settings, or AI_GATEWAY_API_KEY in env/api.env.",
    );
  }
  const provider = createProvider(auth.provider, auth.baseUrl);
  const candidates = [
    ...(opts.modelOverride ? [opts.modelOverride] : []),
    ...modelCandidates(auth.model),
  ].filter((v, i, a) => a.indexOf(v) === i);
  let lastError: unknown = null;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      const res = await fetchWithTimeout(provider.chatEndpoint(), {
        method: "POST",
        headers: { ...provider.authHeaders(apiKey), Accept: "text/event-stream" },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          max_tokens: opts.maxTokens ?? 1000,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }),
      }, CHAT_TIMEOUT_MS);
      if (res.status === 403) {
        const text = await res.text();
        subLog.warn(`Model ${model} not available (${res.status}), trying fallback. ${text.slice(0, 200)}`);
        lastError = new Error(`403 for ${model}: ${text.slice(0, 300)}`);
        continue;
      }
      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(`Gateway stream failed ${res.status} for ${model}: ${text.slice(0, 500)}`);
      }
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let out = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const payload = s.slice(5).trim();
          if (payload === "[DONE]") break;
          try {
            const json = JSON.parse(payload);
            const delta: string = json.choices?.[0]?.delta?.content || "";
            if (delta) {
              out += delta;
              try { opts.onToken?.(delta); } catch { /* ignore */ }
            }
          } catch { /* keep-alive comment */ }
        }
      }
      try { await reader.cancel(); } catch { /* ignore */ }
      return { text: out, modelUsed: model, fallbackUsed: i > 0 };
    } catch (err) {
      lastError = err;
      if (i < candidates.length - 1) {
        subLog.warn(`Gateway stream failed for ${model}, trying next: ${String(err).slice(0, 200)}`);
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
