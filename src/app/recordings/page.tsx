"use client";
import { Disc3, Play, Trash2, Music2 } from "lucide-react";
import { useStudio } from "@/components/studio-provider";
import { UploadButton } from "@/components/player";
import { trackTitle } from "@/lib/audio";
export default function Recordings() {
  const studio = useStudio();
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow muted">YOUR SOUND, COLLECTED</div>
          <h1>
            Recordings<span className="teal">.</span>
          </h1>
          <p>Your own recordings and practice tracks, all in one place.</p>
        </div>
        <UploadButton />
      </div>
      <section className="panel library-panel">
        <div className="panel-heading">
          <h2>Your audio library</h2>
          <span className="subtle-badge">
            {studio.recordings.length}{" "}
            {studio.recordings.length === 1 ? "recording" : "recordings"}
          </span>
        </div>
        {!studio.ready ? (
          <p className="loading-text">Opening your library…</p>
        ) : !studio.recordings.length ? (
          <div className="empty-state">
            <span className="empty-icon">
              <Disc3 size={38} strokeWidth={1.2} />
            </span>
            <h2>Every session starts with a note.</h2>
            <p>
              Upload your first audio file to listen and practise.
              <br />
              Your recordings are stored in this browser.
            </p>
            <UploadButton label="Add your first recording" />
          </div>
        ) : (
          <div className="recording-list">
            {studio.recordings.map((track) => (
              <div
                className={`recording-row ${studio.current?.id === track.id ? "current" : ""}`}
                key={track.id}
              >
                <span className="track-art">
                  <Music2 size={22} />
                </span>
                <div className="recording-detail">
                  <strong>{trackTitle(track.name)}</strong>
                  <small>
                    {track.instrument === "cello" ? "Cello" : "Violin"} ·{" "}
                    {(track.size / 1024 / 1024).toFixed(1)} MB ·{" "}
                    {new Date(track.addedAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </small>
                </div>
                <button
                  className="button secondary small"
                  onClick={() => studio.select(track)}
                  aria-label={`Load ${track.name} into player`}
                >
                  <Play size={14} />
                  {studio.current?.id === track.id ? "Loaded" : "Load"}
                </button>
                <button
                  className="icon-button delete-button"
                  aria-label={`Delete ${track.name}`}
                  onClick={() => void studio.remove(track.id)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="disclosure panel">
        <Disc3 size={20} />
        <p>
          <strong>A personal audio library.</strong> Upload MP3, WAV, M4A, and
          other browser-supported audio formats up to 100 MB per file. This
          library also includes microphone takes recorded in Practice Studio.
          There is no streaming catalogue.
        </p>
      </div>
    </>
  );
}
