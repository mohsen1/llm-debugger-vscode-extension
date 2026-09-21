import type { ChatCompletionTool } from "../types";
import { callWithTools } from "./llmClient";
import type { Meter } from "./meter";
import type { HuntReport } from "./types";

const REPORT_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "submitFix",
    description: "The root cause and the minimal edit that fixes it.",
    parameters: {
      type: "object",
      properties: {
        rootCause: {
          type: "string",
          description: "Two sentences at most: what the code does wrong and why that produces the observed value.",
        },
        file: { type: "string", description: "File containing the bug, e.g. pricing.js" },
        line: { type: "number", description: "1-based line of the bug" },
        edits: {
          type: "array",
          description: "The minimal edits that fix it. Usually one.",
          items: {
            type: "object",
            properties: {
              file: { type: "string" },
              search: {
                type: "string",
                description:
                  "Text to replace, copied VERBATIM from the source shown — exact indentation, exact characters, and unique in that file.",
              },
              replace: { type: "string", description: "Text to put in its place." },
            },
            required: ["file", "search", "replace"],
          },
        },
        evidence: {
          type: "array",
          description: "Runtime values actually observed that prove this, one per entry.",
          items: { type: "string" },
        },
      },
      required: ["rootCause", "file", "line", "edits"],
    },
  },
};

/**
 * The closing call: turn the trail into a root cause plus a patch.
 *
 * The full source of the files the hunt actually visited is included, because
 * `search` has to match the file byte for byte for the grader to apply it. No
 * part of this prompt describes the bug — that is exactly what is being tested.
 */
export async function writeReport(args: {
  symptom: string;
  hypothesis: string;
  trail: string[];
  evidence: string[];
  /** Full source of the files the hunt paused in, keyed by display name. */
  visitedSources: Array<{ name: string; source: string }>;
  meter: Meter;
}): Promise<HuntReport | null> {
  const sources = args.visitedSources
    .slice(0, 4)
    .map((f) => `## ${f.name}\n${f.source.slice(0, 5000)}`)
    .join("\n\n");

  const user = [
    "# Failing check",
    args.symptom,
    "",
    "# Hypothesis going in",
    args.hypothesis || "(none)",
    "",
    "# What the debugger did",
    ...args.trail.slice(-40).map((t) => `- ${t}`),
    "",
    "# Runtime values observed while paused",
    ...(args.evidence.length > 0 ? args.evidence.slice(-30).map((e) => `- ${e}`) : ["(none)"]),
    "",
    "# Source of the files visited",
    sources || "(none)",
    "",
    "# Your task",
    "Name the root cause and submit the minimal edit that makes the failing check pass.",
    "Cite the runtime values you actually saw. Do not change behaviour the check does not test.",
  ].join("\n");

  const call = await callWithTools({
    system:
      "You just finished debugging a program live. Write the verdict. Ground every claim in a runtime " +
      "value from the session. The `search` text of each edit must be copied character for character " +
      "from the source above, or the patch will not apply.",
    user,
    tools: [REPORT_TOOL],
    meter: args.meter,
    maxTokens: 1600,
    patience: "long",
  });

  if (!call || call.name !== "submitFix") return null;
  const edits = (Array.isArray(call.args.edits) ? call.args.edits : [])
    .map((e) => e as Record<string, unknown>)
    .filter(
      (e) =>
        typeof e.file === "string" && typeof e.search === "string" && typeof e.replace === "string",
    )
    .map((e) => ({ file: String(e.file), search: String(e.search), replace: String(e.replace) }));

  return {
    rootCause: typeof call.args.rootCause === "string" ? call.args.rootCause : "",
    file: typeof call.args.file === "string" ? call.args.file : "",
    line: Number.isFinite(Number(call.args.line)) ? Math.trunc(Number(call.args.line)) : 0,
    edits,
    evidence: (Array.isArray(call.args.evidence) ? call.args.evidence : [])
      .filter((e): e is string => typeof e === "string")
      .slice(0, 12),
  };
}
