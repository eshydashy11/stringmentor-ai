import type { HybridResult } from "./hybrid-pitch.ts";
import { frequencyToPitch, type PitchResult } from "./pitch.ts";

/** Display-only eligibility. Never feeds selection, feedback, or persistence. */
export const CREPE_DISPLAY_GATES = {
  rms: 0.003,
  minHz: 55,
  maxHz: 1000,
  activation: 0.5,
} as const;
export function crepeComparison(standard: PitchResult, hybrid: HybridResult) {
  if (
    standard.frames.length !== hybrid.decisions.length ||
    hybrid.pitch.frames.length !== standard.frames.length
  )
    throw new Error("Comparison requires aligned pitch frames.");
  const rows = standard.frames.map((frame, i) => {
    const d = hybrid.decisions[i],
      accepted = hybrid.pitch.frames[i];
    if (d.time !== frame.time || accepted.time !== frame.time)
      throw new Error("Comparison timestamps do not match.");
    const n = d.neural,
      failed: string[] = [];
    if (!Number.isFinite(frame.rms) || frame.rms < CREPE_DISPLAY_GATES.rms)
      failed.push("Below amplitude threshold");
    if (
      n.frequency === null ||
      !Number.isFinite(n.frequency) ||
      n.frequency < CREPE_DISPLAY_GATES.minHz ||
      n.frequency > CREPE_DISPLAY_GATES.maxHz
    )
      failed.push("No finite in-range candidate (55–1000 Hz)");
    if (
      !Number.isFinite(n.confidence) ||
      n.confidence < CREPE_DISPLAY_GATES.activation ||
      n.confidence > 1
    )
      failed.push("Neural activation below 0.50 or invalid");
    const frequency = failed.length ? null : n.frequency!;
    const difference =
      frequency !== null && frame.frequency !== null
        ? 1200 * Math.log2(frequency / frame.frequency)
        : null;
    return {
      time: frame.time,
      frequency,
      midi: frequency === null ? null : frequencyToPitch(frequency).midi,
      activation: n.confidence,
      failed,
      standardFrequency: frame.frequency,
      hybridFrequency: accepted.frequency,
      hybridWithheld: frequency !== null && accepted.frequency === null,
      differenceCents: difference,
      disagreement: difference !== null && Math.abs(difference) > 35,
      ratioToStandard:
        n.frequency !== null &&
        Number.isFinite(n.frequency) &&
        frame.frequency !== null
          ? n.frequency / frame.frequency
          : null,
    };
  });
  const count = (values: (number | null)[]) => {
    const accepted = values.filter((f) => f !== null).length;
    return {
      accepted,
      total: rows.length,
      coverage: rows.length ? accepted / rows.length : 0,
    };
  };
  return {
    rows,
    standard: count(standard.frames.map((f) => f.frequency)),
    crepe: count(rows.map((r) => r.frequency)),
    hybrid: count(hybrid.pitch.frames.map((f) => f.frequency)),
    hybridWithheld: rows.filter((r) => r.hybridWithheld).length,
    disagreements: rows.filter((r) => r.disagreement).length,
  };
}
