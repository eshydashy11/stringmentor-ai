import { PitchDetector } from "pitchy";
import {
  createHarmonicEstimator,
  trackCandidates,
  type PitchCandidate,
  type TrackingDecision,
} from "./pitch-candidates.ts";

/** Analysis settings use samples at the decoded analysis rate, not the source rate. */
export const CELLO_CONFIG = {
  sampleRate: 22050,
  windowSize: 4096, // 186 ms: >12 periods of C2, including detuning below it.
  hopSize: 512, // 23.2 ms; overlapping estimates are not independent measurements.
  minFrequency: 55,
  maxFrequency: 1000,
  minRms: 0.003, // approximately -50.5 dBFS; no automatic gain normalisation.
  minClarity: 0.9,
  peakThreshold: 0.97, // Raw baseline retained for diagnostics, not the final selector.
  tuningA4: 440,
  maxSpectralFrequency: 3000,
  spectralPeakFloor: 0.035,
  primitivePeakFloor: 0.06,
  maxCandidateDivisor: 16,
  maxHarmonic: 20,
  harmonicTolerance: 0.008,
  harmonicComplexityPenalty: 0.025,
  subharmonicPenalty: 0.2,
  minHarmonicSupport: 0.65,
  minCandidateScore: 0.6,
  minCandidatePeriodicity: 0.25,
  minCandidateMargin: 0.04,
  neighbourFrames: 3, // ±70 ms, bounded evidence bonus; never smooth F0.
  neighbourToleranceCents: 80,
  neighbourBonus: 0.05,
  rawRefinementCents: 15,
} as const;
export type PitchConfig = { [K in keyof typeof CELLO_CONFIG]: number };
export const MAX_ANALYSIS_SECONDS = 600;
export type Rejection =
  | "silence"
  | "low-confidence"
  | "out-of-range"
  | "unstable"
  | "ambiguous"
  | "weak-harmonics";
