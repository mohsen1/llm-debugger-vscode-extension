// Debugging-performance benchmark: same loop, two brains.
//
//   node benchmark/run.js --quick            3 tasks x jev,llm
//   node benchmark/run.js                    all 13 tasks x jev,llm
//   node benchmark/run.js --strategies=jev --repeats=3
//   node benchmark/run.js --score-only       re-score the last raw run, no host
//
// Each task is the example with every bug fixed but one, so exactly one
// assertion fails. The agent is told only that assertion. A run counts as
// solved when its proposed edits make that assertion pass without breaking one
// that was already passing — applied and re-run, not judged by a model.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGroundTruth, scoreReport } from "./lib/example.js";
import { QUICK_TASK_IDS, buildTaskWorkspaces, huntManifest } from "./lib/tasks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");

const RAW_FILE = path.join(here, "raw-runs.json");
const TASKS_FILE = path.join(here, "raw-tasks.json");
const RESULTS_JSON = path.join(here, "results.json");
const RESULTS_MD = path.join(here, "results.md");

function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
  const scoreOnly = has("score-only");
  const strategies = flag("strategies", "jev,llm").split(",").map((s) => s.trim()).filter(Boolean);
  const repeats = Number(flag("repeats", "1"));
  const maxSteps = Number(flag("max-steps", "120"));
  const maxWallMs = Number(flag("max-minutes", "5")) * 60 * 1000;
  // Forwarded to the dev host so a sweep does not need settings edits.
  const model = flag("model", "");
  const effort = flag("effort", "");
  if (model) process.env.LLMDBG_MODEL = model;
  if (effort) process.env.LLMDBG_REASONING_EFFORT = effort;
  const only = has("quick")
    ? QUICK_TASK_IDS
    : flag("tasks", "").split(",").map((s) => s.trim()).filter(Boolean);

  if (!scoreOnly) {
    ensureKeys();
    const workspaceRoot = path.join(os.tmpdir(), "llmdbg-bench");
    console.log(`[bench] building task workspaces in ${workspaceRoot}`);
    const { tasks } = buildTaskWorkspaces(workspaceRoot, { only });
    for (const t of tasks) {
      if (t.unexpectedFailures.length > 0) {
        throw new Error(`${t.bugId} is not isolated: ${t.unexpectedFailures.join(", ")}`);
      }
    }
    console.log(
      `[bench] ${tasks.length} task(s) x ${strategies.join(",")} x ${repeats} repeat(s), ` +
        `<= ${maxSteps} steps / ${maxWallMs / 60000} min each` +
        (model ? `, model ${model}${effort ? ` (effort ${effort})` : ""}` : ""),
    );
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 1));

    const manifestFile = path.join(workspaceRoot, "..", "llmdbg-manifest.json");
    const planFile = path.join(workspaceRoot, "..", "llmdbg-plan.json");
    fs.writeFileSync(manifestFile, JSON.stringify(huntManifest(tasks), null, 1));
    fs.writeFileSync(planFile, JSON.stringify({ strategies, repeats, maxSteps, maxWallMs }, null, 1));

    await runHost({
      workspace: workspaceRoot,
      out: RAW_FILE,
      env: { LLMDBG_MANIFEST: manifestFile, LLMDBG_PLAN: planFile },
      headless: has("headless"),
    });
  }

  if (!fs.existsSync(RAW_FILE)) throw new Error(`no raw results at ${RAW_FILE}`);
  const raw = JSON.parse(fs.readFileSync(RAW_FILE, "utf-8"));
  const tasks = JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8"));
  if (!raw.complete) console.warn("[bench] raw results are from an incomplete host run");

  console.log(`[bench] scoring ${raw.runs.length} run(s)`);
  const scored = score(raw.runs, tasks);
  fs.writeFileSync(RESULTS_JSON, JSON.stringify(scored, null, 1));
  fs.writeFileSync(RESULTS_MD, renderMarkdown(scored));
  console.log(`[bench] wrote ${path.relative(repoRoot, RESULTS_MD)}`);
  console.log(`\n${summaryTable(scored)}\n`);
}

