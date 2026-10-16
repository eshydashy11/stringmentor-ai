import { MAX_FILE_SIZE, validateAudio } from "./audio.ts";

export const MAX_RECORDING_MS = 5 * 60 * 1000;
const RECORDING_FORMATS = [
  "audio/webm;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/ogg",
];
const extensions: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};
export type CaptureState = {
  phase: "idle" | "requesting" | "recording" | "saving" | "complete" | "error";
  elapsedSeconds: number;
  message: string;
};
export const idleCapture: CaptureState = {
  phase: "idle",
  elapsedSeconds: 0,
  message: "",
};

export function recordingFile(
  blob: Blob,
  instrument: "cello" | "violin",
  date: Date,
): File {
  const extension = extensions[blob.type.split(";")[0].trim().toLowerCase()];
  if (!extension)
    throw new Error(
      "Your browser produced an unsupported audio format. Try another browser.",
    );
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replaceAll(":", ".");
  const title = instrument === "cello" ? "Cello" : "Violin";
  const file = new File(
    [blob],
    `${title} Practice — ${day} — ${time}.${extension}`,
    { type: blob.type, lastModified: date.getTime() },
  );
  const problem = validateAudio(file);
  if (problem) throw new Error(problem);
  return file;
}

export function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access was denied. Allow microphone access in your browser’s site settings, then try Record Audio again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found. Connect a microphone and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "The microphone could not be opened. Close other apps using it and try again.";
    case "NotSupportedError":
      return "This browser cannot record a supported audio format. Try a current version of Chrome or Safari, or upload an audio file.";
    case "AbortError":
      return "Microphone recording was interrupted. Check your microphone and try again.";
    default:
      return error instanceof Error
        ? error.message
        : "Recording failed. Check your microphone and try again.";
  }
}

type CaptureOptions = {
  instrument: "cello" | "violin";
  getStream: () => Promise<MediaStream>;
  isTypeSupported: (mime: string) => boolean;
  createRecorder: (stream: MediaStream, mime?: string) => MediaRecorder;
  prepareBlob: (blob: Blob, durationMs: number) => Promise<Blob>;
  onComplete: (file: File) => Promise<void>;
  onState: (state: CaptureState) => void;
  now?: () => number;
  date?: () => Date;
};

// Owns one take. Permission resolution, native events, timers, and disposal can race.
// All terminal paths release the device and ignore late events from that take.
export function createMicrophoneSession(options: CaptureOptions) {
  const now = options.now ?? (() => performance.now());
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let chunks: Blob[] = [];
  let bytes = 0;
  let started = false;
  let disposed = false;
  let closed = false;
  let finishing = false;
  let stopping = false;
  let startedAt = 0;
  let durationMs = 0;
  let recordedAt: Date;
  let reason: "manual" | "limit" | "interrupted" = "manual";
  let ticker: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let finalizationDeadline: ReturnType<typeof setTimeout> | undefined;
  const elapsed = () => Math.max(0, now() - startedAt);
  const notify = (
    phase: CaptureState["phase"],
    message: string,
    ms = durationMs,
  ) => {
    if (!disposed)
      options.onState({
        phase,
        message,
        elapsedSeconds: Math.floor(ms / 1000),
      });
  };
  function release() {
    clearInterval(ticker);
    clearTimeout(deadline);
    stream?.getTracks().forEach((track) => {
      track.removeEventListener("ended", disconnected);
      track.stop();
    });
    stream = undefined;
  }
  function detach() {
    if (!recorder) return;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
  }
  function discard() {
    detach();
    clearTimeout(finalizationDeadline);
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      /* Tracks still must be released if the recorder has already failed. */
    }
    release();
    chunks = [];
  }
  function fail(error: unknown) {
    if (closed || disposed) return;
    closed = true;
    discard();
    notify("error", microphoneError(error));
  }
  function stop(stopReason: typeof reason = "manual") {
    if (closed || disposed || stopping || !recorder) return;
    stopping = true;
    reason = stopReason;
    durationMs = elapsed();
    notify("saving", "Preparing your recording…");
    // Final data is delivered before onstop, including when Safari batches chunks.
    finalizationDeadline = setTimeout(
      () =>
        fail(
          new Error(
            "Your browser did not finish the recording. Please try again.",
          ),
        ),
      15000,
    );
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch (error) {
      fail(error);
    }
    release();
  }
  function disconnected() {
    stop("interrupted");
  }
  async function finish() {
    if (closed || disposed || finishing) return;
    finishing = true;
    clearTimeout(finalizationDeadline);
    if (!stopping) durationMs = elapsed();
    release();
    detach();
    notify("saving", "Preparing your recording…");
    try {
      if (!bytes)
        throw new Error(
          "No audio was captured. Check your microphone and try a longer recording.",
        );
      const mime =
        chunks.find((chunk) => chunk.type)?.type || recorder?.mimeType || "";
      const blob = new Blob(chunks, { type: mime });
      chunks = [];
      const prepared = await options.prepareBlob(blob, Math.max(1, durationMs));
      if (disposed) return;
      const file = recordingFile(prepared, options.instrument, recordedAt);
      await options.onComplete(file);
      if (disposed) return;
      closed = true;
      notify(
        "complete",
        reason === "limit"
          ? "Five-minute limit reached. Your recording is ready in the player."
          : reason === "interrupted"
            ? "The microphone disconnected. Captured audio is ready in the player."
            : "Recording ready. Press Play to listen.",
      );
    } catch (error) {
      fail(error);
    }
  }
  async function start() {
    if (started || disposed) return;
    started = true;
    notify("requesting", "Waiting for microphone permission…");
    try {
      const acquired = await options.getStream();
      if (disposed || closed) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = acquired;
      if (
        !stream.getAudioTracks().some((track) => track.readyState === "live")
      ) {
        throw new Error(
          "No active microphone is available. Check your device and try again.",
        );
      }
      const formats: (string | undefined)[] = [
        ...RECORDING_FORMATS.filter(options.isTypeSupported),
        undefined,
      ];
      for (const mime of formats) {
        try {
          recorder = options.createRecorder(stream, mime);
          break;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.name !== "NotSupportedError" ||
            mime === undefined
          )
            throw error;
        }
      }
      if (!recorder)
        throw new Error("Your browser could not start an audio recorder.");
      recorder.ondataavailable = (event) => {
        if (disposed || closed || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > MAX_FILE_SIZE) {
          fail(
            new Error(
              "Recording exceeded the 100 MB limit and was not saved. Try a shorter take.",
            ),
          );
          return;
        }
        chunks.push(event.data);
        if (!stopping && elapsed() >= MAX_RECORDING_MS) stop("limit");
      };
      recorder.onerror = () =>
        fail(
          new Error(
            "Your browser could not finish recording audio. Check your microphone and try again.",
          ),
        );
      recorder.onstop = () => {
        void finish();
      };
      stream
        .getTracks()
        .forEach((track) =>
          track.addEventListener("ended", disconnected, { once: true }),
        );
      recordedAt = options.date?.() ?? new Date();
      startedAt = now();
      recorder.start(1000);
      notify("recording", "Recording · Microphone on", 0);
      ticker = setInterval(() => {
        const ms = elapsed();
        if (ms >= MAX_RECORDING_MS) stop("limit");
        else notify("recording", "Recording · Microphone on", ms);
      }, 250);
      deadline = setTimeout(() => stop("limit"), MAX_RECORDING_MS);
    } catch (error) {
      fail(error);
    }
  }
  return {
    start,
    stop: () => stop(),
    dispose: () => {
      disposed = true;
      closed = true;
      discard();
    },
  };
}
