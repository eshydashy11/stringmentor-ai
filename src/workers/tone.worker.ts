import { selectHybrid } from "../lib/hybrid-pitch";
import type { HybridResult } from "../lib/hybrid-pitch";
import { analyseExperimentalPitch } from "../lib/experimental-pitch";
import { analysePitch, CELLO_CONFIG, mixToMono } from "../lib/pitch";
import { analyseTone, clippingEvidence, TONE_CONFIG } from "../lib/tone";

self.onmessage = async (
  event: MessageEvent<{
    channels: Float32Array[];
    sampleRate: number;
    experimental?: boolean;
    hybrid?: boolean;
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
    const scale = event.data.hybrid ? 0.15 : event.data.experimental ? 0.5 : 1;
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
    const experimental =
      event.data.experimental || event.data.hybrid
        ? analyseExperimentalPitch(mono, pitch, {
            tone: result,
            standardMs,
            progress: (p) =>
              self.postMessage({
                type: "progress",
                progress: scale + p * scale,
              }),
          })
        : undefined;
    let hybrid: HybridResult | undefined;
    if (event.data.hybrid && experimental) {
      const { inferTiny, TINY_SHA256 } = await import("../lib/crepe-browser");
      const neural = await inferTiny(mono, pitch, (p, stage) =>
        self.postMessage({ type: "progress", progress: 0.3 + p * 0.68, stage }),
      );
      const arbitrationStart = performance.now();
      hybrid = {
        ...selectHybrid(pitch, experimental, neural.estimates),
        timing: {
          modelMs: neural.modelMs,
          inferenceMs: neural.inferenceMs,
          arbitrationMs: performance.now() - arbitrationStart,
          totalMs: performance.now() - started,
          inferredFrames: neural.inferredFrames,
        },
        model: {
          sha256: TINY_SHA256,
          runtime: "onnxruntime-web 1.22.0",
          backend: "wasm-simd-single-thread",
        },
      };
    }
    self.postMessage({ type: "result", result, pitch, experimental, hybrid });
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
