"use client";
import { HybridPitchControls } from "./hybrid-pitch-controls";
import { usePracticeAnalysis } from "./practice-analysis-provider";

const REQUIREMENT_LABELS: Record<string, string> = {
  amplitude: "Below amplitude threshold",
  "harmonic-support": "Weak harmonic support",
  periodicity: "Insufficient periodicity",
  score: "Low candidate score",
  ambiguity: "Candidate ambiguity",
  "cross-resolution-disagreement": "Cross-resolution disagreement",
  "boundary-overlap": "Boundary overlap",
  "cross-resolution-unavailable": "No eligible cross-resolution corroboration",
  "segment-conflict": "Conflicting eligible segment evidence",
  "segment-evidence": "Insufficient segment support",
  "bilateral-evidence": "Missing eligible evidence on both sides",
  cycles: "Too few cycles",
  primitive: "Non-primitive harmonic family",
  range: "Out of range",
  "no-candidate": "No harmonic candidate",
};

export function ExperimentalPitchControls({
  selectedIndex,
}: {
  selectedIndex: number;
}) {
  const shared = usePracticeAnalysis();
  const comparison = shared.result?.experimental;
  const selected = comparison?.decisions[selectedIndex];
  return (
    <div className="pitch-notice">
      <label className="mentor-controls">
        Pitch analysis mode
        <select
          aria-label="Pitch analysis mode"
          value={shared.pitchMode}
          disabled={shared.busy}
          onChange={(e) =>
            shared.setPitchMode(
              e.target.value as "standard" | "experimental" | "hybrid-tiny",
            )
          }
        >
          <option value="standard">Standard — harmonic-aware detector</option>
          <option value="experimental">
            Experimental — multi-resolution comparison
          </option>
          <option value="hybrid-tiny">
            Hybrid Tiny — guarded CREPE comparison
          </option>
        </select>
      </label>
      {shared.pitchMode === "hybrid-tiny" && (
        <HybridPitchControls selectedIndex={selectedIndex} />
      )}
      {shared.pitchMode === "experimental" && (
        <>
          <p>
            <strong>Experimental · not validated for musical accuracy.</strong>{" "}
            Choose Analyse Intonation / Analyse again above to compute a
            comparison. Both paths share one audio decode. Switching this view
            reuses completed results.
          </p>
          <p>
            Practice Mentor, Explore and tone analysis still use Standard
            measurements. Reanalysis resets session reviews. More recovered
            frames does not mean more correct notes.
          </p>
          {!comparison ? (
            <p>
              No experimental comparison for this analysis yet. The charts
              currently show Standard.
            </p>
          ) : (
            <>
              <div className="pitch-stats" role="status">
                <span>
                  Standard: {shared.result!.pitch.usableFrames}/
                  {shared.result!.pitch.frames.length} (
                  {(shared.result!.pitch.coverage * 100).toFixed(1)}%)
                </span>
                <span>
                  Experimental: {comparison.pitch.usableFrames}/
                  {comparison.pitch.frames.length} (
                  {(comparison.pitch.coverage * 100).toFixed(1)}%)
                </span>
                <span>
                  {comparison.stats.recovered} recovered ·{" "}
                  {comparison.stats.disagreements} withheld for cross-resolution
                  conflicts · {comparison.stats.withheld} withheld ·{" "}
                  {comparison.stats.supportExceptions} support-only exceptions
                </span>
                <span>
                  Standard pitch: {(comparison.standardMs / 1000).toFixed(2)} s
                  · experimental additional work:{" "}
                  {(comparison.experimentalMs / 1000).toFixed(2)} s (excludes
                  decode/tone)
                </span>
              </div>
              <p>
                Teal: adaptive estimate. Ivory dashed: Standard. Gaps remain
                missing measurements. Stable Standard estimates are retained.
                Unresolved conflicts near supported segment boundaries remain
                gaps; the Standard overlay stays available. No gaps are
                interpolated.
              </p>
              <details>
                <summary>Why frames remain withheld</summary>
                <p>
                  A frame can fail several requirements; these counts overlap.
                </p>
                <ul>
                  {Object.entries(
                    comparison.decisions
                      .filter(
                        (d) =>
                          d.status === "unresolved" ||
                          d.status === "disagreement",
                      )
                      .reduce<Record<string, number>>((counts, d) => {
                        for (const code of d.unresolvedReasons)
                          counts[code] = (counts[code] ?? 0) + 1;
                        return counts;
                      }, {}),
                  ).map(([code, count]) => (
                    <li key={code}>
                      {REQUIREMENT_LABELS[code] ?? code}: {count}
                    </li>
                  ))}
                </ul>
              </details>
              {selected && (
                <details className="pitch-frame-diagnostics">
                  <summary>
                    Adaptive decision at{" "}
                    {(selected.centreSample / 22050).toFixed(3)} s ·{" "}
                    {selected.status}
                  </summary>
                  <p>{selected.reason}</p>
                  <p>
                    Source: {selected.source ?? "none"} samples · long window
                    intersects a supported segment boundary:{" "}
                    {selected.boundary ? "yes" : "no"}. Boundary proposals are
                    not confirmed note onsets or bow changes.
                  </p>
                  {selected.unresolvedReasons.length > 0 && (
                    <p>
                      Withheld requirements:{" "}
                      {selected.unresolvedReasons
                        .map((code) => REQUIREMENT_LABELS[code] ?? code)
                        .join("; ")}
                      .
                    </p>
                  )}
                  {selected.supportException && (
                    <p>
                      Support-only exception applied. The original failed gate
                      remains below; this does not establish the true note.
                    </p>
                  )}
                  {selected.anchors.length > 0 && (
                    <p>
                      Independently gated neighbours:{" "}
                      {selected.anchors
                        .map(
                          (a) =>
                            `${(a.centreSample / 22050).toFixed(3)} s: ${a.frequency.toFixed(1)} Hz`,
                        )
                        .join("; ")}
                      . Overlapping windows are not statistically independent.
                    </p>
                  )}
                  {selected.shorter.map((e) => (
                    <div key={e.windowSize}>
                      <strong>{e.windowSize} samples</strong>:{" "}
                      {e.frequency?.toFixed(2) ?? "withheld"} Hz ·{" "}
                      {e.cycles?.toFixed(1) ?? "unknown"} cycles
                      <p>
                        Best measured candidate (unverified):{" "}
                        {e.candidateFrequency?.toFixed(2) ?? "none"} Hz. Raw
                        periodicity estimate:{" "}
                        {e.frame.diagnostics?.rawFrequency?.toFixed(2) ??
                          "none"}{" "}
                        Hz.
                      </p>
                      <ul aria-label={`${e.windowSize}-sample acoustic gates`}>
                        {e.checks.map((g) => (
                          <li key={g.code}>
                            {g.label}:{" "}
                            {g.value === null
                              ? "unavailable"
                              : g.value.toFixed(3)}
                            {g.required !== null
                              ? `; requires ≥ ${g.required}`
                              : ""}
                            {g.passed ? " — passed" : " — failed"}
                            {g.nearMiss &&
                            g.value !== null &&
                            g.required !== null
                              ? ` (near threshold; short by ${(g.required - g.value).toFixed(3)})`
                              : ""}
                          </li>
                        ))}
                      </ul>
                      <p>
                        {e.failures.join("; ") ||
                          "Independent evidence gates passed; agreement still required for recovery."}
                      </p>
                      <p>
                        Candidates:{" "}
                        {e.frame.diagnostics?.candidates
                          .map(
                            (c) =>
                              `${c.frequency.toFixed(1)} Hz (support ${c.support.toFixed(2)}, periodicity ${c.periodicity.toFixed(2)}, score ${c.score.toFixed(2)}, relative frequency ${(c.frequency / e.frame.diagnostics!.candidates[0].frequency).toFixed(2)}×, harmonics ${c.harmonics.join("/")}, ${c.primitive ? "primitive" : "non-primitive"})`,
                          )
                          .join("; ") || "none"}
                      </p>
                    </div>
                  ))}
                </details>
              )}
              <details>
                <summary>
                  Experimental boundary proposals (
                  {comparison.boundaries.length};{" "}
                  {comparison.stats.segmentBoundaries} used for segmentation)
                </summary>
                <p>
                  Local multiband flux, envelope and harmonic changes; uncertain
                  timing intervals. A proposal requires persistent pitch change
                  or coincident envelope/low-band change to constrain tracking.
                  Neither category confirms a note onset or bow reversal. First
                  100 shown; full evidence is included in Export feedback &amp;
                  reviews.
                </p>
                <ul>
                  {comparison.boundaries.slice(0, 100).map((b) => (
                    <li key={b.centreSample}>
                      {(b.startSample / 22050).toFixed(3)}–
                      {(b.endSample / 22050).toFixed(3)} s: {b.cues.join("; ")}.{" "}
                      {b.interpretation}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </>
      )}
    </div>
  );
}
