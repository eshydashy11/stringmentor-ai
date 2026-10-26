import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  CREPE_GATE,
  gateCrepe,
  scoreAligned,
  coverage,
  transitionResponse,
  type AlignedCase,
} from "./metrics.ts";
import { quantile } from "../lib/fast-pitch-audit.ts";
const root = "work/crepe/run";
function ffmpegVersion() {
  try {
    return execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split(
      "\n",
    )[0];
  } catch {
    return null;
  }
}
const manifestBytes = readFileSync(`${root}/manifest.json`),
  manifestHash = createHash("sha256").update(manifestBytes).digest("hex");
const manifest = JSON.parse(manifestBytes.toString()) as {
  cases: AlignedCase[];
  [key: string]: unknown;
};
type Baseline = {
  id: string;
  standard: (number | null)[];
  experimental: (number | null)[];
  timing: {
    standardMs: number;
    experimentalTotalMs: number;
    experimentalAdditionalMs: number;
    standardCpuMs: number;
    experimentalTotalCpuMs: number;
  }[];
  processPeakRssKiB: number;
};
type NeuralCase = {
  id: string;
  frequency: (number | null)[];
  confidence: number[];
  maxAlignmentErrorSeconds: number;
  timing: { totalMs: number; cpuMs: number; [key: string]: unknown };
  processPeakRssKiB: number;
};
const baseline = JSON.parse(readFileSync(`${root}/baseline.json`, "utf8")) as {
  cases: Baseline[];
};
const networks = Object.fromEntries(
  ["tiny", "full"].map((model) => {
    const result = JSON.parse(
      readFileSync(`${root}/${model}.json`, "utf8"),
    ) as {
      cases: NeuralCase[];
      completed?: boolean;
      manifestSha256: string;
      [key: string]: unknown;
    };
    if (!result.completed || result.manifestSha256 !== manifestHash)
      throw new Error(
        `Incomplete or stale ${model} run; do not publish partial accuracy`,
      );
    if (result.cases.length !== manifest.cases.length)
      throw new Error(`${model} corpus incomplete`);
    return [model, result];
  }),
);
const methods = ["standard", "experimental", "tiny", "full"] as const;
type Method = (typeof methods)[number];
const allFrequencies: Record<Method, (number | null)[][]> = {
  standard: [],
  experimental: [],
  tiny: [],
  full: [],
};
const rows = manifest.cases.map((c, index) => {
  const b = baseline.cases.find((r) => r.id === c.id);
  if (!b) throw new Error(`Missing ${c.id}`);
  const scores: Record<string, unknown> = {};
  for (const method of methods) {
    const neural =
      method === "tiny" || method === "full"
        ? networks[method].cases.find((r) => r.id === c.id)
        : undefined;
    if ((method === "tiny" || method === "full") && !neural)
      throw new Error(`Missing neural ${c.id}`);
    if (neural && neural.maxAlignmentErrorSeconds > 1 / 32000 + 1e-9)
      throw new Error("Grid misalignment");
    const gated = neural
      ? gateCrepe(neural.frequency, neural.confidence, c.rms)
      : null;
    const f =
      method === "standard"
        ? b.standard
        : method === "experimental"
          ? b.experimental
          : gated!.frequency;
    if (f.length !== c.times.length)
      throw new Error(`Misaligned ${method}/${c.id}`);
    allFrequencies[method][index] = f;
    const metrics = scoreAligned(f, c.targets);
    const timing = neural
      ? neural.timing
      : {
          totalMs: quantile(
            b.timing.map((t) =>
              method === "standard" ? t.standardMs : t.experimentalTotalMs,
            ),
            0.5,
          )!,
          cpuMs: quantile(
            b.timing.map((t) =>
              method === "standard"
                ? t.standardCpuMs
                : t.experimentalTotalCpuMs,
            ),
            0.5,
          )!,
          runs: b.timing,
        };
    scores[method] = {
      labelled: metrics.total ? metrics : null,
      coverage: coverage(f),
      transitionResponse:
        c.group !== "private-real" && c.notes.length > 1
          ? transitionResponse(c.times, f, c.notes)
          : null,
      timing,
      rejections: gated?.rejections ?? null,
      labelledRegions:
        c.group === "private-real" && c.notes.length
          ? c.notes.map((note) => ({
              ...note,
              metrics: scoreAligned(
                f.filter(
                  (_, i) => c.times[i] >= note.start && c.times[i] < note.end,
                ),
                c.targets.filter(
                  (_, i) => c.times[i] >= note.start && c.times[i] < note.end,
                ),
              ),
            }))
          : null,
      wrongAcceptedAtConfidence09:
        neural && metrics.total
          ? f.filter(
              (frequency, i) =>
                frequency !== null &&
                c.targets[i] !== null &&
                Math.abs(1200 * Math.log2(frequency / c.targets[i]!)) > 50 &&
                neural.confidence[i] >= 0.9,
            ).length
          : null,
    };
  }
  return {
    id: c.id,
    group: c.group,
    texture: c.texture,
    duration: c.duration,
    pcmSha256: c.pcmSha256,
    sourceHash: c.sourceHash,
    frames: c.times.length,
    labelledFrames: c.targets.filter((f) => f !== null).length,
    methods: scores,
  };
});
const aggregate = (
  include: (c: AlignedCase) => boolean,
  threshold = CREPE_GATE.confidence as number,
) =>
  Object.fromEntries(
    methods.map((method) => {
      const chosen = manifest.cases
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => include(c));
      const frequencies = chosen.flatMap(({ c, i }) => {
        if (method === "standard" || method === "experimental")
          return allFrequencies[method][i];
        const raw = networks[method].cases.find((r) => r.id === c.id)!;
        return gateCrepe(raw.frequency, raw.confidence, c.rms, threshold)
          .frequency;
      });
      const targets = chosen.flatMap(({ c }) => c.targets);
      const time = chosen.reduce(
        (sum, { i }) =>
          sum +
          (rows[i].methods[method] as { timing: { totalMs: number } }).timing
            .totalMs,
        0,
      );
      const cpu = chosen.reduce(
        (sum, { i }) =>
          sum +
          (rows[i].methods[method] as { timing: { cpuMs: number } }).timing
            .cpuMs,
        0,
      );
      const duration = chosen.reduce((sum, { c }) => sum + c.duration, 0);
      return [
        method,
        {
          ...scoreAligned(frequencies, targets),
          audioDurationSeconds: duration,
          processingSeconds: time / 1000,
          cpuSeconds: cpu / 1000,
          realTimeFactor: time / 1000 / duration,
        },
      ];
    }),
  );
