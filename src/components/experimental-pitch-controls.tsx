"use client";
import { usePracticeAnalysis } from "./practice-analysis-provider";

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
            shared.setPitchMode(e.target.value as "standard" | "experimental")
          }
        >
          <option value="standard">Standard — harmonic-aware detector</option>
          <option value="experimental">
            Experimental — multi-resolution comparison
          </option>
        </select>
      </label>
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
                  {comparison.stats.disagreements} disagreements between
                  eligible estimates · {comparison.stats.withheld} withheld
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
                Unresolved disagreements near changing content become adaptive
                gaps; the Standard overlay stays available.
              </p>
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
                    intersects boundary proposal:{" "}
                    {selected.boundary ? "yes" : "no"}. Boundary proposals are
                    not confirmed note onsets or bow changes.
                  </p>
                  {selected.shorter.map((e) => (
                    <div key={e.windowSize}>
                      <strong>{e.windowSize} samples</strong>:{" "}
                      {e.frequency?.toFixed(2) ?? "withheld"} Hz ·{" "}
                      {e.cycles?.toFixed(1) ?? "unknown"} cycles
                      <p>
                        {e.failures.join("; ") ||
                          "Independent evidence gates passed; agreement still required for recovery."}
                      </p>
                      <p>
                        Candidates:{" "}
                        {e.frame.diagnostics?.candidates
                          .map(
                            (c) =>
                              `${c.frequency.toFixed(1)} Hz (support ${c.support.toFixed(2)}, periodicity ${c.periodicity.toFixed(2)}, score ${c.score.toFixed(2)})`,
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
                  {comparison.boundaries.length})
                </summary>
                <p>
                  Local multiband flux, envelope and harmonic changes; uncertain
                  timing intervals. First 100 shown; full evidence is included
                  in Export feedback &amp; reviews.
                </p>
                <ul>
                  {comparison.boundaries.slice(0, 100).map((b) => (
                    <li key={b.centreSample}>
                      {(b.startSample / 22050).toFixed(3)}–
                      {(b.endSample / 22050).toFixed(3)} s: {b.cues.join("; ")}
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
