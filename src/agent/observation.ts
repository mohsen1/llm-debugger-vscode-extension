import type { PausedState } from "../debug/DebugTarget";
import type { Observation } from "./types";

const MAX_FRAMES = 8;
const MAX_LOCALS = 24;
const MAX_HISTORY = 12;
const MAX_EVIDENCE = 16;

export function buildObservation(args: {
  step: number;
  stepsLeft: number;
  symptom: string;
  hypothesis: string;
  paused: PausedState;
  stdout: string;
  stderr: string;
  breakpoints: string[];
  history: string[];
  evidence: string[];
  shortPath: (p: string) => string;
}): Observation {
  const { paused, shortPath } = args;
  const top = paused.frames[0];
  const location = top ? `${shortPath(top.source)}:${top.line} in ${top.name}` : "unknown location";
  return {
    step: args.step,
    stepsLeft: args.stepsLeft,
    symptom: args.symptom,
    hypothesis: args.hypothesis,
    location,
    frames: paused.frames
      .slice(0, MAX_FRAMES)
      .map((f) => `${f.name} (${shortPath(f.source)}:${f.line})`),
    locals: paused.scopes
      .flatMap((s) => s.vars.map((v) => `${s.name}.${v.name} = ${v.value}`))
      .slice(0, MAX_LOCALS),
    focus: paused.focus || "",
    stdout: args.stdout.slice(-1200),
    stderr: args.stderr.slice(-1200),
    breakpoints: args.breakpoints,
    history: args.history.slice(-MAX_HISTORY),
    evidence: args.evidence.slice(-MAX_EVIDENCE),
  };
}

/**
 * One text rendering, handed verbatim to Jev as `state` and to the LLM as the
 * user turn. Keeping it identical is what makes the two arms comparable.
 */
export function renderObservation(o: Observation): string {
  const parts = [
    `# Failing check (the symptom being hunted)`,
    o.symptom,
    "",
    `# Working hypothesis`,
    o.hypothesis || "(none yet)",
    "",
    `# Debugger is paused at`,
    o.location,
    "",
    `# Call stack`,
    ...o.frames.map((f, i) => `${i}. ${f}`),
    "",
    `# Local variables right now`,
    ...(o.locals.length > 0 ? o.locals : ["(none)"]),
  ];
  if (o.focus) parts.push("", `# Source around the paused line`, o.focus);
  if (o.evidence.length > 0) {
    parts.push("", `# Runtime values gathered so far`, ...o.evidence.map((e) => `- ${e}`));
  }
  if (o.history.length > 0) {
    parts.push("", `# What has been tried`, ...o.history.map((h) => `- ${h}`));
  }
  parts.push(
    "",
    `# Breakpoints currently set`,
    ...(o.breakpoints.length > 0 ? o.breakpoints.map((b) => `- ${b}`) : ["(none)"]),
  );
  if (o.stdout.trim()) parts.push("", `# Program stdout so far`, o.stdout.trim());
  if (o.stderr.trim()) parts.push("", `# Program stderr so far`, o.stderr.trim());
  parts.push("", `# Budget`, `step ${o.step}, ${o.stepsLeft} steps left`);
  return parts.join("\n");
}
