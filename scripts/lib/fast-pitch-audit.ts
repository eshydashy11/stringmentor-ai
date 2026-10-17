/** Offline audit only. No production imports depend on this module. */
import {
  CELLO_CONFIG,
  type PitchConfig,
  type PitchResult,
} from "../../src/lib/pitch.ts";
import type { PitchCandidate } from "../../src/lib/pitch-candidates.ts";
import type { ToneResult } from "../../src/lib/tone.ts";

export type NoteLabel = { start: number; end: number; frequency: number };
export type SignalCase = {
  id: string;
  samples: Float32Array;
  notes: NoteLabel[];
  texture: string;
};
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const centsError = (actual: number, expected: number) =>
  1200 * Math.log2(actual / expected);
export function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position),
    high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}
export function increment(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Fixed seeds, known target oscillators, sample-quantised onsets. Tails are labelled interference. */
export function makeSequence(
  id: string,
  midis: number[],
  secondsPerNote: number,
  texture = "clean",
  repeats = 2,
): SignalCase {
  const sr = CELLO_CONFIG.sampleRate;
  const noteSamples = Math.round(secondsPerNote * sr);
  const notes = Array.from({ length: midis.length * repeats }, (_, i) => ({
    start: (i * noteSamples) / sr,
    end: ((i + 1) * noteSamples) / sr,
    frequency: hz(midis[i % midis.length]),
  }));
  const samples = new Float32Array(noteSamples * notes.length);
  let seed = 73219;
  const noise = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 31 - 1;
  };
  for (const [index, note] of notes.entries()) {
    const tail = texture === "resonance" ? 0.18 : 0;
    const first = Math.round(note.start * sr);
    const last = Math.min(samples.length, Math.round((note.end + tail) * sr));
    for (let i = first; i < last; i++) {
      const t = i / sr - note.start,
        end = note.end - note.start;
      const attack = Math.min(1, t / 0.008);
      const release = tail
        ? t <= end
          ? 1
          : Math.exp(-(t - end) / 0.045)
        : Math.max(0, Math.min(1, (end - t) / 0.008));
      let sound = 0;
      for (let h = 1; h <= 8; h++) {
        const amplitude =
          h === 1 && texture === "weak-fundamental" ? 0.08 : 1 / h ** 1.2;
        sound +=
          amplitude *
          Math.sin(2 * Math.PI * h * note.frequency * t + index * 0.37 * h);
      }
      samples[i] += 0.18 * attack * release * sound;
      if (texture === "attack-noise" && t < 0.012)
        samples[i] += 0.12 * noise() * (1 - t / 0.012);
    }
  }
  return { id, samples, notes, texture };
}

export function syntheticCases(): SignalCase[] {
  const cases: SignalCase[] = [];
  for (const [name, notes] of [
    ["low", [36, 43, 50, 57]],
    ["arpeggio", [43, 50, 55, 59, 62, 59, 55, 50]],
  ] as const) {
    for (const duration of [0.5, 0.125, 0.08]) {
      cases.push(
        makeSequence(`${name}-${duration}-clean`, [...notes], duration),
      );
    }
  }
  for (const texture of ["resonance", "attack-noise", "weak-fundamental"]) {
    cases.push(
      makeSequence(
        `arpeggio-0.125-${texture}`,
        [43, 50, 55, 59, 62, 59, 55, 50],
        0.125,
        texture,
      ),
    );
  }
  cases.push(
    makeSequence(
      "chromatic-0.125-clean",
      [48, 49, 50, 51, 52, 51, 50, 49],
      0.125,
    ),
  );
  cases.push(makeSequence("sustained-C2-minus12c", [35.88], 2, "clean", 1));
  cases.push(makeSequence("sustained-A3-plus12c", [57.12], 2, "clean", 1));
  return cases;
}

export function candidateFailures(
  c: PitchCandidate,
  config: PitchConfig,
): string[] {
  const failed: string[] = [];
  if (!c.primitive) failed.push("non-primitive");
  if (c.score < config.minCandidateScore) failed.push("score");
  if (c.support < config.minHarmonicSupport) failed.push("support");
  if (c.periodicity < config.minCandidatePeriodicity)
    failed.push("periodicity");
  if (!(c.harmonics.length >= 2 || c.periodicity >= config.minClarity))
    failed.push("single-partial-clarity");
  return failed;
}

