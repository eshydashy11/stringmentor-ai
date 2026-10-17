import FFT from "fft.js";
import { Autocorrelator } from "pitchy";
import type { PitchConfig } from "./pitch.ts";

export type PitchCandidate = {
  frequency: number;
  support: number; // Fraction of retained spectral-peak amplitude explained.
  periodicity: number; // NSDF at this candidate's period; not probability.
  score: number;
  primitive: boolean;
  harmonics: number[];
};
export type SpectralPeak = { frequency: number; amplitude: number };
const centsBetween = (a: number, b: number) =>
  Math.abs(1200 * Math.log2(a / b));
function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** Multi-candidate harmonic evidence, independent of note names, tuning and sequence. */
export function createHarmonicEstimator(config: PitchConfig) {
  const n = config.windowSize;
  const fftSize = 2 ** Math.ceil(Math.log2(n * 4));
  const fft = new FFT(fftSize);
  const input = new Float64Array(fftSize);
  const spectrum = fft.createComplexArray();
  const magnitudes = new Float64Array(fftSize / 2 + 1);
  const window = Float64Array.from(
    { length: n },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)),
  );
  const autocorrelator = Autocorrelator.forFloat32Array(n);
  const autocorrelation = new Float32Array(n);
  const energy = new Float64Array(n + 1);
  const binHz = config.sampleRate / fftSize;
  return (
    samples: Float32Array,
  ): { candidates: PitchCandidate[]; peaks: SpectralPeak[] } => {
    for (let i = 0; i < n; i++) {
      input[i] = samples[i] * window[i];
      energy[i + 1] = energy[i] + samples[i] ** 2;
    }
    fft.realTransform(spectrum, input);
    let maximum = 0;
    const lastBin = Math.min(
      magnitudes.length - 2,
      Math.floor(config.maxSpectralFrequency / binHz),
    );
    for (let i = 0; i <= lastBin + 1; i++) {
      magnitudes[i] = Math.hypot(spectrum[2 * i], spectrum[2 * i + 1]);
      maximum = Math.max(maximum, magnitudes[i]);
    }
    if (!maximum) return { candidates: [], peaks: [] };
    const sorted = Array.from(magnitudes.slice(1, lastBin)).sort(
      (a, b) => a - b,
    );
    const floor = Math.max(
      maximum * config.spectralPeakFloor,
      sorted[Math.floor(sorted.length / 2)] * 8,
    );
    const peaks: SpectralPeak[] = [];
    for (let i = 2; i < lastBin; i++) {
      if (
        i * binHz < config.minFrequency * 0.8 ||
        magnitudes[i] < floor ||
        magnitudes[i] <= magnitudes[i - 1] ||
        magnitudes[i] <= magnitudes[i + 1]
      )
        continue;
      const [a, b, c] = [
        magnitudes[i - 1],
        magnitudes[i],
        magnitudes[i + 1],
      ].map((v) => Math.log(Math.max(v, 1e-20)));
      const offset = Math.max(
        -0.5,
        Math.min(0.5, (0.5 * (a - c)) / (a - 2 * b + c)),
      );
      peaks.push({
        frequency: (i + offset) * binHz,
        amplitude: magnitudes[i] / maximum,
      });
    }
    peaks.sort((a, b) => b.amplitude - a.amplitude);
    peaks.splice(32);
    const total = peaks.reduce((sum, p) => sum + p.amplitude, 0);
    if (!total) return { candidates: [], peaks };
    autocorrelator.autocorrelate(samples, autocorrelation);
    const periodicity = (frequency: number) => {
      const lag = config.sampleRate / frequency;
      const k = Math.floor(lag);
      const nsdf = (index: number) =>
        (2 * autocorrelation[index]) /
        Math.max(1e-20, energy[n - index] + energy[n] - energy[index]);
      return Math.max(
        0,
        Math.min(1, nsdf(k) * (1 - lag + k) + nsdf(k + 1) * (lag - k)),
      );
    };
    const candidates: PitchCandidate[] = [];
    for (const peak of peaks) {
      for (let divisor = 1; divisor <= config.maxCandidateDivisor; divisor++) {
        const seed = peak.frequency / divisor;
        if (
          seed < config.minFrequency ||
          seed > config.maxFrequency ||
          candidates.some((c) => centsBetween(seed, c.frequency) < 20)
        )
          continue;
        // One peak per harmonic prevents nearby sidebands being counted twice.
        const matched = new Map<number, SpectralPeak>();
        for (const other of peaks) {
          const harmonic = Math.round(other.frequency / seed);
          const tolerance = Math.max(
            (config.sampleRate / n) * 0.65,
            other.frequency * config.harmonicTolerance,
          );
          if (
            harmonic >= 1 &&
            harmonic <= config.maxHarmonic &&
            Math.abs(other.frequency - harmonic * seed) < tolerance &&
            !matched.has(harmonic)
          )
            matched.set(harmonic, other);
        }
        let weight = 0,
          numerator = 0,
          denominator = 0,
          complexity = 0,
          divisorGcd = 0;
        for (const [h, p] of matched) {
          weight += p.amplitude;
          numerator += p.frequency * p.amplitude * h;
          denominator += p.amplitude * h * h;
          complexity += p.amplitude * Math.log2(h);
          if (p.amplitude >= config.primitivePeakFloor)
            divisorGcd = gcd(divisorGcd, h);
        }
        if (!weight || !denominator) continue;
        const frequency = numerator / denominator;
        if (frequency < config.minFrequency || frequency > config.maxFrequency)
          continue;
        const support = weight / total;
        // Penalise unnecessarily low subharmonics whose audible partials all
        // share a divisor, e.g. {2,4,6} supports f*2 more directly than f.
        const score =
          support -
          (config.harmonicComplexityPenalty * complexity) / weight -
          (divisorGcd > 1 ? config.subharmonicPenalty : 0);
        candidates.push({
          frequency,
          support,
          periodicity: periodicity(frequency),
          score,
          primitive: divisorGcd === 1,
          harmonics: [...matched.keys()].sort((a, b) => a - b),
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const distinct: PitchCandidate[] = [];
    for (const candidate of candidates) {
      if (
        !distinct.some(
          (c) => centsBetween(c.frequency, candidate.frequency) < 35,
        )
      )
        distinct.push(candidate);
      if (distinct.length === 5) break;
    }
    return { candidates: distinct, peaks };
  };
}

export type CandidateFrame = { candidates: PitchCandidate[]; quiet: boolean };
export type TrackingDecision = {
  candidate?: PitchCandidate;
  margin: number;
  reason: "spectral" | "neighbours" | "ambiguous" | "weak-evidence" | "silence";
};
/** Offline, bounded look-around: no quantisation, smoothing or unlimited note lock. */
export function trackCandidates(
  frames: CandidateFrame[],
  config: PitchConfig,
): TrackingDecision[] {
  return frames.map((frame, index) => {
    if (frame.quiet) return { margin: 0, reason: "silence" };
    const eligible = frame.candidates.filter(
      (c) =>
        c.primitive &&
        c.score >= config.minCandidateScore &&
        c.support >= config.minHarmonicSupport &&
        c.periodicity >= config.minCandidatePeriodicity &&
        (c.harmonics.length >= 2 || c.periodicity >= config.minClarity),
    );
    if (!eligible.length) return { margin: 0, reason: "weak-evidence" };
    const ranked = frame.candidates
      .map((candidate) => {
        let support = 0,
          count = 0;
        for (let distance = 1; distance <= config.neighbourFrames; distance++) {
          for (const direction of [-1, 1]) {
            const other = frames[index + direction * distance];
            if (!other || other.quiet) continue;
            const best = other.candidates[0];
            if (
              !best ||
              !best.primitive ||
              best.periodicity < config.minCandidatePeriodicity ||
              best.score < config.minCandidateScore ||
              best.support < config.minHarmonicSupport
            )
              continue;
            count++;
            support += Math.max(
              0,
              1 -
                centsBetween(candidate.frequency, best.frequency) /
                  config.neighbourToleranceCents,
            );
          }
        }
        return {
          candidate,
          score:
            candidate.score +
            (count >= 2 ? (config.neighbourBonus * support) / count : 0),
        };
      })
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const margin = best.score - (ranked[1]?.score ?? 0);
    if (!eligible.includes(best.candidate))
      return { margin, reason: "weak-evidence" };
    if (margin < config.minCandidateMargin)
      return { margin, reason: "ambiguous" };
    return {
      candidate: best.candidate,
      margin,
      reason:
        best.candidate === frame.candidates[0] &&
        frame.candidates[0].score - (frame.candidates[1]?.score ?? 0) >=
          config.minCandidateMargin
          ? "spectral"
          : "neighbours",
    };
  });
}
