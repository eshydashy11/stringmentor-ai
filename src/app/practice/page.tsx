"use client";
import { AudioLines, NotebookPen } from "lucide-react";
import { Player } from "@/components/player";
import { AnalysisCards } from "@/components/analysis-cards";
import { useStudio } from "@/components/studio-provider";
import { ToneAnalysis } from "@/components/tone-analysis";
import { IntonationAnalysis } from "@/components/intonation-analysis";
import { MicrophoneRecorder } from "@/components/microphone-recorder";
export default function Practice() {
  const studio = useStudio();
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow muted">LISTEN. REFINE. REPEAT.</div>
          <h1>
            Practice Studio<span className="teal">.</span>
          </h1>
          <p>A little space to focus on your sound.</p>
        </div>
        <span className="subtle-badge">
          <AudioLines size={14} />{" "}
          {studio.instrument === "cello" ? "Cello" : "Violin"} studio
        </span>
      </div>
      <div className="studio-grid">
        <Player recordingControls={<MicrophoneRecorder />} />
        <aside className="panel notes-panel">
          <span className="feature-icon">
            <NotebookPen size={23} />
          </span>
          <h2>A note to yourself</h2>
          <p>What would you like to work on today?</p>
          <label className="sr-only" htmlFor="practice-notes">
            Practice notes
          </label>
          <textarea
            id="practice-notes"
            value={studio.notes}
            disabled={!studio.ready}
            onChange={(event) => studio.setNotes(event.target.value)}
            placeholder="Try a slower tempo. Listen to the bow changes. Enjoy the small improvements…"
            maxLength={10000}
          />
          <small>Saved in this browser.</small>
          <div className="practice-tip">
            <span className="eyebrow">PRACTICE REMINDER</span>
            <p>
              Listen once without playing. Notice one thing you’d like to
              explore. Start there.
            </p>
          </div>
        </aside>
      </div>
      <IntonationAnalysis />
      <ToneAnalysis />
      <AnalysisCards hideIntonation hideTone />
      <div className="disclosure panel">
        <AudioLines size={20} />
        <p>
          <strong>Your ears lead the way.</strong> Record with your microphone
          or upload audio to practise. Cello pitch measurements are available
          above, alongside acoustic tone measurements and reviewable
          articulation candidates. AI feedback is not yet implemented. Audio
          stays on your device.
        </p>
      </div>
    </>
  );
}