export function rejectionAudit(result: PitchResult) {
  const final: Record<string, number> = {},
    raw: Record<string, number> = {},
    tracker: Record<string, number> = {};
  const topCandidateFailuresOnWeakFrames: Record<string, number> = {};
  let weakWithNoEligible = 0,
    weakDespiteEligible = 0,
    noCandidates = 0;
  for (const f of result.frames) {
    increment(final, f.rejection ?? "accepted");
    increment(raw, f.diagnostics?.rawRejection ?? "accepted");
    increment(tracker, f.diagnostics!.decision);
    if (f.diagnostics!.decision !== "weak-evidence") continue;
    const candidates = f.diagnostics!.candidates;
    if (!candidates.length) noCandidates++;
    if (candidates.some((c) => !candidateFailures(c, result.config).length))
      weakDespiteEligible++;
    else weakWithNoEligible++;
    for (const gate of candidates[0]
      ? candidateFailures(candidates[0], result.config)
      : ["no-candidates"])
      increment(topCandidateFailuresOnWeakFrames, gate);
  }
  const gaps: {
    start: number;
    end: number;
    frames: number;
    sampledDuration: number;
    reasons: Record<string, number>;
  }[] = [];
  let gap: (typeof gaps)[number] | null = null;
  for (const frame of result.frames) {
    if (frame.frequency !== null) {
      if (gap) gaps.push(gap);
      gap = null;
      continue;
    }
    gap ??= {
      start: frame.time,
      end: frame.time,
      frames: 0,
      sampledDuration: 0,
      reasons: {},
    };
    gap.end = frame.time;
    gap.frames++;
    gap.sampledDuration =
      (gap.frames * result.config.hopSize) / result.config.sampleRate;
    increment(gap.reasons, frame.rejection!);
  }
  if (gap) gaps.push(gap);
  return {
    final,
    raw,
    tracker,
    weakWithNoEligible,
    weakDespiteEligible,
    noCandidates,
    topCandidateFailuresOnWeakFrames,
    gaps: gaps.sort((a, b) => b.frames - a.frames),
  };
}

/** Matches ordered event times once each; tolerance fixed before looking at the recording. */
export function matchBoundaries(
  predicted: number[],
  truth: number[],
  tolerance = 0.05,
) {
  const p = [...predicted].sort((a, b) => a - b),
    t = [...truth].sort((a, b) => a - b);
  let i = 0,
    j = 0;
  const errors: number[] = [];
  while (i < p.length && j < t.length) {
    if (p[i] < t[j] - tolerance) i++;
    else if (p[i] > t[j] + tolerance) j++;
    else {
      errors.push((p[i] - t[j]) * 1000);
      i++;
      j++;
    }
  }
  return {
    predicted: p.length,
    truth: t.length,
    matched: errors.length,
    precision: p.length ? errors.length / p.length : null,
    recall: t.length ? errors.length / t.length : null,
    signedMedianMs: quantile(errors, 0.5),
    absoluteMedianMs: quantile(errors.map(Math.abs), 0.5),
    absoluteP95Ms: quantile(errors.map(Math.abs), 0.95),
  };
}

/** Diagnostic peak picker only, not a new production onset detector. */
export function fluxPeaks(tone: ToneResult): number[] {
  const peaks: { time: number; flux: number }[] = [];
  for (let i = 1; i < tone.frames.length - 1; i++) {
    const f = tone.frames[i];
    if (
      f.flux !== null &&
      f.flux >= tone.fluxThreshold &&
      f.flux >= (tone.frames[i - 1].flux ?? 0) &&
      f.flux > (tone.frames[i + 1].flux ?? 0)
    )
      peaks.push({ time: f.time, flux: f.flux });
  }
  const kept: typeof peaks = [];
  for (const p of peaks.sort((a, b) => b.flux - a.flux))
    if (kept.every((k) => Math.abs(k.time - p.time) >= 0.03)) kept.push(p);
  return kept.map((p) => p.time).sort((a, b) => a - b);
}