export type PitchFrame = {
  time: number;
  frequency: number | null;
  midi: number | null;
  note: string | null;
  cents: number | null;
  clarity: number;
  rms: number;
  rejection?: Rejection;
  diagnostics?: {
    rawFrequency: number | null;
    rawClarity: number;
    rawRejection?: Rejection;
    candidates: PitchCandidate[];
    decision: TrackingDecision["reason"];
    margin: number;
    corrected: boolean;
    selectedCandidate: number | null;
    detail: string;
  };
};
export type PitchResult = {
  frames: PitchFrame[];
  duration: number;
  config: PitchConfig;
  usableFrames: number;
  coverage: number;
  meanClarity: number;
  sufficient: boolean;
  observations: string[];
};
const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export function noteName(midi: number): string {
  const n = Math.round(midi);
  return `${NOTES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}
export function frequencyToPitch(frequency: number, tuningA4 = 440) {
  if (
    !Number.isFinite(frequency) ||
    frequency <= 0 ||
    !Number.isFinite(tuningA4) ||
    tuningA4 <= 0
  )
    throw new Error(
      "Frequency and tuning reference must be positive finite values.",
    );
  const midi = 69 + 12 * Math.log2(frequency / tuningA4);
  const nearestMidi = Math.round(midi);
  const reference = tuningA4 * 2 ** ((nearestMidi - 69) / 12);
  return {
    midi,
    nearestMidi,
    note: noteName(nearestMidi),
    reference,
    cents: 1200 * Math.log2(frequency / reference),
  };
}
export function validateConfig(config: PitchConfig) {
  if (
    Object.values(config).some((v) => !Number.isFinite(v)) ||
    config.sampleRate < 8000 ||
    config.sampleRate > 96000 ||
    !Number.isInteger(config.windowSize) ||
    config.windowSize < 512 ||
    config.windowSize > 16384 ||
    !Number.isInteger(config.hopSize) ||
    config.hopSize < 1 ||
    config.hopSize > config.windowSize ||
    config.minFrequency <= 0 ||
    config.maxFrequency <= config.minFrequency ||
    config.maxFrequency >= config.sampleRate / 2 ||
    config.minRms < 0 ||
    config.minClarity <= 0 ||
    config.minClarity > 1 ||
    config.peakThreshold <= 0 ||
    config.peakThreshold > 1 ||
    config.tuningA4 <= 0 ||
    (config.windowSize / config.sampleRate) * config.minFrequency < 2 ||
    config.maxSpectralFrequency <= config.maxFrequency ||
    config.maxSpectralFrequency >= config.sampleRate / 2 ||
    [
      config.spectralPeakFloor,
      config.primitivePeakFloor,
      config.harmonicTolerance,
      config.minHarmonicSupport,
      config.minCandidateScore,
      config.minCandidatePeriodicity,
      config.minCandidateMargin,
    ].some((v) => v <= 0 || v > 1) ||
    [
      config.harmonicComplexityPenalty,
      config.subharmonicPenalty,
      config.neighbourBonus,
    ].some((v) => v < 0 || v > 1) ||
    !Number.isInteger(config.maxCandidateDivisor) ||
    config.maxCandidateDivisor < 1 ||
    config.maxCandidateDivisor > 32 ||
    !Number.isInteger(config.maxHarmonic) ||
    config.maxHarmonic < 1 ||
    config.maxHarmonic > 40 ||
    !Number.isInteger(config.neighbourFrames) ||
    config.neighbourFrames < 0 ||
    config.neighbourFrames > 10 ||
    config.neighbourToleranceCents <= 0 ||
    config.rawRefinementCents < 0
  )
    throw new Error("Invalid pitch analysis settings.");
}

/** Average channels, except severe phase cancellation: use the highest-energy channel. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (!channels.length || channels.some((c) => c.length !== channels[0].length))
    throw new Error("The decoded audio channels are invalid.");
  const mono = new Float32Array(channels[0].length);
  const energies = channels.map(() => 0);
  let mixedEnergy = 0;
  for (let i = 0; i < mono.length; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) {
      const value = channels[c][i];
      if (!Number.isFinite(value))
        throw new Error("The decoded audio contains invalid samples.");
      sum += value;
      energies[c] += value * value;
    }
    mono[i] = sum / channels.length;
    mixedEnergy += mono[i] * mono[i];
  }
  const strongest = energies.indexOf(Math.max(...energies));
  if (mixedEnergy < energies[strongest] * 0.1) mono.set(channels[strongest]);
  return mono;
}

function timestamp(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
export function measuredObservations(
  frames: PitchFrame[],
  config: PitchConfig,
): string[] {
  const observations: string[] = [];
  const audible = frames.filter((f) => f.rejection !== "silence");
  const low = audible.filter((f) => f.rejection === "low-confidence");
  if (audible.length >= 10 && low.length / audible.length >= 0.25)
    observations.push(
      `${Math.round((100 * low.length) / audible.length)}% of non-quiet frames have low pitch clarity and were excluded.`,
    );
  // Conservative stable regions: same nearest note, >=1 s, <=12 cents total spread.
  // This describes measured regions only, with no diagnosis of technique or intent.
  const regions: PitchFrame[][] = [];
  let region: PitchFrame[] = [];
  const finish = () => {
    if ((region.length * config.hopSize) / config.sampleRate >= 1)
      regions.push(region);
    region = [];
  };
  for (const f of frames) {
    const evidence =
      f.diagnostics?.selectedCandidate != null
        ? f.diagnostics.candidates[f.diagnostics.selectedCandidate]
        : undefined;
    if (
      f.diagnostics &&
      (!evidence || evidence.support < 0.75 || f.diagnostics.margin < 0.08)
    ) {
      finish();
      continue;
    }
    if (f.cents === null || f.note !== region[0]?.note) finish();
    if (f.cents !== null) {
      if (region.length && Math.abs(f.cents - region[0].cents!) > 12) finish();
      region.push(f);
    }
  }
  finish();
  const stable = regions.filter(
    (r) =>
      Math.max(...r.map((f) => f.cents!)) -
        Math.min(...r.map((f) => f.cents!)) <=
      12,
  );
  for (const direction of [1, -1]) {
    const matching = stable.filter((r) => {
      const mean = r.reduce((sum, f) => sum + f.cents!, 0) / r.length;
      return mean * direction >= 8 && mean * direction <= 35;
    });
    if (matching.length)
      observations.push(
        `${matching.length} stable measured region${matching.length === 1 ? "" : "s"} (at least 1 second each), first around ${timestamp(matching[0][0].time)}, average 8–35 cents ${direction > 0 ? "above" : "below"} the nearest equal-tempered reference. This does not establish musical correctness.`,
      );
  }
  return observations;
}

/** Runs in a Worker in production. No audio, results, or telemetry leave the device. */
export function analysePitch(
  samples: Float32Array,
  config: PitchConfig = { ...CELLO_CONFIG },
  onProgress: (fraction: number) => void = () => {},
): PitchResult {
  validateConfig(config);
  if (
    !samples.length ||
    samples.length / config.sampleRate > MAX_ANALYSIS_SECONDS
  )
    throw new Error(
      "Choose non-empty audio of ten minutes or less for this initial analysis version.",
    );
  const detector = PitchDetector.forFloat32Array(config.windowSize);
  detector.clarityThreshold = config.peakThreshold;
  const estimateHarmonics = createHarmonicEstimator(config);
  const buffer = new Float32Array(config.windowSize);
  const frames: PitchFrame[] = [];
  const count = Math.max(
    0,
    Math.floor((samples.length - config.windowSize) / config.hopSize) + 1,
  );
  for (let index = 0; index < count; index++) {
    const offset = index * config.hopSize;
    let mean = 0;
    for (let j = 0; j < buffer.length; j++) mean += samples[offset + j];
    mean /= buffer.length;
    let energy = 0;
    for (let j = 0; j < buffer.length; j++) {
      buffer[j] = samples[offset + j] - mean;
      energy += buffer[j] * buffer[j];
    }
    if (!Number.isFinite(energy))
      throw new Error("The decoded audio contains invalid samples.");
    const rms = Math.sqrt(energy / buffer.length);
    const [frequency, rawClarity] =
      rms < config.minRms
        ? [0, 0]
        : detector.findPitch(buffer, config.sampleRate);
    const clarity = Number.isFinite(rawClarity)
      ? Math.max(0, Math.min(1, rawClarity))
      : 0;
    const rejection: Rejection | undefined =
      rms < config.minRms
        ? "silence"
        : !Number.isFinite(frequency) ||
            frequency <= 0 ||
            clarity < config.minClarity
          ? "low-confidence"
          : frequency < config.minFrequency || frequency > config.maxFrequency
            ? "out-of-range"
            : undefined;
    const pitch = rejection
      ? null
      : frequencyToPitch(frequency, config.tuningA4);
    frames.push({
      time: (offset + config.windowSize / 2) / config.sampleRate,
      frequency: pitch ? frequency : null,
      midi: pitch?.midi ?? null,
      note: pitch?.note ?? null,
      cents: pitch?.cents ?? null,
      clarity,
      rms,
      ...(rejection ? { rejection } : {}),
      diagnostics: {
        rawFrequency:
          Number.isFinite(frequency) && frequency > 0 ? frequency : null,
        rawClarity: clarity,
        rawRejection: rejection,
        candidates:
          rms < config.minRms ? [] : estimateHarmonics(buffer).candidates,
        decision: "weak-evidence",
        margin: 0,
        corrected: false,
        selectedCandidate: null,
        detail: "Awaiting harmonic and neighbouring-frame evidence.",
      },
    });
    if (index % 64 === 0) onProgress((0.9 * index) / Math.max(count, 1));
  }
  const decisions = trackCandidates(
    frames.map((f) => ({
      candidates: f.diagnostics!.candidates,
      quiet: f.rms < config.minRms,
    })),
    config,
  );
  decisions.forEach((decision, i) => {
    const frame = frames[i];
    const diagnostic = frame.diagnostics!;
    diagnostic.decision = decision.reason;
    diagnostic.margin = decision.margin;
    const candidate = decision.candidate;
    diagnostic.selectedCandidate = candidate
      ? diagnostic.candidates.indexOf(candidate)
      : null;
    if (!candidate) {
      frame.frequency = frame.midi = frame.cents = null;
      frame.note = null;
      frame.rejection =
        decision.reason === "silence"
          ? "silence"
          : decision.reason === "ambiguous"
            ? "ambiguous"
            : diagnostic.rawClarity < config.minClarity
              ? "low-confidence"
              : "weak-harmonics";
      diagnostic.detail =
        frame.rejection === "silence"
          ? "RMS is below the quiet-frame threshold."
          : frame.rejection === "ambiguous"
            ? "Competing candidates remain too close after bounded neighbour support. No note assigned."
            : "No candidate has enough spectral support and periodicity. No note assigned.";
    } else {
      const raw = diagnostic.rawFrequency;
      const useRaw =
        raw !== null &&
        !diagnostic.rawRejection &&
        Math.abs(1200 * Math.log2(raw / candidate.frequency)) <=
          config.rawRefinementCents;
      const frequency = useRaw ? raw! : candidate.frequency;
      const pitch = frequencyToPitch(frequency, config.tuningA4);
      Object.assign(frame, {
        frequency,
        midi: pitch.midi,
        note: pitch.note,
        cents: pitch.cents,
        clarity: candidate.periodicity,
      });
      delete frame.rejection;
      diagnostic.corrected = !useRaw;
      diagnostic.detail = `${useRaw ? "Raw F0 retained: harmonic evidence agrees." : "Harmonic-family estimate selected; raw F0 was unsupported or inconsistent."}${decision.reason === "neighbours" ? " Nearby frames resolve a close candidate choice; current-frame evidence is still required." : ""}`;
    }
  });
  const usable = frames.filter((f) => f.frequency !== null);
  const sufficient =
    usable.length >= 10 &&
    (usable.length * config.hopSize) / config.sampleRate >= 0.5;
  onProgress(1);
  return {
    frames,
    duration: samples.length / config.sampleRate,
    config,
    usableFrames: usable.length,
    coverage: frames.length ? usable.length / frames.length : 0,
    meanClarity: usable.length
      ? usable.reduce((sum, f) => sum + f.clarity, 0) / usable.length
      : 0,
    sufficient,
    observations: sufficient ? measuredObservations(frames, config) : [],
  };
}
