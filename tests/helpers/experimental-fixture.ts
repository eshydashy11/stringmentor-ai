import type { AnalysisBundle } from "../../src/lib/practice-session.ts";
import type { ExperimentalResult } from "../../src/lib/experimental-pitch.ts";
/** Controlled adapter/UI payload, not a claim about acoustic measurements. */
export function experimentalFixture(
  bundle: AnalysisBundle,
): ExperimentalResult {
  return {
    version: "2D.2B.1",
    pitch: bundle.pitch,
    standardMs: 10,
    experimentalMs: 20,
    boundaries: [],
    decisions: bundle.pitch.frames.map((f) => ({
      centreSample: Math.round(f.time * 22050),
      source: 4096,
      status: "standard-retained",
      reason: "Controlled fixture",
      boundary: false,
      shorter: [],
      unresolvedReasons: [],
      supportException: false,
      anchors: [],
    })),
    stats: {
      recovered: 0,
      supportExceptions: 0,
      segmentBoundaries: 0,
      disagreements: 0,
      withheld: 0,
      evaluated2048: 0,
      evaluated1024: 0,
    },
  };
}
