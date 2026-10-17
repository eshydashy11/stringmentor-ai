/** Reproducible Phase 2D.1 experiment. Does not modify production settings. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, arch } from "node:os";
import { resolve, join } from "node:path";
import {
  analysePitch,
  CELLO_CONFIG,
  mixToMono,
  type PitchConfig,
  type PitchResult,
} from "../src/lib/pitch.ts";
import { analyseTone } from "../src/lib/tone.ts";
import { trackCandidates } from "../src/lib/pitch-candidates.ts";
import {
  fluxAssociation,
  fluxPeaks,
  increment,
  matchBoundaries,
  onsetResponse,
  quantile,
  rejectionAudit,
  scoreFrames,
  syntheticCases,
} from "./lib/fast-pitch-audit.ts";

const output = resolve(
  process.argv[process.argv.indexOf("--output") + 1] &&
    process.argv.includes("--output")
    ? process.argv[process.argv.indexOf("--output") + 1]
    : "work/fast-pitch",
);
const repeats = Number(process.env.AUDIT_REPEATS ?? 3);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5)
  throw new Error("AUDIT_REPEATS must be an integer from 1 to 5.");
mkdirSync(output, { recursive: true });
const save = (name: string, value: unknown) =>
  writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const windows = [4096, 2048, 1024];
function timed(samples: Float32Array, config: PitchConfig) {
  // First call per signal/config warms JIT/allocation paths; never included in timing.
  let result = analysePitch(samples, config);
  const runsMs: number[] = [];
  for (let i = 0; i < repeats; i++) {
    const start = performance.now();
    result = analysePitch(samples, config);
    runsMs.push(performance.now() - start);
  }
  const medianMs = quantile(runsMs, 0.5)!;
  return {
    result,
    timing: {
      runsMs,
      medianMs,
      realtimeFactor: medianMs / ((samples.length / config.sampleRate) * 1000),
    },
  };
}
function decode(path: string) {
  const metadata = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=index,codec_name,sample_rate,channels,duration",
        "-of",
        "json",
        path,
      ],
      { encoding: "utf8" },
    ),
  );
  const channelCount = Number(
    metadata.streams.find((s: { channels?: number }) => s.channels)?.channels,
  );
  if (!channelCount || channelCount > 8)
    throw new Error("Expected 1–8 audio channels.");
  const bytes = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      path,
      "-ar",
      String(CELLO_CONFIG.sampleRate),
      "-ac",
      String(channelCount),
      "-f",
      "f32le",
      "pipe:1",
    ],
    { maxBuffer: 128 * 1024 * 1024 },
  );
  const interleaved = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const channels = Array.from(
    { length: channelCount },
    () => new Float32Array(interleaved.length / channelCount),
  );
  channels.forEach((c, index) => {
    for (let i = 0; i < c.length; i++)
      c[i] = interleaved[i * channelCount + index];
  });
  const samples = mixToMono(channels);
  return {
    samples,
    provenance: {
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      metadata,
      decodedSamples: samples.length,
      decodedSeconds: samples.length / CELLO_CONFIG.sampleRate,
      decoding:
        "FFmpeg f32le at 22050 Hz; preserve channel count; production mixToMono. No normalisation. Browser resampling can differ.",
    },
  };
}
function realRow(
  result: PitchResult,
  timing: ReturnType<typeof timed>["timing"],
) {
  const tone = analyseTone(realAudio!.samples, result.frames);
  const eventKinds: Record<string, number> = {};
  tone.events.forEach((e) => increment(eventKinds, e.kind));
  return {
    windowSize: result.config.windowSize,
    frames: result.frames.length,
    usable: result.usableFrames,
    coverage: result.coverage,
    nonQuietCoverage:
      result.usableFrames /
      result.frames.filter((f) => f.rejection !== "silence").length,
    timing,
    rejections: rejectionAudit(result),
    fluxAssociation: fluxAssociation(result, tone),
    tone: {
      events: tone.events,
      eventKinds,
      fluxPeaks: fluxPeaks(tone),
      fluxThreshold: tone.fluxThreshold,
    },
    accuracy: null,
    onsetError: null,
  };
}

const realPath = process.env.STRINGMENTOR_BACH_PATH;
const realAudio = realPath ? decode(realPath) : null;
const metadata = {
  schema: "stringmentor-fast-pitch-audit-v1",
  generatedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  node: process.version,
  platform: platform(),
  arch: arch(),
  cpu: cpus()[0]?.model,
  logicalCpus: cpus().length,
  ffmpeg: execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split(
    "\n",
  )[0],
  repeats,
  config: CELLO_CONFIG,
  windows,
  realAudio: realAudio?.provenance ?? null,
  protocol: {
    correctToleranceCents: 50,
    onsetToleranceSeconds: 0.05,
    hopHeldFixed: true,
    accuracyForUnlabelledAudio: false,
    timingExcludes:
      "warmup, decode, tone, disk IO; Node wall-clock analysis time; no concurrent benchmarks",
    commonGrid:
      "Frame centres present in the 4096 run; same 512-sample hop for all sizes",
    syntheticInterference:
      "The active oscillator is the target; resonance-tail matches are not evidence that real acoustic overlap has a uniquely recoverable fundamental.",
  },
};
save("metadata.json", metadata);
const synthetic = [];
for (const signal of syntheticCases()) {
  const rows = [];
  const commonEnd =
    (Math.floor((signal.samples.length - 4096) / 512) * 512 + 2048) /
    CELLO_CONFIG.sampleRate;
  for (const windowSize of windows) {
    const { result, timing } = timed(signal.samples, {
      ...CELLO_CONFIG,
      windowSize,
    });
    const common = result.frames.filter(
      (f) => f.time >= 2048 / CELLO_CONFIG.sampleRate && f.time <= commonEnd,
    );
    const tone = analyseTone(signal.samples, result.frames);
    const truth = signal.notes.slice(1).map((n) => n.start);
    rows.push({
      windowSize,
      timing,
      allFrames: scoreFrames(result, signal.notes),
      commonFrames: scoreFrames(result, signal.notes, common),
      onsetResponse: onsetResponse(result, signal.notes),
      rejections: rejectionAudit(result),
      boundaries: {
        fluxThreshold: tone.fluxThreshold,
        fluxMaximum: Math.max(...tone.frames.map((f) => f.flux ?? 0)),
        fluxMedian: quantile(
          tone.frames.flatMap((f) => (f.flux === null ? [] : [f.flux])),
          0.5,
        ),
        existingEvents: matchBoundaries(
          tone.events.map((e) => e.time),
          truth,
        ),
        fluxPeaks: matchBoundaries(fluxPeaks(tone), truth),
        eventNote:
          "All acoustic proposals, not only note-change classifications; one-to-one matching at ±50 ms. Flux peak extraction is audit-only.",
      },
    });
  }
  synthetic.push({
    id: signal.id,
    texture: signal.texture,
    duration: signal.samples.length / CELLO_CONFIG.sampleRate,
    notes: signal.notes,
    rows,
  });
  save("synthetic.json", synthetic);
  console.log(`Completed synthetic ${signal.id}`);
}
if (realAudio) {
  const real = [];
  let baseline: PitchResult | null = null;
  const perWindow: PitchResult[] = [];
  for (const windowSize of windows) {
    const { result, timing } = timed(realAudio.samples, {
      ...CELLO_CONFIG,
      windowSize,
    });
    if (windowSize === 4096) baseline = result;
    perWindow.push(result);
    real.push(realRow(result, timing));
    console.log(
      `Completed Bach window ${windowSize}: ${result.usableFrames}/${result.frames.length}`,
    );
  }
  const acceptedAt = perWindow.map(
    (r) =>
      new Map(
        r.frames.map((f) => [Math.round(f.time * CELLO_CONFIG.sampleRate), f]),
      ),
  );
  const paired = baseline!.frames.map((f) =>
    acceptedAt.map((m) => m.get(Math.round(f.time * CELLO_CONFIG.sampleRate))!),
  );
  const recovery = [1, 2].map((i) => ({
    windowSize: windows[i],
    pairedFrames: paired.length,
    recoveredFromBaselineGap: paired.filter(
      (p) => p[0].frequency === null && p[i].frequency !== null,
    ).length,
    lostBaselineAccepted: paired.filter(
      (p) => p[0].frequency !== null && p[i].frequency === null,
    ).length,
    bothAccepted: paired.filter(
      (p) => p[0].frequency !== null && p[i].frequency !== null,
    ).length,
    bothAcceptedDisagreeOver50Cents: paired.filter(
      (p) =>
        p[0].frequency !== null &&
        p[i].frequency !== null &&
        Math.abs(1200 * Math.log2(p[0].frequency! / p[i].frequency!)) > 50,
    ).length,
  }));
  // Range sensitivity is explicitly an offline counterfactual, never a production setting.
  const wider = analysePitch(realAudio.samples, {
    ...CELLO_CONFIG,
    minFrequency: 35,
    maxFrequency: 1500,
  });
  const rangeSensitivity = {
    limitsHz: [35, 1500],
    coverage: wider.coverage,
    acceptedOutsideProductionRange: wider.frames.filter(
      (f) => f.frequency !== null && (f.frequency < 55 || f.frequency > 1000),
    ).length,
    baselineGapsAcceptedOutsideProductionRange: wider.frames.filter(
      (f, i) =>
        baseline!.frames[i].frequency === null &&
        f.frequency !== null &&
        (f.frequency < 55 || f.frequency > 1000),
    ).length,
    caution:
      "Changed candidate competition and unverified estimates: not an accuracy measurement or suggested range change.",
  };
  const withoutNeighbours = trackCandidates(
    baseline!.frames.map((f) => ({
      candidates: f.diagnostics!.candidates,
      quiet: f.rejection === "silence",
    })),
    { ...CELLO_CONFIG, neighbourFrames: 0 },
  );
  const neighbourSensitivity = {
    acceptedWithoutNeighbours: withoutNeighbours.filter((d) => d.candidate)
      .length,
    acceptedWithNeighbours: baseline!.usableFrames,
    rescuedByNeighbours: withoutNeighbours.filter(
      (d, i) => !d.candidate && baseline!.frames[i].frequency !== null,
    ).length,
    lostWithNeighbours: withoutNeighbours.filter(
      (d, i) => d.candidate && baseline!.frames[i].frequency === null,
    ).length,
    caution:
      "Same current-frame candidates; only bounded neighbour bonus disabled offline. No accuracy claim.",
  };
  save("real.json", {
    provenance: realAudio.provenance,
    rows: real,
    pairedRecovery: recovery,
    rangeSensitivity,
    neighbourSensitivity,
  });
  const header =
    "window,time,frequency,rawFrequency,rejection,tracker,margin,rms,topFrequency,topSupport,topPeriodicity,runnerFrequency,runnerSupport";
  const csv = perWindow.flatMap((r) =>
    r.frames.map((f) =>
      [
        r.config.windowSize,
        f.time,
        f.frequency ?? "",
        f.diagnostics!.rawFrequency ?? "",
        f.rejection ?? "accepted",
        f.diagnostics!.decision,
        f.diagnostics!.margin,
        f.rms,
        f.diagnostics!.candidates[0]?.frequency ?? "",
        f.diagnostics!.candidates[0]?.support ?? "",
        f.diagnostics!.candidates[0]?.periodicity ?? "",
        f.diagnostics!.candidates[1]?.frequency ?? "",
        f.diagnostics!.candidates[1]?.support ?? "",
      ].join(","),
    ),
  );
  writeFileSync(
    join(output, "real-frames.csv"),
    [header, ...csv].join("\n") + "\n",
  );
  const tone = analyseTone(realAudio.samples, baseline!.frames);
  writeFileSync(
    join(output, "real-tone.csv"),
    [
      "time,dbfs,flux,centroid,flatness",
      ...tone.frames.map((f) =>
        [f.time, f.dbfs, f.flux ?? "", f.centroid ?? "", f.flatness ?? ""].join(
          ",",
        ),
      ),
    ].join("\n") + "\n",
  );
} else
  console.log(
    "Bach audio unavailable: completed synthetic/source audit only; no real-audio claims.",
  );
// Optional prior open-string control: labels identify note regions, not exact Hz or onsets.
if (process.env.STRINGMENTOR_CELLO_SAMPLE_PATH) {
  const control = decode(process.env.STRINGMENTOR_CELLO_SAMPLE_PATH);
  if (
    control.provenance.sha256 !==
    "6da88d0b66109e476222d85b1334b53b8e183f99d1de44a1bb70c17e556e07fc"
  )
    throw new Error(
      "The open-string control labels belong only to the original supplied V1 sample.",
    );
  const labels = [
    { start: 1.4, end: 4.2, frequency: 65.40639132514966 },
    { start: 4.6, end: 7.5, frequency: 97.99885899543733 },
    { start: 7.9, end: 10.6, frequency: 146.8323839587038 },
    { start: 11.3, end: 13.7, frequency: 220 },
  ];
  const rows = windows.map((windowSize) => {
    const { result, timing } = timed(control.samples, {
      ...CELLO_CONFIG,
      windowSize,
    });
    return {
      windowSize,
      timing,
      labelledRegions: labels.map((label) => ({
        label,
        scores: scoreFrames(
          result,
          [label],
          result.frames.filter(
            (f) => f.time >= label.start && f.time < label.end,
          ),
        ),
      })),
    };
  });
  save("sustained-control.json", {
    provenance: control.provenance,
    caveat:
      "Known open-string note identity at ±50 cents from equal temperament, not independent cents accuracy or onset labels.",
    rows,
  });
  console.log("Completed original open-string control across window sizes");
}
console.log(`Audit complete: ${output}`);
