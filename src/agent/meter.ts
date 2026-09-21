import { costOf } from "../ai/pricing";
import { emptyLedger, type Ledger } from "./types";

/**
 * The cost ledger. Every model call in a hunt goes through here, so the
 * benchmark's dollar and latency columns come from what actually happened
 * rather than from an estimate.
 */
export class Meter {
  readonly ledger: Ledger = emptyLedger();

  recordJev(model: string, ms: number, inputTokens: number, outputTokens = 0): void {
    this.noteModel(model);
    this.ledger.jevCalls++;
    this.ledger.jevMs += ms;
    this.ledger.jevInputTokens += inputTokens;
    this.ledger.costUsd += costOf(model, inputTokens, outputTokens);
  }

  recordLlm(model: string, ms: number, inputTokens: number, outputTokens: number): void {
    this.noteModel(model);
    this.ledger.llmCalls++;
    this.ledger.llmMs += ms;
    this.ledger.llmInputTokens += inputTokens;
    this.ledger.llmOutputTokens += outputTokens;
    this.ledger.costUsd += costOf(model, inputTokens, outputTokens);
  }

  countStep(): void {
    this.ledger.steps++;
  }

  private noteModel(model: string): void {
    if (!this.ledger.modelsUsed.includes(model)) this.ledger.modelsUsed.push(model);
  }
}
