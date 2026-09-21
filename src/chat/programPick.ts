/**
 * Choosing what to actually run.
 *
 * The file you happen to have open is usually a module, not an entry point.
 * `node orders.js` imports two functions, defines them and exits — nothing
 * calls them, so no breakpoint can ever hit and the hunt ends with "program ran
 * to exit" having observed nothing. Worse, the module need not even be on the
 * path that produces the failure you described.
 *
 * So a candidate is not trusted because of where it came from. It is run once,
 * and the one whose output actually reproduces the symptom wins.
 */

export type CandidateSource = "prompt" | "attachment" | "editor" | "entry";

export interface Candidate {
  path: string;
  source: CandidateSource;
}

export interface Probe extends Candidate {
  /** Combined stdout+stderr, capped. */
  output: string;
  /** Lines that look like a reported failure. */
  failures: string[];
}

export interface Pick {
  chosen: Probe | Candidate;
  /** Set when the choice needs explaining to the user. */
  note?: string;
}

/** Conventional entry points, best first. Only those that exist are returned. */
export function entryCandidates(
  dir: string,
  exists: (relative: string) => boolean,
  packageMain?: string,
): string[] {
  const names = [packageMain, "run.js", "index.js", "main.js", "start.js", "test.js"]
    .filter((n): n is string => !!n)
    .filter((n, i, all) => all.indexOf(n) === i);
  return names.filter(exists);
}

// `\b` only makes sense after the word alternatives: a trailing colon or a
// symbol like ✗ is not a word character, so requiring a boundary after it
// matches nothing at all.
const FAILURE_LINE = /^\s*(?:(?:FAIL|not ok|AssertionError|Uncaught)\b|Error:|✗|×|✖)/i;

export function failureLines(output: string): string[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => FAILURE_LINE.test(l));
}

const NOISE = new Set([
  "the","and","for","with","that","this","from","into","when","then","than","but","not",
  "is","are","was","were","be","been","it","its","of","to","in","on","at","a","an",
  "returns","returned","return","instead","expected","expect","got","gives","gave","shows",
  "should","would","could","says","said","bug","issue","problem","wrong","broken","fails",
  "failing","fail","check","test","value","values","result","results","output","seems",
]);

/** Distinctive words a symptom and a failure line would share. */
export function symptomTerms(symptom: string): string[] {
  return [
    ...new Set(
      symptom
        .toLowerCase()
        .split(/[^a-z0-9.]+/)
        .filter((w) => w.length >= 3 && !NOISE.has(w)),
    ),
  ];
}

/**
 * How well a program's output matches the symptom the user described.
 * 1 is a clear match, 0 is none.
 */
export function symptomMatch(output: string, symptom: string): number {
  const terms = symptomTerms(symptom);
  if (terms.length === 0) return 0;
  const lines = failureLines(output);
  if (lines.length === 0) return 0;
  let best = 0;
  for (const line of lines) {
    const lower = line.toLowerCase();
    const hits = terms.filter((t) => lower.includes(t)).length;
    best = Math.max(best, hits / terms.length);
  }
  return best;
}

const SOURCE_RANK: Record<CandidateSource, number> = {
  prompt: 4,
  attachment: 3,
  editor: 2,
  entry: 1,
};

/** Strong enough overlap to call it the same failure. */
const MATCH_THRESHOLD = 0.5;

/**
 * Pick the program to debug. Reproducing the stated symptom beats everything;
 * reporting any failure beats producing nothing; where nothing distinguishes
 * two candidates, the one the user pointed at wins.
 */
export function pickProgram(probes: Probe[], symptom: string): Pick | undefined {
  if (probes.length === 0) return undefined;
  const scored = probes.map((probe) => ({
    probe,
    match: symptom ? symptomMatch(probe.output, symptom) : 0,
    rank: SOURCE_RANK[probe.source],
  }));

  const reproduces = scored
    .filter((s) => s.match >= MATCH_THRESHOLD)
    .sort((a, b) => b.match - a.match || b.rank - a.rank);
  if (reproduces.length > 0) {
    const winner = reproduces[0];
    const asked = scored.find((s) => s.probe.source === "prompt" || s.probe.source === "editor");
    const note =
      asked && asked.probe.path !== winner.probe.path
        ? `${base(asked.probe.path)} does not report that failure, so I ran ${base(winner.probe.path)} instead.`
        : undefined;
    return { chosen: winner.probe, ...(note ? { note } : {}) };
  }

  const reportsFailure = scored
    .filter((s) => s.probe.failures.length > 0)
    .sort((a, b) => b.rank - a.rank);
  if (reportsFailure.length > 0) {
    const winner = reportsFailure[0];
    return {
      chosen: winner.probe,
      note: symptom
        ? `Nothing here reports exactly that failure; hunting the one ${base(winner.probe.path)} does report.`
        : undefined,
    };
  }

  const producesOutput = scored
    .filter((s) => s.probe.output.trim().length > 0)
    .sort((a, b) => b.rank - a.rank);
  if (producesOutput.length > 0) return { chosen: producesOutput[0].probe };

  // Nothing ran to any effect. Say so rather than launching a module that will
  // define some functions and exit.
  return {
    chosen: scored.sort((a, b) => b.rank - a.rank)[0].probe,
    note: "none-produced-output",
  };
}

function base(p: string): string {
  return p.split("/").pop() || p;
}
