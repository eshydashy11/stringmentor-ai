"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { formatTime } from "@/lib/audio";
import {
  createMicrophoneSession,
  idleCapture,
  type CaptureState,
} from "@/lib/microphone";
import { useStudio } from "./studio-provider";

export function MicrophoneRecorder() {
  const studio = useStudio();
  const [capture, setCapture] = useState<CaptureState>(idleCapture);
  const session = useRef<ReturnType<typeof createMicrophoneSession> | null>(
    null,
  );
  const active =
    capture.phase === "requesting" ||
    capture.phase === "recording" ||
    capture.phase === "saving";

  useEffect(() => {
    const leave = () => {
      session.current?.dispose();
      session.current = null;
      setCapture(idleCapture);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      session.current?.dispose();
    };
  }, []);

  function start() {
    if (active || !studio.ready || studio.uploading) return;
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setCapture({
        phase: "error",
        elapsedSeconds: 0,
        message: !window.isSecureContext
          ? "Microphone recording requires HTTPS or localhost. Open the secure site, or upload an audio file."
          : "Microphone recording is unavailable in this browser. Try a current version of Chrome or Safari, or upload an audio file.",
      });
      return;
    }
    session.current?.dispose();
    // Capture this render's upload function and instrument so a mid-take switch
    // in Settings cannot relabel the recording's instrument metadata.
    const upload = studio.upload;
    if (studio.playing) void studio.toggle();
    session.current = createMicrophoneSession({
      instrument: studio.instrument,
      getStream: () => navigator.mediaDevices.getUserMedia({ audio: true }),
      isTypeSupported: (mime) =>
        typeof MediaRecorder.isTypeSupported === "function" &&
        MediaRecorder.isTypeSupported(mime),
      createRecorder: (stream, mimeType) =>
        new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: 128000,
        }),
      prepareBlob: async (blob, durationMs) => {
        if (blob.type.split(";")[0] !== "audio/webm") return blob;
        const { default: fixWebmDuration } = await import("fix-webm-duration");
        return fixWebmDuration(blob, durationMs, { logger: false });
      },
      onComplete: (file) => upload([file]),
      onState: setCapture,
    });
    void session.current.start();
  }

  return (
    <div className="microphone-recorder">
      <div className="microphone-buttons">
        {capture.phase === "recording" ? (
          <button
            type="button"
            className="button stop-recording"
            onClick={() => session.current?.stop()}
          >
            <Square size={15} fill="currentColor" aria-hidden="true" />
            Stop Recording
          </button>
        ) : (
          <button
            type="button"
            className="button primary"
            aria-label="Start recording audio"
            disabled={active || !studio.ready || studio.uploading}
            onClick={start}
          >
            <Mic size={16} aria-hidden="true" />
            {capture.phase === "saving" ? "Preparing audio…" : "Record Audio"}
          </button>
        )}
        {capture.phase === "requesting" && (
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              session.current?.dispose();
              setCapture(idleCapture);
            }}
          >
            <X size={15} aria-hidden="true" />
            Cancel
          </button>
        )}
        {(capture.phase === "recording" || capture.phase === "saving") && (
          <span
            className="recording-timer"
            role="timer"
            aria-label="Recording elapsed time"
            aria-live="off"
          >
            {formatTime(capture.elapsedSeconds)} / 5:00
          </span>
        )}
      </div>
      {capture.message && (
        <p
          className={`microphone-status ${capture.phase === "error" ? "microphone-error" : ""}`}
          role={capture.phase === "error" ? "alert" : "status"}
        >
          {capture.phase === "recording" && (
            <span className="recording-dot" aria-hidden="true" />
          )}
          {capture.message}
        </p>
      )}
      <p className="microphone-help">
        {active
          ? "Stay in Practice Studio to keep this take. Leaving discards an unfinished recording."
          : "Record up to 5 minutes. Audio stays in this browser."}
      </p>
    </div>
  );
}
