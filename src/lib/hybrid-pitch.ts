import {
  frequencyToPitch,
  type PitchFrame,
  type PitchResult,
} from "./pitch.ts";
import type { ExperimentalResult } from "./experimental-pitch.ts";
import type { PitchCandidate } from "./pitch-candidates.ts";
import type { NeuralEstimate } from "./crepe-input.ts";

export const HYBRID_VERSION = "2E.1";
/** Frozen before new held-out evaluation. Gates are not correctness probabilities. */
export const HYBRID_POLICY = {
  crossoverHz: 131,
  transitionTopHz: 147,
  confidence: 0.8,
  transitionConfidence: 0.85,
  support: 0.75,
  transitionSupport: 0.8,
  periodicity: 0.75,
  score: 0.65,
  margin: 0.04,
  cycles: 6,
  agreementCents: 35,
  neighbourCents: 60,
  neighbourFrames: 2,
  conflictSupport: 0.55,
  conflictPeriodicity: 0.5,
  conflictScore: 0.5,
  harmonicCents: 45,
  maxHarmonic: 6,
} as const;
export type HybridPolicy = { [K in keyof typeof HYBRID_POLICY]: number };
export type HybridDecision = {
  time: number;
  frequency: number | null;
  source: "standard" | "experimental" | "crepe-tiny" | null;
  reason: string;
  failed: string[];
  neural: NeuralEstimate;
  acoustic: PitchCandidate | null;
  conflicts: { frequency: number; ratio: number; source: string }[];
  disagreement: boolean;
  harmonicGuard: boolean;
  recovered: boolean;
};
export type HybridResult = {
  version: typeof HYBRID_VERSION;
  policy: HybridPolicy;
  pitch: PitchResult;
  decisions: HybridDecision[];
  stats: {
    recovered: number;
    neuralRecovered: number;
    disagreements: number;
    harmonicGuards: number;
    withheld: number;
  };
  timing: {
    modelMs: number;
    inferenceMs: number;
    arbitrationMs: number;
    totalMs: number;
    inferredFrames: number;
  };
  model: { sha256: string; runtime: string; backend: string };
};
const distance = (a: number, b: number) => Math.abs(1200 * Math.log2(a / b));
export function harmonicRatio(
  a: number,
  b: number,
  policy: HybridPolicy = HYBRID_POLICY,
): number | null {
  const ratio = Math.max(a, b) / Math.min(a, b),
    integer = Math.round(ratio);
  return integer >= 2 &&
    integer <= policy.maxHarmonic &&
    distance(ratio, integer) <= policy.harmonicCents
    ? integer
    : null;
}
/** Select measured candidates, never interpolate, smooth, quantise, or use hybrid outputs as anchors. */
export function selectHybrid(
  standard: PitchResult,
  experimental: ExperimentalResult,
  neural: NeuralEstimate[],
  policy: HybridPolicy = HYBRID_POLICY,
): Omit<HybridResult, "timing" | "model"> {
  if (
    neural.length !== standard.frames.length ||
    experimental.pitch.frames.length !== neural.length ||
    experimental.decisions.length !== neural.length ||
    experimental.pitch.frames.some((f, i) => f.time !== standard.frames[i].time)
  )
    throw new Error(
      "Hybrid comparison requires aligned Standard, Experimental and CREPE frames.",
    );
  if (
    Object.values(policy).some((v) => !Number.isFinite(v) || v <= 0) ||
    policy.crossoverHz < 55 ||
    policy.transitionTopHz < policy.crossoverHz ||
    policy.confidence > 1 ||
    !Number.isInteger(policy.neighbourFrames) ||
    policy.neighbourFrames > 4
  )
    throw new Error("Invalid hybrid policy.");
  const boundaries = experimental.boundaries.filter(
    (b) => b.usedForSegmentation,
  );
  const decisions: HybridDecision[] = [];
  const frames = standard.frames.map((frame, i): PitchFrame => {
    const n = neural[i],
      e = experimental.pitch.frames[i],
      local = experimental.decisions[i];
    const validNeural =
      n.frequency !== null &&
      Number.isFinite(n.frequency) &&
      n.frequency >= 55 &&
      n.frequency <= 1000 &&
      Number.isFinite(n.confidence) &&
      n.confidence <= 1 &&
      n.confidence >= 0.5;
    const f = validNeural ? n.frequency! : null;
    const evidence = [
      ...(frame.diagnostics?.candidates ?? []).map((c) => ({
        c,
        source: "4096",
      })),
      ...local.shorter.flatMap((r) =>
        (r.frame.diagnostics?.candidates ?? []).map((c) => ({
          c,
          source: String(r.windowSize),
        })),
      ),
    ];
    const conflicts =
      f === null
        ? []
        : evidence.flatMap(({ c, source }) => {
            const ratio = harmonicRatio(f, c.frequency, policy);
            return ratio &&
              c.primitive &&
              c.support >= policy.conflictSupport &&
              c.periodicity >= policy.conflictPeriodicity &&
              c.score >= policy.conflictScore &&
              c.harmonics.length >= 2
              ? [{ frequency: c.frequency, ratio, source }]
              : [];
          });
    const disagreement =
      f !== null &&
      [frame.frequency, e.frequency].some(
        (v) => v !== null && distance(v, f) > policy.agreementCents,
      );
    const finish = (
      source: HybridDecision["source"],
      selected: PitchFrame,
      reason: string,
      failed: string[] = [],
      acoustic: PitchCandidate | null = null,
    ) => {
      decisions.push({
        time: frame.time,
        frequency: selected.frequency,
        source,
        reason,
        failed,
        neural: n,
        acoustic,
        conflicts,
        disagreement,
        harmonicGuard:
          conflicts.length > 0 &&
          (selected.frequency === null ||
            (f !== null &&
              distance(selected.frequency, f) > policy.agreementCents)),
        recovered: frame.frequency === null && selected.frequency !== null,
      });
      return selected;
    };
    // Protect existing accepted measurements at every register. This also retains known Standard errors.
    if (frame.frequency !== null)
      return finish(
        "standard",
        frame,
        disagreement
          ? "Standard retained; CREPE disagrees. A neural activation cannot override an accepted acoustic estimate."
          : "Accepted Standard estimate retained.",
      );
    const failed: string[] = [];
    if (frame.rms < standard.config.minRms) failed.push("below-amplitude");
    // Existing independent recovery remains available unless a credible neural estimate disputes it.
    if (
      !failed.length &&
      e.frequency !== null &&
      (f === null || distance(e.frequency, f) <= policy.agreementCents)
    )
      return finish(
        "experimental",
        e,
        "Existing Experimental recovery retained; CREPE agrees or has no eligible estimate.",
      );
    if (
      e.frequency !== null &&
      f !== null &&
      distance(e.frequency, f) > policy.agreementCents
    )
      failed.push("experimental-disagreement");
    if (f === null) failed.push("neural-unavailable-or-range");
    if (f !== null && f < policy.crossoverHz)
      failed.push("below-provisional-crossover");
    const transitional = f !== null && f < policy.transitionTopHz;
    if (
      !Number.isFinite(n.confidence) ||
      n.confidence <
        (transitional ? policy.transitionConfidence : policy.confidence) ||
      n.confidence > 1
    )
      failed.push("neural-activation");
    if (conflicts.length) failed.push("harmonic-conflict");
    const medium = local.shorter.find((r) => r.windowSize === 2048);
    const candidates = medium?.frame.diagnostics?.candidates ?? [];
    const acoustic =
      f === null
        ? undefined
        : candidates.find(
            (c) => distance(c.frequency, f) <= policy.agreementCents,
          );
    if (!acoustic) failed.push("no-matching-acoustic-candidate");
    else {
      if (!acoustic.primitive) failed.push("non-primitive-family");
      if (
        acoustic.support <
        (transitional ? policy.transitionSupport : policy.support)
      )
        failed.push("weak-harmonic-support");
      if (acoustic.periodicity < policy.periodicity)
        failed.push("insufficient-periodicity");
      if (acoustic.score < policy.score) failed.push("low-candidate-score");
      if (
        acoustic.score -
          Math.max(
            0,
            ...candidates.filter((c) => c !== acoustic).map((c) => c.score),
          ) <
        policy.margin
      )
        failed.push("candidate-ambiguity");
      if ((acoustic.frequency * 2048) / 22050 < policy.cycles)
        failed.push("too-few-cycles");
    }
    const centre = Math.round(frame.time * 22050);
    if (
      boundaries.some((b) => centre >= b.startSample && centre <= b.endSample)
    )
      failed.push("boundary-overlap");
    // Bilateral raw neural corroboration; never across a supported segment barrier, never recycled recoveries.
    const sides = [-1, 1].every((direction) =>
      Array.from(
        { length: policy.neighbourFrames },
        (_, j) => i + direction * (j + 1),
      ).some((other) => {
        const neighbour = neural[other],
          time = standard.frames[other]?.time;
        if (
          !neighbour ||
          time === undefined ||
          f === null ||
          neighbour.frequency === null ||
          neighbour.confidence < policy.confidence ||
          neighbour.confidence > 1 ||
          !Number.isFinite(neighbour.confidence) ||
          !Number.isFinite(neighbour.frequency) ||
          standard.frames[other].rms < standard.config.minRms ||
          distance(f, neighbour.frequency) > policy.neighbourCents
        )
          return false;
        return !boundaries.some(
          (b) =>
            b.centreSample >= Math.min(centre, time * 22050) &&
            b.centreSample <= Math.max(centre, time * 22050),
        );
      }),
    );
    if (!sides) failed.push("missing-bilateral-segment-support");
    if (failed.length)
      return finish(
        null,
        frame,
        "Withheld: current-frame and local evidence do not jointly establish a fundamental.",
        failed,
        acoustic ?? null,
      );
    const pitch = frequencyToPitch(f!, standard.config.tuningA4);
    return finish(
      "crepe-tiny",
      {
        ...frame,
        frequency: f!,
        midi: pitch.midi,
        note: pitch.note,
        cents: pitch.cents,
        clarity: acoustic!.periodicity,
        rejection: undefined,
        // Keep original diagnostics intact: the hybrid evidence is separate, not a forged Standard decision.
      },
      "CREPE Tiny corroborated by a current 2048-sample harmonic candidate and bilateral segment evidence; no supported harmonic competitor.",
      [],
      acoustic!,
    );
  });
  const usable = frames.filter((f) => f.frequency !== null);
  return {
    version: HYBRID_VERSION,
    policy: { ...policy },
    decisions,
    pitch: {
      ...standard,
      frames,
      usableFrames: usable.length,
      coverage: frames.length ? usable.length / frames.length : 0,
      meanClarity: usable.length
        ? usable.reduce((sum, f) => sum + f.clarity, 0) / usable.length
        : 0,
      sufficient: (usable.length * 512) / 22050 >= 0.5,
      observations: [],
    },
    stats: {
      recovered: decisions.filter((d) => d.recovered).length,
      neuralRecovered: decisions.filter((d) => d.source === "crepe-tiny")
        .length,
      disagreements: decisions.filter((d) => d.disagreement).length,
      harmonicGuards: decisions.filter((d) => d.harmonicGuard).length,
      withheld: frames.length - usable.length,
    },
  };
}
