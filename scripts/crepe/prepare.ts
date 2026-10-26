/** Offline CREPE corpus export. Never imported by the production application. */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpus, totalmem } from "node:os";
import { analysePitch, mixToMono } from "../../src/lib/pitch.ts";
import {
  analyseExperimentalPitch,
  EXPERIMENTAL_VERSION,
} from "../../src/lib/experimental-pitch.ts";
import { syntheticCases, type SignalCase } from "../lib/fast-pitch-audit.ts";
import {
  extraCases,
  heldOutCases,
  heldOutRecoveryCases,
} from "../lib/experimental-cases.ts";

const directory = "work/crepe/run";
mkdirSync(directory, { recursive: true });
for (const file of [
  "tiny.json",
  "full.json",
  "browser.json",
  "browser-contended.json",
])
  rmSync(`${directory}/${file}`, { force: true });
const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const cases: (SignalCase & { group: string; sourceHash?: string })[] = [
  ...syntheticCases().map((s) => ({ ...s, group: "development-synthetic" })),
  ...extraCases().map((s) => ({ ...s, group: "regression-synthetic" })),
  ...heldOutCases().map((s) => ({
    ...s,
    group: "previous-evaluation-synthetic",
  })),
  ...heldOutRecoveryCases().map((s) => ({
    ...s,
    group: "frozen-evaluation-synthetic",
  })),
];
const unavailable: { id: string; reason: string }[] = [];
for (const [key, id, expectedHash] of [
  [
    "STRINGMENTOR_CELLO_SAMPLE_PATH",
    "open-strings-v1",
    "6da88d0b66109e476222d85b1334b53b8e183f99d1de44a1bb70c17e556e07fc",
  ],
  [
    "STRINGMENTOR_CELLO_V2_PATH",
    "open-strings-v2",
    "480019bc9d5d409167bc5723ff95e32552e835ce601a079b344f0984efd121a6",
  ],
  [
    "STRINGMENTOR_BACH_PATH",
    "bach",
    "109a8bf5d75dc11f3bc80bba170c4d1f27a14ec3999fa30bdcbba478b61c2082",
  ],
  ["STRINGMENTOR_BEETHOVEN_PATH", "beethoven", null],
] as const) {
  const path = process.env[key];
  if (!path) {
    unavailable.push({
      id,
      reason: `${key} not provided; recording was not analysed.`,
    });
    continue;
  }
  const sourceHash = hash(readFileSync(path));
  if (expectedHash && sourceHash !== expectedHash)
    throw new Error(`Unexpected ${id} file hash`);
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
    { maxBuffer: 64 * 1024 * 1024 },
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
    id === "open-strings-v1"
      ? [
          { start: 1.4, end: 4.2, frequency: 65.40639132514966 },
          { start: 4.6, end: 7.5, frequency: 97.99885899543733 },
          { start: 7.9, end: 10.6, frequency: 146.8323839587038 },
          { start: 11.3, end: 13.7, frequency: 220 },
        ]
      : [];
  cases.push({
    id,
    samples: mixToMono(channels),
    notes,
    texture: notes.length ? "labelled-sustained-regions" : "unlabelled",
    group: "private-real",
    sourceHash,
  });
}
// Fixed before CREPE results: two timed runs after a separate warm-up; single-thread JS.
const warm = cases.find((c) => c.id === "sustain-50")!;
analyseExperimentalPitch(warm.samples, analysePitch(warm.samples));
const manifestCases: unknown[] = [];
const baselineCases: unknown[] = [];
for (const signal of cases) {
  const pcm = Buffer.from(
    signal.samples.buffer,
    signal.samples.byteOffset,
    signal.samples.byteLength,
  );
  writeFileSync(`${directory}/${signal.id}.f32`, pcm);
  const runs = [];
  let standard!: ReturnType<typeof analysePitch>,
    experimental!: ReturnType<typeof analyseExperimentalPitch>;
  for (let repeat = 0; repeat < 2; repeat++) {
    const before = process.cpuUsage(),
      start = performance.now();
    const s = analysePitch(signal.samples);
    const standardMs = performance.now() - start,
      standardCpu = process.cpuUsage(before);
    const cpu = process.cpuUsage(),
      second = performance.now();
    // Phase 2B's optional annotation only changes boundary cue text, not decisions.
    const e = analyseExperimentalPitch(signal.samples, s);
    const additionalMs = performance.now() - second,
      additionalCpu = process.cpuUsage(cpu);
    if (
      repeat &&
      JSON.stringify(s.frames.map((f) => f.frequency)) !==
        JSON.stringify(standard.frames.map((f) => f.frequency))
    )
      throw new Error("Non-deterministic Standard output");
    if (
      repeat &&
      JSON.stringify(e.pitch.frames.map((f) => f.frequency)) !==
        JSON.stringify(experimental.pitch.frames.map((f) => f.frequency))
    )
      throw new Error("Non-deterministic Experimental output");
    standard = s;
    experimental = e;
    runs.push({
      standardMs,
      experimentalAdditionalMs: additionalMs,
      experimentalTotalMs: standardMs + additionalMs,
      standardCpuMs: (standardCpu.user + standardCpu.system) / 1000,
      experimentalTotalCpuMs:
        (standardCpu.user +
          standardCpu.system +
          additionalCpu.user +
          additionalCpu.system) /
        1000,
    });
  }
  const centres = standard.frames.map((_, i) => 2048 + 512 * i);
  const times = centres.map((c) => c / 22050);
  // Per-centre truth avoids serializing 44,100 tiny interval labels for continuous motion.
  const targets = times.map(
    (t) =>
      signal.notes.find((n) => t >= n.start && t < n.end)?.frequency ?? null,
  );
  manifestCases.push({
    id: signal.id,
    group: signal.group,
    texture: signal.texture,
    duration: standard.duration,
    sampleRate: 22050,
    pcmFile: `${signal.id}.f32`,
    pcmSha256: hash(pcm),
    sourceHash: signal.sourceHash ?? null,
    centres,
    times,
    targets,
    rms: standard.frames.map((f) => f.rms),
    notes: signal.texture === "continuous-motion" ? [] : signal.notes,
  });
  baselineCases.push({
    id: signal.id,
    standard: standard.frames.map((f) => f.frequency),
    experimental: experimental.pitch.frames.map((f) => f.frequency),
    standardRejections: standard.frames.map((f) => f.rejection ?? null),
    experimentalRejections: experimental.decisions.map(
      (d) => d.unresolvedReasons,
    ),
    timing: runs,
    processPeakRssKiB: process.resourceUsage().maxRSS,
  });
  console.log(
    signal.id,
    standard.frames.length,
    standard.usableFrames,
    experimental.pitch.usableFrames,
  );
}
const manifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  experimentalVersion: EXPERIMENTAL_VERSION,
  sampleRate: 22050,
  grid: { window: 4096, hop: 512, firstCentre: 2048 },
  repetitions: 2,
  unavailable,
  host: {
    node: process.version,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  cases: manifestCases,
};
writeFileSync(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2));
writeFileSync(
  `${directory}/baseline.json`,
  JSON.stringify({ schemaVersion: 1, cases: baselineCases }, null, 2),
);
