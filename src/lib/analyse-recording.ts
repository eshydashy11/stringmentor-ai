import { decodeRecording } from "./decode-audio.ts";
import { CELLO_CONFIG, type PitchResult } from "./pitch.ts";

export async function analyseRecording(
  file: Blob,
  signal: AbortSignal,
  onProgress: (value: number) => void,
): Promise<PitchResult> {
  if (
    typeof OfflineAudioContext === "undefined" ||
    typeof Worker === "undefined"
  )
    throw new Error(
      "Local audio analysis is unavailable in this browser. Try a current Chrome or Safari browser.",
    );
  const audio = await decodeRecording(file, CELLO_CONFIG.sampleRate, signal);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/pitch.worker.ts", import.meta.url),
      { type: "module" },
    );
    const cleanup = () => {
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
        | { type: "progress"; progress: number }
        | { type: "result"; result: PitchResult }
        | { type: "error"; message: string }
      >,
    ) => {
      const message = event.data;
      if (message.type === "progress") onProgress(message.progress);
      else {
        cleanup();
        if (message.type === "result") resolve(message.result);
        else reject(new Error(message.message));
      }
    };
    try {
      // Transfer copies, never detach the AudioBuffer's own channel memory.
      const channels = Array.from(
        { length: audio.numberOfChannels },
        (_, i) => new Float32Array(audio.getChannelData(i)),
      );
      worker.postMessage(
        { channels, config: { ...CELLO_CONFIG, sampleRate: audio.sampleRate } },
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
