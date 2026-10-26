import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { analysePitch, mixToMono } from "../src/lib/pitch.ts";
import { analyseTone } from "../src/lib/tone.ts";
import {
  analyseExperimentalPitch,
  EXPERIMENTAL_RULES,
  EXPERIMENTAL_VERSION,
} from "../src/lib/experimental-pitch.ts";
import {
  scoreFrames,
  onsetResponse,
  syntheticCases,
  matchBoundaries,
  type SignalCase,
} from "./lib/fast-pitch-audit.ts";
import {
  heldOutCases,
  heldOutRecoveryCases,
  extraCases,
} from "./lib/experimental-cases.ts";

mkdirSync("work/experimental-b", { recursive: true });
const output: Record<string, unknown> = {
  version: EXPERIMENTAL_VERSION,
  rules: EXPERIMENTAL_RULES,
  node: process.version,
  date: new Date().toISOString(),
  previousEvaluationSeeds: [701, 809, 997, 1237],
  heldOutSeeds: [1601, 1777, 2029, 2411],
  unavailable: [
    "Beethoven solo excerpt: no audio or full exported diagnostics supplied",
  ],
  timing:
    "One wall-clock run per case; includes cold/JIT effects. Peak RSS is cumulative process high-water, not per-case browser memory. No decode time included.",
  cases: [],
};
const rows: unknown[] = [];
const save = () => {
  output.cases = rows;
  writeFileSync(
    "work/experimental-b/results.json",
    JSON.stringify(output, null, 2),
  );
};
function evaluate(signal: SignalCase, group: string) {
  const start = performance.now(),
    standard = analysePitch(signal.samples),
    standardMs = performance.now() - start;
  const tone = analyseTone(signal.samples, standard.frames);
  const before = process.memoryUsage();
  const adaptive = analyseExperimentalPitch(signal.samples, standard, {
    tone,
    standardMs,
  });
  const after = process.memoryUsage();
  if (process.argv.includes("--diagnostics"))
    writeFileSync(
      `work/experimental-b/${signal.id}-diagnostics.json`,
      JSON.stringify(adaptive),
    );
  const labelled = signal.notes.length > 0;
  const discrete = labelled && signal.texture !== "continuous-motion";
  const reference = discrete ? signal.notes.slice(1).map((n) => n.start) : [];
  const preserved = standard.frames.every(
    (f, i) =>
      f.frequency === null ||
      f.frequency === adaptive.pitch.frames[i].frequency,
  );
  const baselineWithheld = standard.frames.filter(
    (f, i) =>
      f.frequency !== null && adaptive.pitch.frames[i].frequency === null,
  ).length;
  rows.push({
    id: signal.id,
    group,
    texture: signal.texture,
    duration: standard.duration,
    frames: standard.frames.length,
    standardMs,
    adaptiveMs: adaptive.experimentalMs,
    standardCoverage: standard.coverage,
    adaptiveCoverage: adaptive.pitch.coverage,
    stats: adaptive.stats,
    acceptedStandardPreserved: preserved,
    baselineWithheld,
    standard: labelled ? scoreFrames(standard, signal.notes) : null,
    experimental: labelled ? scoreFrames(adaptive.pitch, signal.notes) : null,
    standardResponse: discrete ? onsetResponse(standard, signal.notes) : null,
    experimentalResponse: discrete
      ? onsetResponse(adaptive.pitch, signal.notes)
      : null,
    boundaryMetrics: discrete
      ? matchBoundaries(
          adaptive.boundaries.map((b) => b.centreSample / 22050),
          reference,
        )
      : null,
    boundaryProposals: adaptive.boundaries.length,
    segmentBoundaryMetrics: discrete
      ? matchBoundaries(
          adaptive.boundaries
            .filter((b) => b.usedForSegmentation)
            .map((b) => b.centreSample / 22050),
          reference,
        )
      : null,
    unresolvedGateCounts: adaptive.decisions
      .filter((d) => d.status === "unresolved" || d.status === "disagreement")
      .reduce<Record<string, number>>((counts, d) => {
        for (const code of d.unresolvedReasons)
          counts[code] = (counts[code] ?? 0) + 1;
        return counts;
      }, {}),
    newlyAccepted: labelled
      ? scoreFrames(
          adaptive.pitch,
          signal.notes,
          adaptive.pitch.frames.filter(
            (f, i) =>
              f.frequency !== null && standard.frames[i].frequency === null,
          ),
        )
      : null,
    retainedChanges: standard.frames.flatMap((f, i) =>
      f.frequency !== null && f.frequency !== adaptive.pitch.frames[i].frequency
        ? [
            {
              time: f.time,
              standard: f.frequency,
              experimental: adaptive.pitch.frames[i].frequency,
            },
          ]
        : [],
    ),
    memory: {
      heapDeltaBytes: after.heapUsed - before.heapUsed,
      arrayBufferDeltaBytes: after.arrayBuffers - before.arrayBuffers,
      processPeakRssKiB: process.resourceUsage().maxRSS,
      comparisonJsonBytes: Buffer.byteLength(JSON.stringify(adaptive)),
    },
    decisionCounts: adaptive.decisions.reduce<Record<string, number>>(
      (m, d) => {
        m[d.reason] = (m[d.reason] ?? 0) + 1;
        return m;
      },
      {},
    ),
  });
  save();
  console.log(
    signal.id,
    standard.usableFrames,
    adaptive.pitch.usableFrames,
    "recovered",
    adaptive.stats.recovered,
  );
}
const historical = JSON.parse(
  readFileSync("docs/data/fast-pitch/synthetic.json", "utf8"),
);
for (const s of process.argv.includes("--real-only") ? [] : syntheticCases()) {
  evaluate(s, "development-baseline");
  const last = rows.at(-1) as {
    standard: { correct: number; wrong: number; withheld: number };
  };
  const previous = historical.find((r: { id: string }) => r.id === s.id).rows[0]
    .allFrames;
  if (
    ["correct", "wrong", "withheld"].some(
      (k) => last.standard[k as keyof typeof last.standard] !== previous[k],
    )
  )
    throw new Error(`2D.1 reproduction failed: ${s.id}`);
}
for (const s of process.argv.includes("--real-only") ? [] : extraCases())
  evaluate(s, "regression");
