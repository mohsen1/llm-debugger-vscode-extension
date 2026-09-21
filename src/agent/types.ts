/** Shapes shared by the loop, both strategies and the benchmark. No vscode import. */

/** Everything a strategy is allowed to see. Identical for both arms, so any
 * difference in outcome is attributable to the decision-maker and nothing else. */
export interface Observation {
  step: number;
  stepsLeft: number;
  /** The failing assertion. The only thing about the bug the agent is told. */
  symptom: string;
  /** Working hypothesis, from the opening plan and revised as evidence lands. */
  hypothesis: string;
  location: string;
  frames: string[];
  locals: string[];
  focus: string;
  stdout: string;
  stderr: string;
  breakpoints: string[];
  /** Recent actions and what they produced, oldest first. */
  history: string[];
  /** Runtime values read so far via evaluate / locals, oldest first. */
  evidence: string[];
}

export type ActionKind =
  | "next"
  | "stepIn"
  | "stepOut"
  | "continue"
  | "setBreakpoint"
  | "evaluate"
  | "finish";

export interface Decision {
  action: ActionKind;
  /** setBreakpoint */
  file?: string;
  line?: number;
  /** evaluate */
  expression?: string;
  why?: string;
  confidence?: number;
  /** Who actually made this call — used by the ledger and the transcript. */
  source: "jev" | "llm" | "policy";
}

export interface Strategy {
  readonly name: StrategyName;
  decide(observation: Observation): Promise<Decision>;
}

export type StrategyName = "jev" | "llm";

export interface Edit {
  file: string;
  search: string;
  replace: string;
}

export interface HuntReport {
  rootCause: string;
  file: string;
  line: number;
  edits: Edit[];
  evidence: string[];
}

export interface Ledger {
  steps: number;
  jevCalls: number;
  llmCalls: number;
  jevMs: number;
  llmMs: number;
  jevInputTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  costUsd: number;
  /** Which models actually answered — the chain falls back, so this is not
   * implied by the configuration. */
  modelsUsed: string[];
}

export function emptyLedger(): Ledger {
  return {
    steps: 0,
    jevCalls: 0,
    llmCalls: 0,
    jevMs: 0,
    llmMs: 0,
    jevInputTokens: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    costUsd: 0,
    modelsUsed: [],
  };
}

export interface HuntTask {
  /** Program to launch, absolute or workspace-relative. */
  program: string;
  /** The failing assertion text. */
  symptom: string;
}

export interface HuntResult {
  strategy: StrategyName;
  task: HuntTask;
  report: HuntReport | null;
  ledger: Ledger;
  /** Human-readable action log, one line per step. */
  trail: string[];
  evidence: string[];
  wallMs: number;
  endedReason: string;
  /** Non-fatal problems worth seeing in the write-up. */
  warnings: string[];
}
