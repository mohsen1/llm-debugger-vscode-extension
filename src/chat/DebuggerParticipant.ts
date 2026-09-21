import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { resolveStrategy } from "../ai/providers";
import { hunt } from "../agent/loop";
import { JevStrategy } from "../agent/strategies/jev";
import { LlmStrategy } from "../agent/strategies/llm";
import type { HuntResult, StrategyName } from "../agent/types";
import { NodeWorkspaceFiles } from "../agent/workspace";
import type { DebugTarget } from "../debug/DebugTarget";
import { programFromPrompt } from "./promptParsing";
import {
  entryCandidates,
  failureLines,
  pickProgram,
  type Candidate,
  type Probe,
} from "./programPick";
import logger from "../logger";

const log = logger.createSubLogger("Participant");

/**
 * `@debugger` — the whole hunt runs inside this extension, so there is nothing
 * to install or configure beyond it. The prompt is treated as the symptom; with
 * no symptom the program is run once and its first failing check is used.
 */
export function registerDebuggerParticipant(
  context: vscode.ExtensionContext,
  target: DebugTarget,
): void {
  const participant = vscode.chat.createChatParticipant(
    "llm-debugger.debugger",
    async (request, _ctx, stream, token) => {
      if (request.command && request.command !== "use-debugger") {
        stream.markdown(usage());
        return {};
      }
      const strategy = resolveStrategy();
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const files = new NodeWorkspaceFiles(folder);
      const named = programFromPrompt(request.prompt);
      const candidates = collectCandidates(named, request.references, folder, files);
      if (candidates.length === 0) {
        stream.markdown(usage());
        return {};
      }

      const typescript = candidates.find((c) => /\.(ts|tsx|mts|cts)$/i.test(c.path));
      if (typescript && candidates.every((c) => /\.(ts|tsx|mts|cts)$/i.test(c.path))) {
        // The driver launches plain `node`, which cannot execute TypeScript.
        // Saying so beats letting the launch fail with a module-loader error.
        stream.markdown(
          `\`${files.shortPath(typescript.path)}\` is TypeScript, and I launch it with plain ` +
            "`node`, which cannot run it directly.\n\n" +
            "Point me at a runnable JavaScript entry point or the compiled output " +
            "(for example `dist/index.js`) and I will step through that.\n",
        );
        return {};
      }

      // The symptom the user typed, if they typed one. It also decides which
      // candidate is the right program to run.
      const stated = describedSymptom(request.prompt, named);
      stream.progress("working out which program reproduces this…");
      const runnable = candidates.filter((c) => !/\.(ts|tsx|mts|cts)$/i.test(c.path));
      const probes = await probeCandidates(runnable);
      const picked = pickProgram(probes, stated ?? "");
      if (!picked) {
        stream.markdown(usage());
        return {};
      }
      if (picked.note === "none-produced-output") {
        stream.markdown(
          `I ran ${probes.map((p) => `\`${files.shortPath(p.path)}\``).join(", ")} and none of them ` +
            "produced any output, so there is nothing for a debugger to stop on — they look like " +
            "modules rather than entry points.\n\n" +
            "Point me at the file that runs your checks (`@debugger run.js`), or open it and tag me again.\n",
        );
        return {};
      }

      const programAbs = picked.chosen.path;
      const chosenProbe = probes.find((p) => p.path === programAbs);
      const symptom = stated ?? chosenProbe?.failures[0];
      if (!symptom) {
        stream.markdown(
          `\`${files.shortPath(programAbs)}\` ran without reporting a failure, so there is nothing ` +
            "to hunt.\n\nTell me what is wrong and I will hunt that instead — for example " +
            "`@debugger the async order total comes out NaN`.\n",
        );
        return {};
      }

      stream.markdown(`Hunting: **${symptom}**\n\n`);
      if (picked.note) stream.markdown(`_${picked.note}_\n\n`);
      stream.markdown(`Program \`${files.shortPath(programAbs)}\` · ${brainLabel(strategy)}\n\n`);

      token?.onCancellationRequested(() => {
        void target.stop();
      });

      let result: HuntResult;
      try {
        result = await hunt({
          target,
          task: { program: programAbs, symptom },
          strategy: (meter) =>
            strategy === "jev" ? new JevStrategy(meter) : new LlmStrategy(meter),
          files,
          options: {
            say: (line) => stream.markdown(`- ${line.split("\n")[0].slice(0, 220)}\n`),
            progress: (line) => stream.progress(line.slice(0, 160)),
            isCancelled: () => token?.isCancellationRequested ?? false,
          },
        });
      } catch (err) {
        stream.markdown(`\nThe hunt failed before finishing: ${String(err).slice(0, 400)}\n`);
        return {};
      }

      stream.markdown(`\n${renderResult(result)}\n`);
      log.debug(`hunt ${result.strategy}: ${result.endedReason} in ${result.wallMs}ms`);
      return {};
    },
  );
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "res", "icon.png");
  context.subscriptions.push(participant);
}

function usage(): string {
  return (
    "I hunt bugs by driving the real VSCode debugger — breakpoints, the yellow step line, " +
    "live variables, all on screen.\n\n" +
    "- `@debugger` with a file open or attached: I run it, take the first failing check and hunt that.\n" +
    "- `@debugger the async total comes out NaN` — hunt that symptom specifically.\n" +
    "- `@debugger run.js` — name the program to run.\n\n" +
    "Which brain routes each step is Settings → LLM Debugger → `strategy`.\n"
  );
}