// No parameter changes permitted in response to these held-out results for this version.
for (const s of process.argv.includes("--real-only") ? [] : heldOutCases())
  evaluate(s, "previous-evaluation");
for (const s of process.argv.includes("--real-only")
  ? []
  : heldOutRecoveryCases())
  evaluate(s, "held-out");
for (const [key, id, hash] of [
  [
    "STRINGMENTOR_BACH_PATH",
    "bach",
    "109a8bf5d75dc11f3bc80bba170c4d1f27a14ec3999fa30bdcbba478b61c2082",
  ],
  [
    "STRINGMENTOR_CELLO_SAMPLE_PATH",
    "open-strings",
    "6da88d0b66109e476222d85b1334b53b8e183f99d1de44a1bb70c17e556e07fc",
  ],
  [
    "STRINGMENTOR_CELLO_V2_PATH",
    "open-strings-v2",
    "480019bc9d5d409167bc5723ff95e32552e835ce601a079b344f0984efd121a6",
  ],
]) {
  const path = process.env[key];
  if (!path) {
    output[`${id}Unavailable`] = true;
    save();
    continue;
  }
  if (createHash("sha256").update(readFileSync(path)).digest("hex") !== hash)
    throw new Error(`Unexpected ${id} audio hash`);
  const bytes = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      path,
      "-ar",
      "22050",
      "-ac",
      "2",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  const values = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const channels = [
    new Float32Array(values.length / 2),
    new Float32Array(values.length / 2),
  ];
  channels.forEach((c, k) => {
    for (let i = 0; i < c.length; i++) c[i] = values[2 * i + k];
  });
  const notes =
    id === "open-strings"
      ? [
          { start: 1.4, end: 4.2, frequency: 65.40639132514966 },
          { start: 4.6, end: 7.5, frequency: 97.99885899543733 },
          { start: 7.9, end: 10.6, frequency: 146.8323839587038 },
          { start: 11.3, end: 13.7, frequency: 220 },
        ]
      : [];
  evaluate(
    {
      id,
      samples: mixToMono(channels),
      notes,
      texture: notes.length ? "continuous-motion" : "unlabelled",
    },
    "private-real",
  );
  const last = rows.at(-1) as { frames: number; standardCoverage: number };
  if (
    id === "bach" &&
    (last.frames !== 919 || Math.round(last.standardCoverage * 919) !== 214)
  )
    throw new Error("Bach baseline mismatch");
}
save();
