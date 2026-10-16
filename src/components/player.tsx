"use client";

import { useRef, useState } from "react";
import {
  AudioLines,
  Upload,
  Play,
  Pause,
  RotateCcw,
  Repeat2,
  Volume2,
  Music2,
} from "lucide-react";
import { formatTime, trackTitle } from "@/lib/audio";
import { useStudio } from "./studio-provider";

export function UploadButton({
  secondary = false,
  label = "Upload audio",
}: {
  secondary?: boolean;
  label?: string;
}) {
  const studio = useStudio();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        className={secondary ? "button secondary" : "button primary"}
        disabled={!studio.ready || studio.uploading}
        onClick={() => input.current?.click()}
      >
        <Upload size={16} />
        {studio.uploading ? "Uploading…" : label}
      </button>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm,.opus"
        multiple
        aria-label="Upload audio files"
        onChange={(event) => {
          if (event.target.files) void studio.upload(event.target.files);
          event.target.value = "";
        }}
      />
    </>
  );
}

export function Player({
  compact = false,
  recordingControls,
}: {
  compact?: boolean;
  recordingControls?: React.ReactNode;
}) {
  const studio = useStudio();
  const [dragging, setDragging] = useState(false);
  const loaded = !!studio.current;
  const controls = (
    <div className="transport">
      <button
        className="icon-button"
        aria-label="Replay from beginning"
        disabled={!loaded || studio.duration === 0}
        onClick={() => void studio.replay()}
      >
        <RotateCcw size={compact ? 17 : 20} />
      </button>
      <button
        className="play-button"
        aria-label={studio.playing ? "Pause audio" : "Play audio"}
        disabled={!loaded}
        onClick={() => void studio.toggle()}
      >
        {studio.playing ? (
          <Pause size={compact ? 18 : 23} fill="currentColor" />
        ) : (
          <Play size={compact ? 18 : 23} fill="currentColor" />
        )}
      </button>
      <button
        className={`icon-button ${studio.loop ? "selected" : ""}`}
        aria-label="Loop audio"
        aria-pressed={studio.loop}
        disabled={!loaded}
        onClick={() => studio.setLoop(!studio.loop)}
      >
        <Repeat2 size={compact ? 18 : 20} />
      </button>
    </div>
  );
  const timeline = (
    <div className="timeline">
      <span>{formatTime(studio.position)}</span>
      <input
        aria-label="Seek audio"
        type="range"
        min="0"
        max={studio.duration || 1}
        step="0.1"
        value={Math.min(studio.position, studio.duration || 1)}
        disabled={!loaded || !studio.duration}
        onChange={(event) => studio.seek(Number(event.target.value))}
        style={
          {
            "--progress": `${studio.duration ? (studio.position / studio.duration) * 100 : 0}%`,
          } as React.CSSProperties
        }
      />
      <span>{formatTime(studio.duration)}</span>
    </div>
  );
  const volume = (
    <div className="volume">
      <Volume2 size={17} />
      <input
        aria-label="Audio volume"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={studio.volume}
        onChange={(event) => studio.setVolume(Number(event.target.value))}
      />
    </div>
  );
  if (compact)
    return (
      <div className="compact-player">
        <div className="track-info">
          <div className="track-art">
            <Music2 size={20} />
          </div>
          <div>
            <strong>
              {loaded
                ? trackTitle(studio.current!.name)
                : "Your next session starts here"}
            </strong>
            <small>
              {loaded
                ? `${studio.current!.instrument} · Your audio`
                : "Upload a recording to begin"}
            </small>
          </div>
        </div>
        <div className="compact-transport">
          {controls}
          {timeline}
        </div>
        {volume}
      </div>
    );
  return (
    <section
      className={`studio-player panel ${dragging ? "dragging" : ""}`}
      aria-label="Audio practice player"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (studio.ready && !studio.uploading)
          void studio.upload(event.dataTransfer.files);
      }}
    >
      <div className="panel-heading">
        <span className="eyebrow">
          <AudioLines size={16} /> YOUR PRACTICE PLAYER
        </span>
        <span className="subtle-badge">
          <span className="tiny-dot" /> Local audio
        </span>
      </div>
      <div className="player-center">
        <div
          className={`record-disc ${studio.playing ? "spinning" : ""}`}
          aria-hidden="true"
        >
          <div>
            <Music2 size={31} strokeWidth={1.3} />
          </div>
        </div>
        <h3>
          {loaded
            ? trackTitle(studio.current!.name)
            : "Give your practice a soundtrack"}
        </h3>
        <p>
          {loaded
            ? `${studio.current!.instrument === "cello" ? "Cello" : "Violin"} recording · Listen, pause, and play it again.`
            : "Bring your own recording. Find your rhythm."}
        </p>
      </div>
      {timeline}
      <div className="player-controls">
        <div className="player-volume">{volume}</div>
        {controls}
        <span className="playback-label">
          {studio.playing
            ? "Playing"
            : loaded
              ? "Ready to play"
              : "No audio loaded"}
        </span>
      </div>
      <div
        className={`upload-strip ${recordingControls ? "with-recording" : ""}`}
      >
        <div>
          <Upload size={18} />
          <span>
            {dragging ? "Drop your audio here" : "Drop an audio file here"}
            <small>MP3, WAV, M4A & more · Up to 100 MB per file</small>
          </span>
        </div>
        <div className="audio-input-actions">
          <UploadButton secondary label="Choose file" />
          {recordingControls}
        </div>
      </div>
    </section>
  );
}
