import { PitchDetector } from "pitchy";
import {
  CELLO_CONFIG,
  frequencyToPitch,
  type PitchFrame,
  type PitchResult,
} from "./pitch.ts";
import {
  createHarmonicEstimator,
  trackCandidates,
  type PitchCandidate,
} from "./pitch-candidates.ts";
import {
  experimentalBoundaries,
  type BoundaryProposal,
} from "./experimental-boundaries.ts";
import type { ToneResult } from "./tone.ts";

export const EXPERIMENTAL_VERSION = "2D.2A.1";
export const EXPERIMENTAL_RULES = {
  support: 0.8,
  periodicity: 0.75,
  score: 0.65,
  margin: 0.08,
  minCycles: 6,
  agreementCents: 35,
  neighbourCents: 80,
} as const;
export type ResolutionEvidence = {
  windowSize: 2048 | 1024;
  centreSample: number;
  frequency: number | null;
  cycles: number | null;
  failures: string[];
  frame: PitchFrame;
};
export type AdaptiveDecision = {
  centreSample: number;
  source: 4096 | 2048 | null;
  status: "standard-retained" | "recovered" | "unresolved" | "disagreement";
  reason: string;
  boundary: boolean;
  shorter: ResolutionEvidence[];
};
export type ExperimentalResult = {
  version: typeof EXPERIMENTAL_VERSION;
  pitch: PitchResult;
  decisions: AdaptiveDecision[];
  boundaries: BoundaryProposal[];
  standardMs: number;
  experimentalMs: number;
  stats: {
    recovered: number;
    disagreements: number;
    withheld: number;
    evaluated2048: number;
    evaluated1024: number;
  };
};
const distance = (a: number, b: number) => Math.abs(1200 * Math.log2(a / b));
function eligibility(
  c: PitchCandidate | undefined,
  margin: number,
  size: number,
): string[] {
  if (!c) return ["no eligible harmonic candidate"];
  const failures = [];
  if (!c.primitive) failures.push("non-primitive harmonic family");
  if (c.support < EXPERIMENTAL_RULES.support)
    failures.push("harmonic support < 0.8");
  if (c.periodicity < EXPERIMENTAL_RULES.periodicity)
    failures.push("periodicity < 0.75");
  if (c.score < EXPERIMENTAL_RULES.score)
    failures.push("candidate score < 0.65");
  if (margin < EXPERIMENTAL_RULES.margin)
    failures.push("candidate margin < 0.08");
  if (
    (c.frequency * size) / CELLO_CONFIG.sampleRate <
    EXPERIMENTAL_RULES.minCycles
  )
    failures.push("fewer than six cycles");
  return failures;
}
/** Additive comparison only. The supplied Standard result is never mutated. */
export function analyseExperimentalPitch(
  samples: Float32Array,
  standard: PitchResult,
  options: {
    tone?: ToneResult;
    standardMs?: number;
    use1024?: boolean;
    progress?: (p: number) => void;
  } = {},
): ExperimentalResult {
  if (
    standard.config.sampleRate !== 22050 ||
    standard.config.windowSize !== 4096 ||
    standard.config.hopSize !== 512 ||
    Math.abs(standard.duration - samples.length / 22050) > 1e-6
  )
    throw new Error(
      "Experimental comparison requires matching Standard 4096/512 audio at 22050 Hz.",
    );
  const start = performance.now();
  const boundaries = experimentalBoundaries(samples, standard, options.tone);
  const caches = new Map<number, Map<number, ResolutionEvidence>>();
  const estimators = new Map<
    number,
    ReturnType<typeof createHarmonicEstimator>
  >();
  const detectors = new Map<number, PitchDetector<Float32Array>>();
  const nearBoundary = (centre: number, radius: number) =>
    boundaries.some(
      (b) => b.startSample <= centre + radius && b.endSample >= centre - radius,
    );
  const between = (a: number, b: number) =>
    boundaries.some(
      (p) =>
        p.centreSample > Math.min(a, b) && p.centreSample <= Math.max(a, b),
    );
  function measure(centre: number, size: 2048 | 1024): ResolutionEvidence {
    let cache = caches.get(size);
    if (!cache) {
      cache = new Map();
      caches.set(size, cache);
    }
    const cached = cache.get(centre);
    if (cached) return cached;
    const config = { ...CELLO_CONFIG, windowSize: size, neighbourFrames: 0 };
    if (!estimators.has(size)) {
      estimators.set(size, createHarmonicEstimator(config));
      const d = PitchDetector.forFloat32Array(size);
      d.clarityThreshold = config.peakThreshold;
      detectors.set(size, d);
    }
    const buffer = samples.slice(centre - size / 2, centre + size / 2);
    let dc = 0;
    for (const v of buffer) dc += v;
    dc /= buffer.length;
    let energy = 0;
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] -= dc;
      energy += buffer[i] ** 2;
    }
    const rms = Math.sqrt(energy / size),
      quiet = rms < config.minRms;
    const candidates = quiet ? [] : estimators.get(size)!(buffer).candidates;
    const decision = trackCandidates([{ candidates, quiet }], config)[0];
    const top = decision.candidate;
    const failures = quiet
      ? ["silence"]
      : eligibility(top ?? candidates[0], decision.margin, size);
    if (!top && !failures.length) failures.push(`tracker: ${decision.reason}`);
    const [raw, clarity] = quiet
      ? [0, 0]
      : detectors.get(size)!.findPitch(buffer, 22050);
    const useRaw =
      top &&
      raw >= 55 &&
      raw <= 1000 &&
      clarity >= 0.9 &&
      distance(raw, top.frequency) <= 15;
    const frequency =
      top && !failures.length ? (useRaw ? raw : top.frequency) : null;
    const p = frequency === null ? null : frequencyToPitch(frequency);
    const frame: PitchFrame = {
      time: centre / 22050,
      frequency,
      midi: p?.midi ?? null,
      note: p?.note ?? null,
      cents: p?.cents ?? null,
      rms,
      clarity: top?.periodicity ?? 0,
      ...(frequency === null
        ? {
            rejection: quiet
              ? ("silence" as const)
              : ("weak-harmonics" as const),
          }
        : {}),
      diagnostics: {
        rawFrequency: raw > 0 && Number.isFinite(raw) ? raw : null,
        rawClarity: clarity,
        candidates,
        selectedCandidate: top ? candidates.indexOf(top) : null,
        corrected: !useRaw,
        margin: decision.margin,
        decision: decision.reason,
        detail: failures.length
          ? failures.join("; ")
          : "Independent short-window harmonic evidence passed; no cross-boundary neighbour bonus.",
      },
    };
    const evidence = {
      windowSize: size,
      centreSample: centre,
      frequency,
      cycles: top ? (top.frequency * size) / 22050 : null,
      failures,
      frame,
    };
    cache.set(centre, evidence);
    return evidence;
  }
  const decisions: AdaptiveDecision[] = [];
  const frames = standard.frames.map((long, i) => {
    const centre = 2048 + i * 512,
      boundary = nearBoundary(centre, 2048);
    const shorter: ResolutionEvidence[] = [];
    const record = (
      source: AdaptiveDecision["source"],
      status: AdaptiveDecision["status"],
      reason: string,
      frame: PitchFrame,
    ) => {
      decisions.push({
        centreSample: centre,
        source,
        status,
        reason,
        boundary,
        shorter,
      });
      return frame;
    };
    if (i % 32 === 0)
      options.progress?.(i / Math.max(1, standard.frames.length));
    if (long.frequency !== null && !boundary)
      return record(
        4096,
        "standard-retained",
        "Standard estimate retained away from acoustic boundary proposals.",
        long,
      );
    if (long.rejection === "silence")
      return record(
        null,
        "unresolved",
        "Standard quiet-frame gate retained.",
        long,
      );
    const medium = measure(centre, 2048);
    shorter.push(medium);
    let small: ResolutionEvidence | undefined;
    // 1024 can corroborate a register independently supported by 2048; never establishes its own register.
    if (
      options.use1024 !== false &&
      medium.frequency !== null &&
      (medium.frequency * 1024) / 22050 >= 6
    ) {
      small = measure(centre, 1024);
      shorter.push(small);
    }
    const disagreement =
      medium.frequency !== null &&
      ((small?.frequency != null &&
        distance(medium.frequency, small.frequency) > 35) ||
        (long.frequency !== null &&
          distance(long.frequency, medium.frequency) > 50));
    if (long.frequency !== null) {
      // Standard remains immutable/visible, but unresolved experimental conflicts are gaps.
      if (disagreement)
        return record(
          null,
          "disagreement",
          "Eligible estimates disagree near changing content. Adaptive pitch withheld; inspect the unchanged Standard overlay.",
          {
            ...long,
            frequency: null,
            midi: null,
            note: null,
            cents: null,
            rejection: "ambiguous",
            diagnostics: long.diagnostics
              ? {
                  ...long.diagnostics,
                  detail:
                    "Unresolved multi-resolution disagreement; Standard estimate is available separately.",
                }
              : undefined,
          },
        );
      return record(
        4096,
        "standard-retained",
        "Standard accepted estimate protected; shorter-window clarity does not override it.",
        long,
      );
    }
    if (medium.frequency === null || disagreement)
      return record(
        null,
        disagreement ? "disagreement" : "unresolved",
        disagreement
          ? "Reliable short-window candidates disagree; no pitch assigned."
          : "2048 candidate failed independent gates.",
        long,
      );
    if (nearBoundary(centre, 256))
      return record(
        null,
        "unresolved",
        "Frame centre lies inside an uncertain boundary interval.",
        long,
      );
    const neighbours = [-512, 512]
      .filter(
        (shift) =>
          centre + shift >= 2048 &&
          centre + shift <= 2048 + (standard.frames.length - 1) * 512 &&
          !between(centre, centre + shift),
      )
      .map((shift) => measure(centre + shift, 2048));
    const localAgreement = neighbours.some(
      (n) =>
        n.frequency !== null && distance(n.frequency, medium.frequency!) <= 80,
    );
    if (!localAgreement)
      return record(
        null,
        "unresolved",
        "No independently eligible neighbouring frame within the proposed segment.",
        long,
      );
    const c =
      medium.frame.diagnostics!.candidates[
        medium.frame.diagnostics!.selectedCandidate!
      ];
    const corroborated =
      small?.frequency != null &&
      distance(small.frequency, medium.frequency) <= 35;
    const strongMedium =
      c.support >= 0.95 &&
      c.periodicity >= 0.92 &&
      medium.frame.diagnostics!.margin >= 0.15;
    if (!corroborated && !strongMedium)
      return record(
        null,
        "unresolved",
        "No cross-resolution agreement or very strong 2048 evidence.",
        long,
      );
    return record(
      2048,
      "recovered",
      corroborated
        ? "2048 evidence agrees with cycle-eligible 1024 and a within-segment neighbour; recovery is not ground-truth correctness."
        : "Very strong six-cycle 2048 evidence and a within-segment neighbour; recovery is not ground-truth correctness.",
      medium.frame,
    );
  });
  const usable = frames.filter((f) => f.frequency !== null);
  options.progress?.(1);
  return {
    version: EXPERIMENTAL_VERSION,
    pitch: {
      ...standard,
      frames,
      usableFrames: usable.length,
      coverage: frames.length ? usable.length / frames.length : 0,
      meanClarity: usable.length
        ? usable.reduce((s, f) => s + f.clarity, 0) / usable.length
        : 0,
      sufficient: (usable.length * 512) / 22050 >= 0.5,
      observations: [],
    },
    decisions,
    boundaries,
    standardMs: options.standardMs ?? 0,
    experimentalMs: performance.now() - start,
    stats: {
      recovered: decisions.filter((d) => d.status === "recovered").length,
      disagreements: decisions.filter((d) => d.status === "disagreement")
        .length,
      withheld: frames.length - usable.length,
      evaluated2048: caches.get(2048)?.size ?? 0,
      evaluated1024: caches.get(1024)?.size ?? 0,
    },
  };
}
