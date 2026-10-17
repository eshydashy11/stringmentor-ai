"use client";
import { useState, type ReactNode } from "react";
import { useStudio } from "./studio-provider";
import { PracticeAnalysisProvider } from "./practice-analysis-provider";
import { PracticeMentor, FeedbackDiagnostics } from "./practice-mentor";
import { IntonationAnalysis } from "./intonation-analysis";
import { ToneAnalysis } from "./tone-analysis";

export function PracticeExperience({ children }: { children?: ReactNode }) {
  const { current } = useStudio();
  return (
    <PracticeAnalysisProvider key={current?.id ?? "empty"} recording={current}>
      <PracticeLevels key={current?.id ?? "empty"}>{children}</PracticeLevels>
    </PracticeAnalysisProvider>
  );
}
export function PracticeLevels({ children }: { children?: ReactNode }) {
  const [advanced, setAdvanced] = useState(false);
  return (
    <>
      <PracticeMentor />
      {children}
      <section className="performance-level" aria-labelledby="explore-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">02 · EXPLORE YOUR PERFORMANCE</span>
            <h2 id="explore-title">Listen, look, compare</h2>
            <p>
              Pitch, dynamics and tone graphs stay here for everyday practice.
              Highlight a mentor finding to see its passage.
            </p>
          </div>
        </div>
        <div id="explore-pitch" tabIndex={-1}>
          <IntonationAnalysis />
        </div>
        <div id="explore-tone" tabIndex={-1}>
          <ToneAnalysis />
        </div>
      </section>
      <details
        className="panel advanced-level"
        open={advanced}
        onToggle={(event) => setAdvanced(event.currentTarget.open)}
      >
        <summary>
          <span className="eyebrow">03 · ADVANCED DIAGNOSTICS</span>
          <span>Measurements, full articulation review & methods</span>
        </summary>
        {advanced && (
          <>
            <FeedbackDiagnostics />
            <IntonationAnalysis advanced />
            <ToneAnalysis advanced />
          </>
        )}
      </details>
    </>
  );
}