const synthetic = (c: AlignedCase) =>
  c.group !== "private-real" && c.targets.some((t) => t !== null);
const complementarity = (include: (c: AlignedCase) => boolean) =>
  Object.fromEntries(
    (["tiny", "full"] as const).map((method) => {
      const counts: Record<string, number> = {};
      const state = (f: number | null, target: number) =>
        f === null
          ? "withheld"
          : Math.abs(1200 * Math.log2(f / target)) <= 50
            ? "correct"
            : "wrong";
      manifest.cases.forEach((c, index) => {
        if (!include(c)) return;
        c.targets.forEach((target, i) => {
          if (target === null) return;
          const key = `standard-${state(allFrequencies.standard[index][i], target)}_crepe-${state(allFrequencies[method][index][i], target)}`;
          counts[key] = (counts[key] ?? 0) + 1;
        });
      });
      return [method, counts];
    }),
  );
const browserPath = `${root}/browser.json`;
const browser = existsSync(browserPath)
  ? JSON.parse(readFileSync(browserPath, "utf8"))
  : {
      completed: false,
      reason: "Browser harness not run",
      physicalMobileTested: false,
    };
if (browser.completed && browser.manifestSha256 !== manifestHash)
  throw new Error("Stale browser comparison; rerun browser harness");
const modelInfo = Object.fromEntries(
  methods
    .filter((m) => m === "tiny" || m === "full")
    .map((method) => {
      const { cases: _cases, ...metadata } = networks[method];
      void _cases;
      return [method, metadata];
    }),
);
const output = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  productionSourceCommit: manifest.sourceCommit,
  productionSourceSha256: Object.fromEntries(
    [
      "src/lib/pitch.ts",
      "src/lib/pitch-candidates.ts",
      "src/lib/experimental-pitch.ts",
      "src/lib/experimental-evidence.ts",
      "src/lib/experimental-boundaries.ts",
    ].map((p) => [
      p,
      createHash("sha256").update(readFileSync(p)).digest("hex"),
    ]),
  ),
  corpus: {
    manifestSha256: manifestHash,
    caseCount: rows.length,
    sampleRate: manifest.sampleRate,
    grid: manifest.grid,
    host: manifest.host,
    ffmpegVersion: ffmpegVersion(),
    experimentalVersion: manifest.experimentalVersion,
    unavailable: manifest.unavailable,
  },
  protocol: {
    correctToleranceCents: 50,
    octaveError:
      "Wrong estimate within 50 cents of any nonzero whole octave relative to the reference",
    crepeGates: CREPE_GATE,
    thresholdSelection:
      "Fixed before examining accuracy; no confidence calibration or threshold tuning",
    commonRmsWindow: 4096,
    crepeNativeSampleRate: 16000,
    crepeWindow: 1024,
    maximumAlignmentErrorSeconds: Math.max(
      ...["tiny", "full"].flatMap((m) =>
        networks[m].cases.map((c) => c.maxAlignmentErrorSeconds),
      ),
    ),
    labelledRealRegions:
      "V1 sustained-note identity intervals, not precise tuning or onset labels",
    timing:
      "Offline shared CPU host; one JS thread or one torch thread; no decode or disk input time. Standard/Experimental: median of two warmed runs per case; CREPE: one warmed pass including resample/frame preparation, inference and decoding. Experimental total includes its required Standard pass; optional tone cue annotations are excluded. Timings include scheduling effects; CPU time is also reported.",
  },
  summary: {
    labelledSynthetic: aggregate(synthetic),
    allLabelled: aggregate((c) => c.targets.some((t) => t !== null)),
    unpitched: rows.filter((r) => r.texture === "unpitched"),
  },
  thresholdSensitivity: [0, 0.3, 0.5, 0.7, 0.9].map((confidence) => ({
    confidence,
    results: aggregate(synthetic, confidence),
  })),
  complementarity: {
    labelledSynthetic: complementarity(synthetic),
    allLabelled: complementarity((c) => c.targets.some((t) => t !== null)),
  },
  realThresholdSensitivity: [0, 0.3, 0.5, 0.7, 0.9].map((confidence) => ({
    confidence,
    results: aggregate((c) => c.id === "open-strings-v1", confidence),
  })),
  modelInfo,
  browser,
  browserConcurrentRun: existsSync(`${root}/browser-contended.json`)
    ? {
        context:
          "Full native inference and a Next production build were concurrent; retained to show timing sensitivity, not used as the quiescent browser headline.",
        ...JSON.parse(readFileSync(`${root}/browser-contended.json`, "utf8")),
      }
    : null,
  cases: rows,
};
mkdirSync("docs/data/crepe-benchmark", { recursive: true });
writeFileSync(
  "docs/data/crepe-benchmark/results.json",
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify(output.summary.labelledSynthetic, null, 2));
