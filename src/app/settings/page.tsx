"use client";
import { Music2, Volume2, ShieldCheck, Sparkles } from "lucide-react";
import { useStudio } from "@/components/studio-provider";
export default function Settings() {
  const studio = useStudio();
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow muted">MAKE YOURSELF AT HOME</div>
          <h1>
            Settings<span className="teal">.</span>
          </h1>
          <p>A few small things to make this space yours.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel settings-card">
          <span className="feature-icon">
            <Music2 size={23} />
          </span>
          <h2>Your instrument</h2>
          <p>Cello is our starting point. Violin is welcome here too.</p>
          <div className="instrument-options">
            {(["cello", "violin"] as const).map((instrument) => (
              <button
                className={studio.instrument === instrument ? "chosen" : ""}
                key={instrument}
                aria-pressed={studio.instrument === instrument}
                onClick={() => studio.setInstrument(instrument)}
              >
                <Music2 size={24} />
                <strong>{instrument === "cello" ? "Cello" : "Violin"}</strong>
                <small>
                  {instrument === "cello"
                    ? "Our first instrument"
                    : "Your other string voice"}
                </small>
              </button>
            ))}
          </div>
        </section>
        <section className="panel settings-card">
          <span className="feature-icon">
            <Volume2 size={23} />
          </span>
          <h2>Playback volume</h2>
          <p>Find a comfortable level for close listening.</p>
          <label htmlFor="settings-volume">
            Volume <strong>{Math.round(studio.volume * 100)}%</strong>
          </label>
          <input
            id="settings-volume"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={studio.volume}
            onChange={(event) => studio.setVolume(Number(event.target.value))}
          />
          <small>Changes apply immediately to the practice player.</small>
        </section>
        <section className="panel settings-card">
          <span className="feature-icon">
            <ShieldCheck size={23} />
          </span>
          <h2>Your music stays with you</h2>
          <p>
            Audio files, playlists, instrument choice, and practice notes are
            saved locally in this browser. Nothing is uploaded to a server or
            sent to an AI service.
          </p>
          <p>
            Storage belongs to this browser and device. Clearing site data
            removes your library. Keep a separate copy of your original files.
          </p>
        </section>
        <section className="panel settings-card">
          <span className="feature-icon">
            <Sparkles size={23} />
          </span>
          <h2>The first movement</h2>
          <p>
            StringMentor AI includes local cello pitch measurements in Practice
            Studio. Tone analysis and AI feedback are not yet implemented.
          </p>
          <span className="not-implemented">
            AI analysis · Not yet implemented
          </span>
        </section>
      </div>
    </>
  );
}
