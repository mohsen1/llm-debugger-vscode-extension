import type { ChatCompletionTool } from "../types";
import { callWithTools } from "./llmClient";
import type { Meter } from "./meter";

export interface OpeningPlan {
  hypothesis: string;
  breakpoints: Array<{ file: string; line: number; why: string }>;
}

const PLAN_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "openingPlan",
    description: "Where to start the hunt, and why.",
    parameters: {
      type: "object",
      properties: {
        hypothesis: {
          type: "string",
          description: "One or two sentences on what is most likely producing the wrong value.",
        },
        breakpoints: {
          type: "array",
          description: "1 to 3 places to pause first, most promising first.",
          items: {
            type: "object",
            properties: {
              file: { type: "string", description: "File name, e.g. pricing.js" },
              line: { type: "number", description: "1-based line number" },
              why: { type: "string", description: "What pausing here would show." },
            },
            required: ["file", "line", "why"],
          },
        },
      },
      required: ["hypothesis", "breakpoints"],
    },
  },
};

/**
 * The one look at the code before stepping starts.
 *
 * The planner is shown the failing check, the names of the modules in play and
 * the source of the entry file it runs in — the same starting position a person
 * gets from a failing test. It is deliberately NOT shown the other modules'
 * source: handing over every file turns the exercise into code review, and the
 * thing being measured here is debugging. Everything past this point has to be
 * learned from the running program.
 */
export async function makeOpeningPlan(args: {
  symptom: string;
  entryFile: string;
  entrySource: string;
  moduleNames: string[];
  meter: Meter;
}): Promise<OpeningPlan> {
  const user = [
    "# Failing check",
    args.symptom,
    "",
    `# Entry file: ${args.entryFile}`,
    numbered(args.entrySource).slice(0, 9000),
    "",
    "# Other modules in this program (source not shown — step into them to see it)",
    args.moduleNames.join(", "),
    "",
    "# Your task",
    "Say what you think is wrong, and pick 1-3 breakpoints that would show it at runtime.",
    "You can only see the entry file above, so only its line numbers are known to you.",
    "Break on the line in the entry file that calls into the suspect code, then step into",
    "the call once the program pauses there — guessing a line number in a file you have not",
    "seen usually lands on an import or a blank line and wastes the opening move.",
  ].join("\n");

  const call = await callWithTools({
    system:
      "You are starting a debugging session on a failing check. You will drive a real debugger from " +
      "the breakpoints you choose, so pick lines that will actually execute and that sit close to " +
      "where the suspect value is computed.",
    user,
    tools: [PLAN_TOOL],
    meter: args.meter,
    maxTokens: 900,
    patience: "long",
  });

  const fallback: OpeningPlan = {
    hypothesis: "",
    breakpoints: [],
  };
  if (!call || call.name !== "openingPlan") return fallback;
  const hypothesis = typeof call.args.hypothesis === "string" ? call.args.hypothesis : "";
  const raw = Array.isArray(call.args.breakpoints) ? call.args.breakpoints : [];
  const breakpoints = raw
    .map((b) => b as Record<string, unknown>)
    .filter((b) => typeof b.file === "string" && Number.isFinite(Number(b.line)))
    .slice(0, 3)
    .map((b) => ({
      file: String(b.file),
      line: Math.max(1, Math.trunc(Number(b.line))),
      why: typeof b.why === "string" ? b.why : "",
    }));
  return { hypothesis, breakpoints };
}

function numbered(source: string): string {
  return source
    .split("\n")
    .map((text, i) => `${String(i + 1).padStart(3)}| ${text}`)
    .join("\n");
}
