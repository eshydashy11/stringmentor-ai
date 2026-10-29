"use client";
import { usePracticeAnalysis } from "./practice-analysis-provider";

export function HybridPitchControls({
  selectedIndex,
}: {
  selectedIndex: number;
}) {
  const shared = usePracticeAnalysis(),
    hybrid = shared.result?.hybrid;
  const d = hybrid?.decisions[selectedIndex];
  return (
    <div data-testid="hybrid-diagnostics">
      <p>
        <strong>Hybrid Tiny · experimental, local analysis.</strong> Choose
        Analyse Intonation / Analyse again to run the verified 2 MB model. The
        first run also downloads an 11 MB WebAssembly runtime. Two-minute clip
        limit; this can take longer than the audio, especially on a phone. You
        can cancel at any time.
      </p>
      <p>
        Standard stays the default and supplies Practice Mentor, Explore and
        tone analysis. More usable frames do not establish accuracy. Neural
        activation scores are not correctness probabilities. Full remains
        available in the offline benchmark; it is not offered as a browser mode.
      </p>
      {!hybrid ? (
        <p>
          No Hybrid Tiny result yet. Any existing charts show Standard until
          analysis completes.
        </p>
      ) : (
        <>
          <div className="pitch-stats" role="status">
            <span>
              Hybrid Tiny: {hybrid.pitch.usableFrames}/
              {hybrid.pitch.frames.length} (
              {(hybrid.pitch.coverage * 100).toFixed(1)}%)
            </span>
            <span>
              Standard: {shared.result!.pitch.usableFrames}/
              {shared.result!.pitch.frames.length}
            </span>
            <span>
              {hybrid.stats.recovered} recovered ·{" "}
              {hybrid.stats.neuralRecovered} from Tiny · {hybrid.stats.withheld}{" "}
              withheld
            </span>
            <span>
              {hybrid.stats.disagreements} neural/acoustic disagreements ·{" "}
              {hybrid.stats.harmonicGuards} harmonic guards
            </span>
            <span>
              Processing: {(hybrid.timing.totalMs / 1000).toFixed(2)} s
              (excluding decode) · model load{" "}
              {(hybrid.timing.modelMs / 1000).toFixed(2)} s · neural inference{" "}
              {(hybrid.timing.inferenceMs / 1000).toFixed(2)} s
            </span>
          </div>
          <p>
            Teal: selected hybrid estimate. Ivory dashed: unchanged Standard.
            Gaps stay unresolved. Harmonic guards retain an acoustic estimate or
            withhold a disputed neural estimate; they are not independently
            confirmed corrections. Correct/wrong counts require independent
            labels and are not available for this recording.
          </p>
          <details>
            <summary>Hybrid withheld requirements</summary>
            <p>A frame can fail several gates; counts overlap.</p>
            <ul>
              {Object.entries(
                hybrid.decisions
                  .filter((f) => f.frequency === null)
                  .reduce<Record<string, number>>((counts, f) => {
                    for (const code of f.failed)
                      counts[code] = (counts[code] ?? 0) + 1;
                    return counts;
                  }, {}),
              ).map(([code, count]) => (
                <li key={code}>
                  {code.replaceAll("-", " ")}: {count}
                </li>
              ))}
            </ul>
          </details>
          {d && (
            <details className="pitch-frame-diagnostics" open>
              <summary>
                Hybrid decision at {d.time.toFixed(3)} s ·{" "}
                {d.source ?? "withheld"}
              </summary>
              <p>{d.reason}</p>
              <p>
                Selected: {d.frequency?.toFixed(2) ?? "unresolved"} Hz. CREPE
                candidate: {d.neural.frequency?.toFixed(2) ?? "none"} Hz ·
                activation {d.neural.confidence.toFixed(3)}. Policy{" "}
                {hybrid.version}.
              </p>
              {d.failed.length > 0 && (
                <p>
                  Unmet requirements: {d.failed.join(", ").replaceAll("-", " ")}
                  .
                </p>
              )}
              {d.acoustic && (
                <p>
                  Matching acoustic candidate: {d.acoustic.frequency.toFixed(2)}{" "}
                  Hz · support {d.acoustic.support.toFixed(3)} · periodicity{" "}
                  {d.acoustic.periodicity.toFixed(3)} · score{" "}
                  {d.acoustic.score.toFixed(3)}.
                </p>
              )}
              {d.conflicts.length > 0 && (
                <p>
                  Possible harmonic alternatives (not verified):{" "}
                  {d.conflicts
                    .map(
                      (c) =>
                        `${c.frequency.toFixed(1)} Hz, ${c.ratio}× relation, ${c.source}-sample window`,
                    )
                    .join("; ")}
                  .
                </p>
              )}
              <p>
                Neural activation peaks (unverified):{" "}
                {d.neural.peaks
                  .map(
                    (p) =>
                      `${p.frequency.toFixed(1)} Hz (${p.activation.toFixed(3)})`,
                  )
                  .join("; ") || "none"}
                .
              </p>
            </details>
          )}
        </>
      )}
    </div>
  );
}
