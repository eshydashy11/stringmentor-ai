/** Benchmark-only scoring. Labels never enter any pitch estimator. */
import { quantile, type NoteLabel } from "../lib/fast-pitch-audit.ts";
export type AlignedCase = {
  id: string;
  group: string;
  texture: string;
  duration: number;
  times: number[];
  targets: (number | null)[];
  rms: number[];
  notes: NoteLabel[];
  centres: number[];
  pcmSha256: string;
  sourceHash: string | null;
};
export const CREPE_GATE = {
  confidence: 0.5,
  rms: 0.003,
  minHz: 55,
  maxHz: 1000,
} as const;
export function gateCrepe(
  raw: (number | null)[],
  confidence: number[],
  rms: number[],
  threshold: number = CREPE_GATE.confidence,
) {
  if (raw.length !== confidence.length || raw.length !== rms.length)
    throw new Error("Mismatched CREPE frame counts");
  const reasons: Record<string, number> = {};
  const frequency = raw.map((f, i) => {
    const failed = [];
    if (!Number.isFinite(rms[i]) || rms[i] < CREPE_GATE.rms)
      failed.push("amplitude");
    if (f === null || !Number.isFinite(f) || f <= 0)
      failed.push("not-inferred");
    if (f !== null && (f < CREPE_GATE.minHz || f > CREPE_GATE.maxHz))
      failed.push("range");
    if (
      !Number.isFinite(confidence[i]) ||
      confidence[i] < threshold ||
      confidence[i] > 1
    )
      failed.push("confidence");
    for (const reason of failed) reasons[reason] = (reasons[reason] ?? 0) + 1;
    return failed.length ? null : f;
  });
  return { frequency, rejections: reasons };
}
export function scoreAligned(
  frequency: (number | null)[],
  targets: (number | null)[],
) {
  if (frequency.length !== targets.length)
    throw new Error("Mismatched labelled frame counts");
  let correct = 0,
    wrong = 0,
    withheld = 0,
    octaveErrors = 0,
    oneOctaveErrors = 0;
  const errors: number[] = [],
    correctErrors: number[] = [];
  frequency.forEach((f, i) => {
    const target = targets[i];
    if (target === null) return;
    if (!Number.isFinite(target) || target <= 0)
      throw new Error("Invalid pitch label");
    if (f === null) {
      withheld++;
      return;
    }
    if (!Number.isFinite(f) || f <= 0)
      throw new Error("Invalid accepted frequency");
    const error = Math.abs(1200 * Math.log2(f / target));
    errors.push(error);
    if (error <= 50) {
      correct++;
      correctErrors.push(error);
    } else {
      wrong++;
      const octaves = Math.round(error / 1200);
      if (octaves >= 1 && Math.abs(error - octaves * 1200) <= 50)
        octaveErrors++;
      if (Math.abs(error - 1200) <= 50) oneOctaveErrors++;
    }
  });
  const total = correct + wrong + withheld,
    accepted = correct + wrong;
  return {
    total,
    correct,
    wrong,
    withheld,
    octaveErrors,
    oneOctaveErrors,
    correctFraction: total ? correct / total : null,
    acceptedAccuracy: accepted ? correct / accepted : null,
    acceptedAbsoluteCentsMedian: quantile(errors, 0.5),
    acceptedAbsoluteCentsP95: quantile(errors, 0.95),
    correctOnlyAbsoluteCentsMedian: quantile(correctErrors, 0.5),
    correctOnlyAbsoluteCentsP95: quantile(correctErrors, 0.95),
  };
}
export function coverage(frequency: (number | null)[]) {
  const accepted = frequency.filter((f) => f !== null).length;
  return {
    frames: frequency.length,
    accepted,
    withheld: frequency.length - accepted,
    fraction: frequency.length ? accepted / frequency.length : null,
  };
}
/** Label-conditioned response on the shared centre grid; not onset detection or live latency. */
export function transitionResponse(
  times: number[],
  frequency: (number | null)[],
  notes: NoteLabel[],
) {
  if (times.length !== frequency.length)
    throw new Error("Mismatched response grid");
  const responses: {
    onset: number;
    targetHz: number;
    time: number | null;
    errorMs: number | null;
  }[] = [];
  let repeatedNotesExcluded = 0;
  for (let i = 1; i < notes.length; i++) {
    const note = notes[i],
      previous = notes[i - 1];
    if (Math.abs(1200 * Math.log2(note.frequency / previous.frequency)) <= 50) {
      repeatedNotesExcluded++;
      continue;
    }
    const earliest =
      note.start - Math.min(0.1, (previous.end - previous.start) / 2);
    const index = times.findIndex(
      (t, k) =>
        t >= earliest &&
        t < note.end &&
        frequency[k] !== null &&
        Math.abs(1200 * Math.log2(frequency[k]! / note.frequency)) <= 50,
    );
    responses.push({
      onset: note.start,
      targetHz: note.frequency,
      time: index < 0 ? null : times[index],
      errorMs: index < 0 ? null : (times[index] - note.start) * 1000,
    });
  }
  const errors = responses.flatMap((r) =>
    r.errorMs === null ? [] : [r.errorMs],
  );
  return {
    total: responses.length,
    found: errors.length,
    missed: responses.length - errors.length,
    repeatedNotesExcluded,
    early: errors.filter((e) => e < 0).length,
    signedMedianMs: quantile(errors, 0.5),
    absoluteMedianMs: quantile(errors.map(Math.abs), 0.5),
    absoluteP95Ms: quantile(errors.map(Math.abs), 0.95),
    responses,
  };
}
