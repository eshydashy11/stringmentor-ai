import { analysePitch, CELLO_CONFIG, mixToMono } from "../lib/pitch";
import { analyseTone, clippingEvidence, TONE_CONFIG } from "../lib/tone";

self.onmessage = (
  event: MessageEvent<{ channels: Float32Array[]; sampleRate: number }>,
) => {
  try {
    if (event.data.sampleRate !== TONE_CONFIG.sampleRate)
      throw new Error(
        "This browser could not decode at the required analysis sample rate.",
      );
    const mono = mixToMono(event.data.channels);
    // Reuse the unchanged estimator as context, keeping tone and pitch algorithms separate.
    const pitch = analysePitch(mono, { ...CELLO_CONFIG }, (progress) =>
      self.postMessage({ type: "progress", progress: progress * 0.7 }),
    );
    const result = analyseTone(mono, pitch.frames, (progress) =>
      self.postMessage({ type: "progress", progress: 0.7 + progress * 0.3 }),
    );
    result.clipping = clippingEvidence(event.data.channels);
    // Both views and the mentor share this single pitch pass.
    self.postMessage({ type: "result", result, pitch });
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Tone analysis failed. Try a shorter recording.",
    });
  }
};