/**
 * Keys have to reach the dev host's process env — the extension inside it reads
 * them from there. Which ones are required depends on the configured route, so
 * every key present is forwarded and only a total absence is fatal.
 */
function ensureKeys() {
  const names = ["OPENAI_API_KEY", "TYPESAFE_API_KEY", "AI_GATEWAY_API_KEY"];
  for (const file of [path.join(repoRoot, "api.env"), path.join(repoRoot, ".env")]) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf-8");
    for (const name of names) {
      if (process.env[name]) continue;
      const m = text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, "m"));
      if (m) process.env[name] = m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  const found = names.filter((n) => process.env[n]);
  if (found.length === 0) {
    throw new Error(`No API key found. Put one of ${names.join(", ")} in the environment or api.env.`);
  }
  console.log(`[bench] keys available: ${found.join(", ")}`);
}

function runHost({ workspace, out, env, headless }) {
  return new Promise((resolve, reject) => {
    const args = [
      path.join(here, "host", "run.js"),
      "--suite=bench",
      `--workspace=${workspace}`,
      `--out=${out}`,
      ...(headless ? ["--headless"] : []),
    ];
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`host exited with ${code}`)),
    );
  });
}

function score(runs, tasks) {
  const truth = loadGroundTruth();
  const byDir = new Map(tasks.map((t) => [t.dir, t]));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmdbg-score-"));
  const scored = [];
  try {
    for (const run of runs) {
      const task = byDir.get(run.dir);
      if (!task) continue;
      const bug = truth.bugs.find((b) => b.id === task.bugId);
      const verdict = scoreReport({ bug, report: run.report, workDir, truth });
      scored.push({
        bugId: task.bugId,
        depth: task.depth,
        strategy: run.strategy,
        repeat: run.repeat,
        symptom: task.symptom,
        expected: `${bug.file}:${bug.line}`,
        reported: run.report ? `${path.basename(String(run.report.file))}:${run.report.line}` : null,
        rootCause: run.report ? run.report.rootCause : null,
        solved: verdict.solved,
        located: verdict.located,
        locatedFile: verdict.locatedFile,
        editError: verdict.editError,
        brokeChecks: verdict.brokeChecks,
        endedReason: run.endedReason,
        wallMs: run.wallMs,
        ledger: run.ledger,
        warnings: run.warnings,
      });
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  return { when: new Date().toISOString(), runs: scored, byStrategy: aggregate(scored) };
}

function aggregate(scored) {
  const out = {};
  for (const strategy of [...new Set(scored.map((s) => s.strategy))]) {
    const rows = scored.filter((s) => s.strategy === strategy);
    const sum = (f) => rows.reduce((n, r) => n + (f(r) || 0), 0);
    out[strategy] = {
      runs: rows.length,
      solved: rows.filter((r) => r.solved).length,
      located: rows.filter((r) => r.located).length,
      locatedFile: rows.filter((r) => r.locatedFile).length,
      noReport: rows.filter((r) => !r.reported).length,
      abandoned: rows.filter((r) => !r.ledger).length,
      patchDidNotApply: rows.filter((r) => r.editError).length,
      medianWallMs: median(rows.map((r) => r.wallMs)),
      totalWallMs: sum((r) => r.wallMs),
      steps: sum((r) => r.ledger && r.ledger.steps),
      llmCalls: sum((r) => r.ledger && r.ledger.llmCalls),
      jevCalls: sum((r) => r.ledger && r.ledger.jevCalls),
      llmMs: sum((r) => r.ledger && r.ledger.llmMs),
      jevMs: sum((r) => r.ledger && r.ledger.jevMs),
      costUsd: sum((r) => r.ledger && r.ledger.costUsd),
      modelsUsed: [
        ...new Set(rows.flatMap((r) => (r.ledger && r.ledger.modelsUsed) || [])),
      ].sort(),
    };
  }
  return out;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function summaryTable(scored) {
  const rows = Object.entries(scored.byStrategy).map(([name, a]) =>
    [
      name.padEnd(5),
      `solved ${String(a.solved).padStart(2)}/${a.runs}`,
      `located ${String(a.located).padStart(2)}/${a.runs}`,
      `${(a.medianWallMs / 1000).toFixed(1)}s median`,
      `${a.steps} steps`,
      `${a.llmCalls} llm + ${a.jevCalls} jev calls`,
      `$${a.costUsd.toFixed(4)}`,
    ].join("  |  "),
  );
  return rows.join("\n");
}

function renderMarkdown(scored) {
  const strategies = Object.keys(scored.byStrategy);
  const lines = [
    "# Debugging performance: Jev routing vs LLM routing",
    "",
    `Generated ${scored.when} · ${scored.runs.length} runs`,
    "",
    "Same loop, same action vocabulary, same observations, same closing report.",
    "The only difference is who answers *what should the debugger do next* at each",
    "step: `jev` routes with a typed evaluation call and wakes the generation model",
    "only for a breakpoint location or an expression; `llm` asks the generation model",
    "every step. Each task is the example with every bug fixed but one; the agent is",
    "told only the failing assertion.",
    "",
    "**Solved** means the proposed patch applied, made that assertion pass, and broke",
    "nothing that was passing. It is checked by running the program, not by a judge.",
    "",
    "## Summary",
    "",
    "| brain | solved | located (±3 lines) | right file | median run | steps | LLM calls | fast checks | cost |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const name of strategies) {
    const a = scored.byStrategy[name];
    lines.push(
      `| \`${name}\` | **${a.solved}/${a.runs}** | ${a.located}/${a.runs} | ${a.locatedFile}/${a.runs} | ` +
        `${(a.medianWallMs / 1000).toFixed(1)}s | ${a.steps} | ${a.llmCalls} | ${a.jevCalls} | $${a.costUsd.toFixed(4)} |`,
    );
  }
  const models = [
    ...new Set(strategies.flatMap((n) => scored.byStrategy[n].modelsUsed || [])),
  ].sort();
  if (models.length > 0) {
    lines.push("", `Models that answered: ${models.map((m) => `\`${m}\``).join(", ")}.`);
  }
  const abandoned = strategies.filter((n) => scored.byStrategy[n].abandoned > 0);
  if (abandoned.length > 0) {
    lines.push(
      "",
      "Runs the host had to abandon (no ledger, counted as unsolved): " +
        abandoned.map((n) => `\`${n}\` ${scored.byStrategy[n].abandoned}`).join(", ") +
        ".",
    );
  }

  lines.push("", "## Per task", "", `| task | depth | ${strategies.map((s) => `${s}`).join(" | ")} |`);
  lines.push(`|---|---|${strategies.map(() => "---").join("|")}|`);
  const bugIds = [...new Set(scored.runs.map((r) => r.bugId))];
  for (const bugId of bugIds) {
    const cells = strategies.map((s) => {
      const rows = scored.runs.filter((r) => r.bugId === bugId && r.strategy === s);
      if (rows.length === 0) return "—";
      const solved = rows.filter((r) => r.solved).length;
      const mark = solved === rows.length ? "✅" : solved > 0 ? "◐" : "❌";
      const where = rows[0].reported ?? "no report";
      const steps = rows[0].ledger ? rows[0].ledger.steps : 0;
      return `${mark} ${where} · ${steps} steps`;
    });
    const depth = scored.runs.find((r) => r.bugId === bugId)?.depth ?? "";
    lines.push(`| \`${bugId}\` | ${depth} | ${cells.join(" | ")} |`);
  }

  const failures = scored.runs.filter((r) => !r.solved);
  if (failures.length > 0) {
    lines.push("", "## Where runs fell short", "");
    for (const f of failures.slice(0, 40)) {
      const why = f.editError
        ? `patch did not apply (${f.editError})`
        : f.brokeChecks.length > 0
          ? `broke ${f.brokeChecks.join(", ")}`
          : f.reported
            ? `pointed at ${f.reported}, expected ${f.expected}`
            : "produced no report";
      lines.push(`- \`${f.bugId}\` / \`${f.strategy}\` — ${why} (ended: ${f.endedReason})`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

main().catch((err) => {
  console.error(`[bench] ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
