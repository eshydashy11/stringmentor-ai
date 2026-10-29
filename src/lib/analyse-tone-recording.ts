import type { HybridResult } from "./hybrid-pitch.ts";
import { decodeRecording } from "./decode-audio.ts";
import { TONE_CONFIG, type ToneResult } from "./tone.ts";
import type { ExperimentalResult } from "./experimental-pitch.ts";
import type { PitchResult } from "./pitch.ts";

export async function analyseToneRecording(
  file: Blob,
  signal: AbortSignal,
  onProgress: (value: number, stage?: string) => void,
  onPitch?: (pitch: PitchResult) => void,
  experimental?: { onResult: (result: ExperimentalResult) => void },
  hybrid?: { onResult: (result: HybridResult) => void },
): Promise<ToneResult> {
  if (
    typeof OfflineAudioContext === "undefined" ||
    typeof Worker === "undefined"
  )
    throw new Error(
      "Local audio analysis is unavailable in this browser. Try a current Chrome or Safari browser.",
    );
  const audio = await decodeRecording(file, TONE_CONFIG.sampleRate, signal);
  signal.throwIfAborted();
  if (hybrid && audio.duration > 120)
    throw new Error(
      "Hybrid Tiny currently supports recordings up to two minutes. Choose a shorter clip or use Standard for this recording.",
    );
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../workers/tone.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      reject(
        new Error(
          "The tone analysis worker could not start. Reload the page or try a current browser.",
        ),
      );
      return;
    }
    let watchdog: ReturnType<typeof setTimeout>;
    const resetWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            "Analysis stopped responding. Try a shorter clip or switch to Standard; your recording is unchanged.",
          ),
        );
      }, 90000);
    };
    const cleanup = () => {
      clearTimeout(watchdog);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Analysis cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    resetWatchdog();
    worker.onerror = () => {
      cleanup();
      reject(
        new Error(
          "The analysis worker could not run. Try again or choose a shorter recording.",
        ),
      );
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(
        new Error("The analysis result could not be read. Please try again."),
      );
    };
    worker.onmessage = (
      event: MessageEvent<
        | { type: "progress"; progress: number; stage?: string }
        | {
            type: "result";
            result: ToneResult;
            pitch?: PitchResult;
            experimental?: ExperimentalResult;
            hybrid?: HybridResult;
          }
        | { type: "error"; message: string }
      >,
    ) => {
      const message = event.data;
      resetWatchdog();
      if (message.type === "progress")
        onProgress(message.progress, message.stage);
      else {
        cleanup();
        if (message.type === "result") {
          if (message.pitch) onPitch?.(message.pitch);
          if (message.experimental)
            experimental?.onResult(message.experimental);
          if (message.hybrid) hybrid?.onResult(message.hybrid);
          resolve(message.result);
        } else reject(new Error(message.message));
      }
    };
    try {
      // Transfer copies, never detach the AudioBuffer's own channel memory.
      const channels = Array.from(
        { length: audio.numberOfChannels },
        (_, i) => new Float32Array(audio.getChannelData(i)),
      );
      worker.postMessage(
        {
          channels,
          sampleRate: audio.sampleRate,
          experimental: !!experimental,
          hybrid: !!hybrid,
        },
        channels.map((c) => c.buffer),
      );
    } catch {
      cleanup();
      reject(
        new Error(
          "Not enough memory to analyse this recording. Try a shorter file.",
        ),
      );
    }
  });
}