function brainLabel(strategy: StrategyName): string {
  return strategy === "jev"
    ? "routing each step through the fast decision model"
    : "reasoning every step with the generation model";
}

function renderResult(result: HuntResult): string {
  const { ledger } = result;
  const seconds = (result.wallMs / 1000).toFixed(1);
  const lines = [
    `### Verdict`,
    "",
    `**${seconds}s** — ${ledger.steps} debugger actions, ${ledger.jevCalls} fast checks, ` +
      `${ledger.llmCalls} model calls, $${ledger.costUsd.toFixed(5)}`,
    "",
  ];
  // A report with no edits rests on nothing observed — the model was asked for
  // a verdict and politely said it could not reach one. Printing its `file:line`
  // as a root cause contradicts its own text, so treat it as no verdict.
  const grounded = result.report && result.report.edits.length > 0;
  if (!grounded) {
    lines.push(`No verdict — the hunt ended because ${result.endedReason}.`, "");
    if (result.ledger.steps === 0) {
      lines.push(
        "The program never paused, so no runtime values were seen. That usually means the " +
          "breakpoints were not on a line this program actually executes — check that the file " +
          "you pointed me at is the one that reproduces the failure.",
        "",
      );
    }
    if (result.report?.rootCause) lines.push(`The model's read: ${result.report.rootCause}`, "");
    lines.push("Re-run to keep hunting, or name the symptom more precisely.");
    return lines.join("\n");
  }
  const report = result.report as NonNullable<HuntResult["report"]>;
  lines.push(
    `**Root cause** — \`${report.file}:${report.line}\``,
    "",
    report.rootCause,
    "",
  );
  if (report.evidence.length > 0) {
    lines.push("**Runtime evidence**", "", ...report.evidence.map((e) => `- ${e}`), "");
  }
  for (const edit of report.edits) {
    lines.push(`**Fix — \`${edit.file}\`**`, "", "```diff", ...diffBlock(edit.search, edit.replace), "```", "");
  }
  if (result.warnings.length > 0) {
    lines.push(`_${result.warnings.slice(0, 3).join("; ")}_`);
  }
  return lines.join("\n");
}

function diffBlock(search: string, replace: string): string[] {
  return [
    ...search.split("\n").map((l) => `- ${l}`),
    ...replace.split("\n").map((l) => `+ ${l}`),
  ];
}

/** A prompt with more than a file name in it IS the symptom. */
function describedSymptom(prompt: string, named?: string): string | undefined {
  const rest = prompt
    .split(/\s+/)
    .filter((w) => w && w !== named && !(named && w.endsWith(named)))
    .join(" ")
    .trim();
  return rest.length >= 12 ? rest : undefined;
}

/**
 * Everything worth considering, best-intentioned first. Conventional entry
 * points are always included: the open file is frequently a module, and a
 * module runs to exit without ever reaching a breakpoint.
 */
function collectCandidates(
  named: string | undefined,
  references: readonly vscode.ChatPromptReference[] | undefined,
  folder: string,
  files: NodeWorkspaceFiles,
): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const add = (candidate: string | undefined, source: Candidate["source"]) => {
    if (!candidate) return;
    const abs = path.isAbsolute(candidate)
      ? candidate
      : files.resolve(candidate, path.join(folder, "x")) ?? path.join(folder, candidate);
    if (!fs.existsSync(abs) || seen.has(abs)) return;
    seen.add(abs);
    out.push({ path: abs, source });
  };

  add(named, "prompt");
  for (const ref of references ?? []) {
    const value = ref?.value as unknown;
    const uri =
      value instanceof vscode.Uri
        ? value
        : value instanceof vscode.Location
          ? value.uri
          : undefined;
    if (uri?.scheme === "file") add(uri.fsPath, "attachment");
  }
  const open = vscode.window.activeTextEditor?.document;
  if (open?.uri.scheme === "file") add(open.uri.fsPath, "editor");

  // Sibling entry points first (the open file's own folder), then the workspace.
  const dirs = [...new Set([open ? path.dirname(open.uri.fsPath) : folder, folder])];
  for (const dir of dirs) {
    for (const entry of entryCandidates(dir, (name) => fs.existsSync(path.join(dir, name)), packageMain(dir))) {
      add(path.join(dir, entry), "entry");
    }
  }
  return out.slice(0, MAX_CANDIDATES);
}

function packageMain(dir: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf-8");
    const main = (JSON.parse(raw) as { main?: string }).main;
    return typeof main === "string" ? main : undefined;
  } catch {
    return undefined;
  }
}

/** At most this many programs get run to see which reproduces the symptom. */
const MAX_CANDIDATES = 4;
const PROBE_TIMEOUT_MS = 20000;

/**
 * Run each candidate once and record what it printed. The hunt is about to
 * launch one of these under a debugger anyway, so running them is not a new
 * kind of side effect — it just happens before the choice instead of after.
 */
async function probeCandidates(candidates: Candidate[]): Promise<Probe[]> {
  return Promise.all(
    candidates.map(
      (candidate) =>
        new Promise<Probe>((resolve) => {
          execFile(
            process.execPath,
            [candidate.path],
            { cwd: path.dirname(candidate.path), timeout: PROBE_TIMEOUT_MS, maxBuffer: 4_000_000 },
            (_err, stdout, stderr) => {
              const output = `${stdout}\n${stderr}`.slice(0, 20000);
              resolve({ ...candidate, output, failures: failureLines(output).slice(0, 40) });
            },
          );
        }),
    ),
  );
}
