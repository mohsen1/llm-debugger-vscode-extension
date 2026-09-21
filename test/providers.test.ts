import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveJevAuth, resolveLlmAuth } from "../src/ai/providers";
import { __declaredDefaults, __settings } from "./vscode-stub";

/**
 * The precedence these tests pin down is: a setting the user chose, then the
 * environment, then the built-in default. The subtle one is the middle step —
 * VSCode's `get()` hands back the package.json default for a setting nobody has
 * touched, so a declared default would otherwise outrank the environment and
 * silently pin the model no matter what you exported.
 */
const ENV_KEYS = ["LLMDBG_MODEL", "LLMDBG_REASONING_EFFORT", "LLMDBG_JEV_MODEL", "OPENAI_API_KEY"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  for (const k of Object.keys(__settings)) delete __settings[k];
  for (const k of Object.keys(__declaredDefaults)) delete __declaredDefaults[k];
  // What package.json actually declares today.
  __declaredDefaults.llmModel = "gpt-5.4-nano";
  __declaredDefaults.llmReasoningEffort = "none";
  __declaredDefaults.jevModel = "jev-latest";
  __declaredDefaults.llmProvider = "openai";
  __declaredDefaults.jevProvider = "typesafe";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("model resolution", () => {
  it("uses the built-in default when nothing is set anywhere", () => {
    expect(resolveLlmAuth().model).toBe("gpt-5.4-nano");
    expect(resolveJevAuth().model).toBe("jev-latest");
  });

  it("lets the environment override a default the user never touched", () => {
    process.env.LLMDBG_MODEL = "gpt-5.6-sol";
    process.env.LLMDBG_REASONING_EFFORT = "high";
    const auth = resolveLlmAuth();
    expect(auth.model).toBe("gpt-5.6-sol");
    expect(auth.reasoningEffort).toBe("high");
  });

  it("lets the environment override the Jev model too", () => {
    process.env.LLMDBG_JEV_MODEL = "jev-1.13.0";
    expect(resolveJevAuth().model).toBe("jev-1.13.0");
  });

  it("gives a setting the user chose precedence over the environment", () => {
    process.env.LLMDBG_MODEL = "gpt-5.6-sol";
    __settings.llmModel = "gpt-5.4-mini";
    expect(resolveLlmAuth().model).toBe("gpt-5.4-mini");
  });

  it("ignores a setting the user blanked out", () => {
    process.env.LLMDBG_MODEL = "gpt-5.6-sol";
    __settings.llmModel = "   ";
    expect(resolveLlmAuth().model).toBe("gpt-5.6-sol");
  });

  it("honours the declared provider default and a user's override of it", () => {
    expect(resolveLlmAuth().provider).toBe("openai");
    __settings.llmProvider = "vercel";
    expect(resolveLlmAuth().provider).toBe("vercel");
    // The gateway route brings its own fallback chain; the direct one has none.
    expect(resolveLlmAuth().fallbackModels.length).toBeGreaterThan(0);
  });
});
