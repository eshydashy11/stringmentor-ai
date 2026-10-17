import { PitchDetector } from "pitchy";

/** Analysis settings use samples at the decoded analysis rate, not the source rate. */
export const CELLO_CONFIG = {
  sampleRate: 22050,
  windowSize: 4096, // 186 ms: >12 periods of C2, including detuning below it.
  hopSize: 512, // 23.2 ms; overlapping estimates are not independent measurements.
  minFrequency: 55,
  maxFrequency: 1000,
  minRms: 0.003, // approximately -50.5 dBFS; no automatic gain normalisation.
  minClarity: 0.9,
  peakThreshold: 0.97, // Prefer the full period over weaker harmonic-period peaks.
  tuningA4: 440,
} as const;
export type PitchConfig = { [K in keyof typeof CELLO_CONFIG]: number };
export const MAX_ANALYSIS_SECONDS = 600;
export type Rejection =
  "silence" | "low-confidence" | "out-of-range" | "unstable";
export type PitchFrame = {
  time: number;
  frequency: number | null;
  midi: number | null;
  note: string | null;
  cents: number | null;
  clarity: number;
  rms: number;
  rejection?: Rejection;
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
    config.tuningA4 <= 0
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

/** Reject isolated octave spikes; never force a sustained octave leap onto a previous note. */
export function rejectOctaveSpikes(frames: PitchFrame[]) {
  const rejected: number[] = [];
  for (let i = 1; i < frames.length - 1; i++) {
    const [before, here, after] = [
      frames[i - 1].midi,
      frames[i].midi,
      frames[i + 1].midi,
    ];
    if (
      before !== null &&
      here !== null &&
      after !== null &&
      Math.abs(before - after) < 0.4 &&
      Math.abs(Math.abs(here - before) - 12) < 0.4
    )
      rejected.push(i);
  }
  for (const i of rejected)
    Object.assign(frames[i], {
      frequency: null,
      midi: null,
      note: null,
      cents: null,
      rejection: "unstable",
    });
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
    });
    if (index % 64 === 0) onProgress(index / Math.max(count, 1));
  }
  rejectOctaveSpikes(frames);
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
