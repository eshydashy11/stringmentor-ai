import { analysePitch, mixToMono, type PitchConfig } from "../lib/pitch";

self.onmessage = (
  event: MessageEvent<{ channels: Float32Array[]; config: PitchConfig }>,
) => {
  try {
    const result = analysePitch(
      mixToMono(event.data.channels),
      event.data.config,
      (progress) => self.postMessage({ type: "progress", progress }),
    );
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Pitch analysis failed. Try a shorter recording.",
    });
  }
};