export function scoreFrames(
  result: PitchResult,
  notes: NoteLabel[],
  frames = result.frames,
) {
  let correct = 0,
    wrong = 0,
    withheld = 0,
    octaveWrong = 0,
    previousNoteMatches = 0;
  const errors: number[] = [];
  const byContext = {
    mixedWindow: { total: 0, correct: 0, wrong: 0, withheld: 0 },
    singleNoteWindow: { total: 0, correct: 0, wrong: 0, withheld: 0 },
  };
  const half = result.config.windowSize / result.config.sampleRate / 2;
  for (const f of frames) {
    const index = notes.findIndex((n) => f.time >= n.start && f.time < n.end);
    if (index < 0) continue;
    const n = notes[index];
    const context =
      f.time - half < n.start || f.time + half > n.end
        ? byContext.mixedWindow
        : byContext.singleNoteWindow;
    context.total++;
    if (f.frequency === null) {
      withheld++;
      context.withheld++;
      continue;
    }
    const error = centsError(f.frequency, n.frequency);
    errors.push(Math.abs(error));
    if (Math.abs(error) <= 50) {
      correct++;
      context.correct++;
    } else {
      wrong++;
      context.wrong++;
      if (Math.abs(Math.abs(error) - 1200) <= 50) octaveWrong++;
      if (
        index > 0 &&
        Math.abs(centsError(f.frequency, notes[index - 1].frequency)) <= 50
      )
        previousNoteMatches++;
    }
  }
  const total = correct + wrong + withheld,
    usable = correct + wrong;
  return {
    total,
    usable,
    correct,
    wrong,
    withheld,
    octaveWrong,
    previousNoteMatches,
    coverage: total ? usable / total : null,
    correctFraction: total ? correct / total : null,
    acceptedAccuracy: usable ? correct / usable : null,
    acceptedAbsoluteCentsMedian: quantile(errors, 0.5),
    acceptedAbsoluteCentsP95: quantile(errors, 0.95),
    byContext,
  };
}

/** Target-conditioned response timing, not independent onset-detection accuracy. */
export function onsetResponse(result: PitchResult, notes: NoteLabel[]) {
  const responses = notes.slice(1).map((note, i) => {
    const earliest =
      note.start - Math.min(0.1, (notes[i].end - notes[i].start) / 2);
    const frame = result.frames.find(
      (f) =>
        f.time >= earliest &&
        f.time < note.end &&
        f.frequency !== null &&
        Math.abs(centsError(f.frequency, note.frequency)) <= 50,
    );
    return {
      onset: note.start,
      frequency: note.frequency,
      response: frame?.time ?? null,
      errorMs: frame ? (frame.time - note.start) * 1000 : null,
    };
  });
  const errors = responses.flatMap((r) =>
    r.errorMs === null ? [] : [r.errorMs],
  );
  return {
    total: responses.length,
    found: errors.length,
    missed: responses.length - errors.length,
    signedMedianMs: quantile(errors, 0.5),
    absoluteMedianMs: quantile(errors.map(Math.abs), 0.5),
    absoluteP95Ms: quantile(errors.map(Math.abs), 0.95),
    responses,
  };
}

export function fluxAssociation(result: PitchResult, tone: ToneResult) {
  const highFlux = { total: 0, rejected: 0 },
    other = { total: 0, rejected: 0 };
  const nonQuietHighFlux = { total: 0, rejected: 0 },
    nonQuietOther = { total: 0, rejected: 0 };
  for (const f of result.frames) {
    const near = tone.frames.some(
      (t) =>
        Math.abs(t.time - f.time) <= 1024 / 22050 &&
        (t.flux ?? 0) >= tone.fluxThreshold,
    );
    const group = near ? highFlux : other;
    group.total++;
    if (f.frequency === null) group.rejected++;
    if (f.rejection !== "silence") {
      const active = near ? nonQuietHighFlux : nonQuietOther;
      active.total++;
      if (f.frequency === null) active.rejected++;
    }
  }
  return {
    radiusSeconds: 1024 / 22050,
    threshold: tone.fluxThreshold,
    highFlux,
    other,
    nonQuietHighFlux,
    nonQuietOther,
  };
}
