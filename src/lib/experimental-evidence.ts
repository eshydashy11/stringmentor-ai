import { CELLO_CONFIG } from "./pitch.ts";
import type { PitchCandidate } from "./pitch-candidates.ts";

export const EXPERIMENTAL_RULES = {
  support: 0.8,
  periodicity: 0.75,
  score: 0.65,
  margin: 0.08,
  minCycles: 6,
  agreementCents: 35,
  neighbourCents: 80,
  nearSupport: 0.75,
  nearPeriodicity: 0.9,
  nearScore: 0.7,
  lookaroundSamples: 1024,
} as const;
export type GateCode =
  | "amplitude"
  | "harmonic-support"
  | "periodicity"
  | "score"
  | "ambiguity"
  | "range"
  | "cycles"
  | "primitive"
  | "no-candidate";
export type GateCheck = {
  code: GateCode;
  label: string;
  value: number | null;
  required: number | null;
  passed: boolean;
  nearMiss: boolean;
};
export const centsDistance = (a: number, b: number) =>
  Math.abs(1200 * Math.log2(a / b));
/** Raw acoustic gates, never changed by temporal selection or rescued frames. */
export function candidateChecks(
  c: PitchCandidate | undefined,
  margin: number,
  size: number,
  rms: number,
): GateCheck[] {
  const checks: GateCheck[] = [
    {
      code: "amplitude",
      label: "Amplitude (RMS)",
      value: rms,
      required: CELLO_CONFIG.minRms,
      passed: rms >= CELLO_CONFIG.minRms,
      nearMiss: false,
    },
  ];
  if (!c)
    return [
      ...checks,
      {
        code: "no-candidate",
        label: "No harmonic candidate",
        value: null,
        required: null,
        passed: false,
        nearMiss: false,
      },
    ];
  const minimum = (
    code: GateCode,
    label: string,
    value: number,
    required: number,
  ) =>
    checks.push({
      code,
      label,
      value,
      required,
      passed: value >= required,
      nearMiss:
        code === "harmonic-support" &&
        value >= EXPERIMENTAL_RULES.nearSupport &&
        value < required,
    });
  minimum(
    "harmonic-support",
    "Harmonic support",
    c.support,
    EXPERIMENTAL_RULES.support,
  );
  minimum(
    "periodicity",
    "Periodicity",
    c.periodicity,
    EXPERIMENTAL_RULES.periodicity,
  );
  minimum("score", "Candidate score", c.score, EXPERIMENTAL_RULES.score);
  minimum("ambiguity", "Candidate margin", margin, EXPERIMENTAL_RULES.margin);
  minimum(
    "cycles",
    "Cycles in window",
    (c.frequency * size) / 22050,
    EXPERIMENTAL_RULES.minCycles,
  );
  checks.push({
    code: "primitive",
    label: "Primitive harmonic family",
    value: +c.primitive,
    required: 1,
    passed: c.primitive,
    nearMiss: false,
  });
  checks.push({
    code: "range",
    label: "Frequency within 55–1000 Hz",
    value: c.frequency,
    required: null,
    passed:
      Number.isFinite(c.frequency) && c.frequency >= 55 && c.frequency <= 1000,
    nearMiss: false,
  });
  return checks;
}
export function supportOnlyNearMiss(
  c: PitchCandidate | undefined,
  checks: GateCheck[],
): boolean {
  const failed = checks.filter((g) => !g.passed);
  return (
    !!c &&
    failed.length === 1 &&
    failed[0].code === "harmonic-support" &&
    failed[0].nearMiss &&
    c.periodicity >= EXPERIMENTAL_RULES.nearPeriodicity &&
    c.score >= EXPERIMENTAL_RULES.nearScore &&
    c.harmonics.includes(1) &&
    c.harmonics.length >= 3
  );
}
export type LocalAnchor = { centreSample: number; frequency: number };
export type RecoveryContext = {
  candidate: PitchCandidate | undefined;
  checks: GateCheck[];
  frequency: number | null;
  centreSample: number;
  anchors: LocalAnchor[];
  corroboratingFrequency: number | null;
  boundaryOverlap: boolean;
};
export type RecoverySelection = {
  accepted: boolean;
  supportException: boolean;
  codes: string[];
  reason: string;
  anchors: LocalAnchor[];
};
/** Bounded non-recursive selection. No path can promote a failed margin or multiple failing gates. */
export function selectRecovery(context: RecoveryContext): RecoverySelection {
  const {
    candidate: c,
    checks,
    frequency: f,
    centreSample,
    corroboratingFrequency: other,
  } = context;
  const exception = supportOnlyNearMiss(c, checks);
  const failed = checks.filter((g) => !g.passed);
  const anchors = context.anchors.filter(
    (a) =>
      a.centreSample !== centreSample &&
      Math.abs(a.centreSample - centreSample) <=
        EXPERIMENTAL_RULES.lookaroundSamples,
  );
  const result = (
    accepted: boolean,
    codes: string[],
    reason: string,
  ): RecoverySelection => ({
    accepted,
    supportException: accepted && exception,
    codes,
    reason,
    anchors,
  });
  const codes = failed.map((g) => g.code as string);
  if (context.boundaryOverlap) codes.push("boundary-overlap");
  if (
    f !== null &&
    other !== null &&
    centsDistance(f, other) > EXPERIMENTAL_RULES.agreementCents
  )
    codes.push("cross-resolution-disagreement");
  if (
    !c ||
    f === null ||
    (failed.length > 0 && !exception) ||
    context.boundaryOverlap ||
    codes.includes("cross-resolution-disagreement")
  )
    return result(
      false,
      codes.length ? codes : ["no-candidate"],
      "Acoustic requirements failed; no pitch assigned. Inspect the individual gates and alternatives.",
    );
  const before = anchors
    .filter((a) => a.centreSample < centreSample)
    .sort((a, b) => b.centreSample - a.centreSample)[0];
  const after = anchors
    .filter((a) => a.centreSample > centreSample)
    .sort((a, b) => a.centreSample - b.centreSample)[0];
  const agrees = (a: LocalAnchor | undefined) =>
    !!a && centsDistance(a.frequency, f) <= EXPERIMENTAL_RULES.neighbourCents;
  const opposite = [before, after].filter((a) => a && !agrees(a));
  // Contradictory eligible neighbours, including octave/subharmonic alternatives, cannot be voted away.
  if (opposite.length)
    return result(
      false,
      ["segment-conflict"],
      "A nearby independently eligible candidate supports another pitch; transition or competing fundamental remains unresolved.",
    );
  const bilateral = agrees(before) && agrees(after);
  const corroborated =
    other !== null &&
    centsDistance(other, f) <= EXPERIMENTAL_RULES.agreementCents;
  if (exception) {
    if (!bilateral || !corroborated)
      return result(
        false,
        [
          "harmonic-support",
          ...(!bilateral ? ["bilateral-evidence"] : []),
          ...(!corroborated ? ["cross-resolution-unavailable"] : []),
        ],
        "Support-only near miss: requires eligible estimates on both sides within 46 ms and agreement at another resolution. Raw gate failure is retained.",
      );
    return result(
      true,
      [],
      "Support-only exception supported by primitive harmonic structure, strong periodicity/score, bilateral eligible segment evidence and another resolution. This is not ground-truth correctness.",
    );
  }
  const margin = checks.find((g) => g.code === "ambiguity")?.value ?? 0;
  const strong = c.support >= 0.95 && c.periodicity >= 0.92 && margin >= 0.15;
  if (!(agrees(before) || agrees(after)))
    return result(
      false,
      ["segment-evidence"],
      "No independently eligible neighbour in the bounded segment supports this candidate.",
    );
  if (!corroborated && !(strong && bilateral))
    return result(
      false,
      ["cross-resolution-unavailable"],
      "No eligible cross-resolution agreement, or very strong evidence supported on both sides.",
    );
  return result(
    true,
    [],
    corroborated
      ? "Independent acoustic gates, cross-resolution agreement and bounded within-segment evidence support recovery; correctness remains unverified."
      : "Very strong six-cycle evidence and bilateral eligible segment support; correctness remains unverified.",
  );
}
