import { PitchDetector } from "pitchy";
import {
  CELLO_CONFIG,
  frequencyToPitch,
  type PitchFrame,
  type PitchResult,
} from "./pitch.ts";
import { createHarmonicEstimator } from "./pitch-candidates.ts";
import {
  experimentalBoundaries,
  classifyBoundary,
  type BoundaryProposal,
} from "./experimental-boundaries.ts";
import {
  candidateChecks,
  supportOnlyNearMiss,
  selectRecovery,
  centsDistance as distance,
  type GateCheck,
  type LocalAnchor,
} from "./experimental-evidence.ts";
import type { ToneResult } from "./tone.ts";
export { EXPERIMENTAL_RULES } from "./experimental-evidence.ts";

export const EXPERIMENTAL_VERSION = "2D.2B.1";
export type ResolutionEvidence = {
  windowSize: 2048 | 1024;
  centreSample: number;
  frequency: number | null;
  candidateFrequency: number | null;
  cycles: number | null;
  failures: string[];
  checks: GateCheck[];
  supportOnlyNearMiss: boolean;
  frame: PitchFrame;
};
export type AdaptiveDecision = {
  centreSample: number;
  source: 4096 | 2048 | null;
  status: "standard-retained" | "recovered" | "unresolved" | "disagreement";
  reason: string;
  boundary: boolean;
  shorter: ResolutionEvidence[];
  unresolvedReasons: string[];
  supportException: boolean;
  anchors: LocalAnchor[];
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
    supportExceptions: number;
    disagreements: number;
    withheld: number;
    evaluated2048: number;
    evaluated1024: number;
    segmentBoundaries: number;
  };
};
/** Additive comparison only. Never mutates Standard or uses a recovered frame as evidence. */
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
  options.progress?.(0);
  const proposals = experimentalBoundaries(samples, standard, options.tone);
  const caches = new Map<number, Map<number, ResolutionEvidence>>();
  const estimators = new Map<
    number,
    ReturnType<typeof createHarmonicEstimator>
  >();
  const detectors = new Map<number, PitchDetector<Float32Array>>();
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
      const detector = PitchDetector.forFloat32Array(size);
      detector.clarityThreshold = config.peakThreshold;
      detectors.set(size, detector);
    }
    const buffer = samples.slice(centre - size / 2, centre + size / 2);
    let dc = 0,
      energy = 0;
    for (const v of buffer) dc += v;
    dc /= buffer.length;
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] -= dc;
      energy += buffer[i] ** 2;
    }
    const rms = Math.sqrt(energy / size),
      quiet = rms < config.minRms;
    const candidates = quiet ? [] : estimators.get(size)!(buffer).candidates;
    const top = candidates[0];
    // Raw score margin is meaningful even if the baseline tracker rejected every candidate.
    const margin = top ? top.score - (candidates[1]?.score ?? 0) : 0;
    const checks = candidateChecks(top, margin, size, rms);
    const failures = checks
      .filter((g) => !g.passed)
      .map((g) =>
        g.value === null
          ? g.label
          : `${g.label}: ${g.value.toFixed(3)}${g.required === null ? " (outside range)" : ` < ${g.required}`}`,
      );
    const [raw, clarity] = quiet
      ? [0, 0]
      : detectors.get(size)!.findPitch(buffer, 22050);
    const useRaw =
      !!top &&
      raw >= 55 &&
      raw <= 1000 &&
      clarity >= 0.9 &&
      distance(raw, top.frequency) <= 15;
    const candidateFrequency = top ? (useRaw ? raw : top.frequency) : null;
    const frequency = failures.length ? null : candidateFrequency;
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
        selectedCandidate: top ? 0 : null,
        corrected: !useRaw,
        margin,
        decision: quiet
          ? "silence"
          : failures.length
            ? "weak-evidence"
            : "spectral",
        detail:
          failures.join("; ") ||
          "Independent short-window gates passed; segment selection is separate.",
      },
    };
    const evidence: ResolutionEvidence = {
      windowSize: size,
      centreSample: centre,
      frequency,
      candidateFrequency,
      cycles: top ? (top.frequency * size) / 22050 : null,
      failures,
      checks,
      supportOnlyNearMiss: supportOnlyNearMiss(top, checks),
      frame,
    };
    cache.set(centre, evidence);
    return evidence;
  }
  const available = (centre: number, size = 2048) =>
    centre >= size / 2 && centre + size / 2 <= samples.length;
  // Side windows are separately gated and never use recovered outputs. No circular segmentation.
  const boundaries = proposals.map((b) =>
    classifyBoundary(
      b,
      [-1536, -1024].map((s) =>
        available(b.centreSample + s)
          ? measure(b.centreSample + s, 2048).frequency
          : null,
      ),
      [1024, 1536].map((s) =>
        available(b.centreSample + s)
          ? measure(b.centreSample + s, 2048).frequency
          : null,
      ),
    ),
  );
  const segments = boundaries.filter((b) => b.usedForSegmentation);
  const nearBoundary = (centre: number, radius: number) =>
    segments.some(
      (b) => b.startSample <= centre + radius && b.endSample >= centre - radius,
    );
  const between = (a: number, b: number) =>
    segments.some(
      (p) =>
        p.centreSample > Math.min(a, b) && p.centreSample <= Math.max(a, b),
    );
  const decisions: AdaptiveDecision[] = [];
  const frames = standard.frames.map((long, i) => {
    const centre = 2048 + i * 512,
      boundary = nearBoundary(centre, 2048);
    const shorter: ResolutionEvidence[] = [];
    let unresolvedReasons: string[] = [],
      supportException = false,
      anchors: LocalAnchor[] = [];
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
        unresolvedReasons,
        supportException,
        anchors,
      });
      return frame;
    };
    if (i % 32 === 0)
      options.progress?.(i / Math.max(1, standard.frames.length));
    if (long.frequency !== null && !boundary)
      return record(
        4096,
        "standard-retained",
        "Standard estimate retained away from supported segment boundaries.",
        long,
      );
    if (long.rejection === "silence") {
      unresolvedReasons = ["amplitude"];
      return record(
        null,
        "unresolved",
        `Below amplitude threshold: Standard RMS ${long.rms.toFixed(5)} < ${CELLO_CONFIG.minRms}.`,
        long,
      );
    }
    const medium = measure(centre, 2048);
    shorter.push(medium);
    let small: ResolutionEvidence | undefined;
    // Even a support-only near miss may request corroboration. The short window never establishes the register.
    if (
      options.use1024 !== false &&
      (medium.frequency !== null || medium.supportOnlyNearMiss) &&
      (medium.candidateFrequency! * 1024) / 22050 >= 6
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
      // A short-window conflict must not erase a stable long-window note during within-note variation.
      const stableLong = [-1, 1].every((offset) => {
        const other = standard.frames[i + offset];
        return (
          other?.frequency != null &&
          !between(centre, centre + offset * 512) &&
          distance(long.frequency!, other.frequency) <= 80
        );
      });
      if (disagreement && !stableLong) {
        unresolvedReasons = ["cross-resolution-disagreement"];
        return record(
          null,
          "disagreement",
          "Eligible resolutions disagree near a segment boundary without bilateral Standard support; experimental pitch withheld.",
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
                    "Unresolved cross-resolution conflict; unchanged Standard remains available separately.",
                }
              : undefined,
          },
        );
      }
      return record(
        4096,
        "standard-retained",
        disagreement
          ? "Bilateral stable Standard evidence retained despite a short-window conflict; the conflict is visible in resolution diagnostics."
          : "Accepted Standard estimate protected; shorter-window clarity cannot override it.",
        long,
      );
    }
    anchors = [-1024, -512, 512, 1024]
      .filter((s) => available(centre + s) && !between(centre, centre + s))
      .map((s) => measure(centre + s, 2048))
      .filter((e) => e.frequency !== null)
      .map((e) => ({ centreSample: e.centreSample, frequency: e.frequency! }));
    const selection = selectRecovery({
      candidate: medium.frame.diagnostics?.candidates[0],
      checks: medium.checks,
      frequency: medium.candidateFrequency,
      centreSample: centre,
      anchors,
      corroboratingFrequency: small?.frequency ?? null,
      boundaryOverlap: nearBoundary(centre, 0),
    });
    unresolvedReasons = selection.codes;
    supportException = selection.supportException;
    if (!selection.accepted)
      return record(
        null,
        selection.codes.includes("cross-resolution-disagreement")
          ? "disagreement"
          : "unresolved",
        selection.reason,
        long,
      );
    const frequency = medium.candidateFrequency!;
    const p = frequencyToPitch(frequency);
    const { rejection: _rejection, ...measured } = medium.frame;
    void _rejection;
    return record(2048, "recovered", selection.reason, {
      ...measured,
      frequency,
      midi: p.midi,
      note: p.note,
      cents: p.cents,
      diagnostics: measured.diagnostics
        ? { ...measured.diagnostics, detail: selection.reason }
        : undefined,
    });
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
      supportExceptions: decisions.filter((d) => d.supportException).length,
      disagreements: decisions.filter((d) => d.status === "disagreement")
        .length,
      withheld: frames.length - usable.length,
      evaluated2048: caches.get(2048)?.size ?? 0,
      evaluated1024: caches.get(1024)?.size ?? 0,
      segmentBoundaries: segments.length,
    },
  };
}
