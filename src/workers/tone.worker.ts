import { analyseExperimentalPitch } from "../lib/experimental-pitch";
import { analysePitch, CELLO_CONFIG, mixToMono } from "../lib/pitch";
import { analyseTone, clippingEvidence, TONE_CONFIG } from "../lib/tone";

self.onmessage = (
  event: MessageEvent<{
    channels: Float32Array[];
    sampleRate: number;
    experimental?: boolean;
  }>,
) => {
  try {
    if (event.data.sampleRate !== TONE_CONFIG.sampleRate)
      throw new Error(
        "This browser could not decode at the required analysis sample rate.",
      );
    const mono = mixToMono(event.data.channels);
    // Reuse the unchanged estimator as context, keeping tone and pitch algorithms separate.
    const started = performance.now();
    const scale = event.data.experimental ? 0.5 : 1;
    const pitch = analysePitch(mono, { ...CELLO_CONFIG }, (progress) =>
      self.postMessage({ type: "progress", progress: progress * 0.7 * scale }),
    );
    const standardMs = performance.now() - started;
    const result = analyseTone(mono, pitch.frames, (progress) =>
      self.postMessage({
        type: "progress",
        progress: (0.7 + progress * 0.3) * scale,
      }),
    );
    result.clipping = clippingEvidence(event.data.channels);
    // Both views and the mentor share this single pitch pass.
    const experimental = event.data.experimental
      ? analyseExperimentalPitch(mono, pitch, {
          tone: result,
          standardMs,
          progress: (p) =>
            self.postMessage({ type: "progress", progress: 0.5 + p * 0.5 }),
        })
      : undefined;
    self.postMessage({ type: "result", result, pitch, experimental });
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
