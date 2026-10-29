import {
  crepeWindow,
  decodeCrepe,
  resampleForCrepe,
  type NeuralEstimate,
} from "./crepe-input.ts";
import type { PitchResult } from "./pitch.ts";

export const TINY_SHA256 =
  "ca2c743a77f1ca69b80f2e5ed43b14fbd5b3121ad9e0556497d487f07a1d33eb";
export const HYBRID_MAX_SECONDS = 120;
const MODEL_PATH = "/models/crepe-tiny-ca2c743a.onnx";
const CACHE = "stringmentor-verified-models-v1";
async function checkedModel(
  progress: (p: number, stage: string) => void,
): Promise<ArrayBuffer> {
  if (!globalThis.crypto?.subtle || typeof WebAssembly === "undefined")
    throw new Error(
      "Hybrid Tiny needs WebAssembly and a secure HTTPS connection. Standard remains available.",
    );
  let cache: Cache | undefined;
  try {
    cache = await caches.open(CACHE);
  } catch {
    /* Private mode/storage limits: verified network load still works. */
  }
  const valid = async (bytes: ArrayBuffer) => {
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    return hash === TINY_SHA256;
  };
  try {
    const response = await cache?.match(MODEL_PATH);
    if (response) {
      const bytes = await response.arrayBuffer();
      if (await valid(bytes)) {
        progress(0.4, "Verified cached CREPE Tiny model");
        return bytes;
      }
      await cache?.delete(MODEL_PATH);
    }
  } catch {
    /* A failed cache read must not disable analysis. */
  }
  progress(0.1, "Downloading CREPE Tiny model (2 MB); audio stays local");
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(MODEL_PATH, {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-cache",
    });
    if (!response.ok)
      throw new Error(`Model download failed (HTTP ${response.status}).`);
    const bytes = await response.arrayBuffer();
    if (!(await valid(bytes)))
      throw new Error(
        "CREPE Tiny model integrity check failed. No unverified model was run.",
      );
    try {
      await cache?.put(
        MODEL_PATH,
        new Response(bytes.slice(0), {
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );
    } catch {
      /* Quota is optional, not an inference failure. */
    }
    progress(0.4, "CREPE Tiny model hash verified");
    return bytes;
  } catch (error) {
    throw new Error(
      `Hybrid Tiny could not load its verified model. ${error instanceof Error ? error.message : "Check your connection and retry."} Standard remains available.`,
    );
  } finally {
    clearTimeout(timer);
  }
}
/** Called only inside the analysis worker after an explicit Hybrid Tiny request. */
export async function inferTiny(
  mono: Float32Array,
  standard: PitchResult,
  progress: (p: number, stage: string) => void,
) {
  if (mono.length / 22050 > HYBRID_MAX_SECONDS)
    throw new Error(
      "Hybrid Tiny currently supports recordings up to two minutes. Choose a shorter clip or use Standard for this recording.",
    );
  const started = performance.now();
  const bytes = await checkedModel((p, stage) => progress(p * 0.1, stage));
  progress(0.05, "Starting CREPE Tiny in a local WebAssembly worker");
  // A separate asynchronous chunk: neither the runtime nor the model is loaded for Standard.
  const ort = await import("onnxruntime-web/wasm").catch(() => {
    throw new Error(
      "Hybrid Tiny could not load its local inference runtime. Reload and retry, or use Standard.",
    );
  });
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = new URL(
    "/vendor/onnxruntime-1.22.0/",
    self.location.origin,
  ).href;
  let session: Awaited<ReturnType<typeof ort.InferenceSession.create>>;
  try {
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  } catch {
    throw new Error(
      "Hybrid Tiny could not start WebAssembly inference. Reload and retry, or use Standard. No hybrid results were generated.",
    );
  }
  const modelMs = performance.now() - started;
  const inferenceStarted = performance.now();
  let inferredFrames = 0;
  const estimates: NeuralEstimate[] = [];
  try {
    progress(0.1, "Resampling audio locally for CREPE Tiny");
    const audio = resampleForCrepe(mono);
    for (let i = 0; i < standard.frames.length; i++) {
      const frame = standard.frames[i];
      if (frame.rms < standard.config.minRms)
        estimates.push({ frequency: null, confidence: 0, peaks: [] });
      else {
        const input = new ort.Tensor(
          "float32",
          crepeWindow(audio, Math.round(frame.time * 22050)),
          [1, 1024],
        );
        const output = await session.run({ frames: input });
        try {
          estimates.push(decodeCrepe(output.activation.data as Float32Array));
        } finally {
          input.dispose();
          Object.values(output).forEach((t) => t.dispose());
        }
        inferredFrames++;
      }
      if (i % 8 === 0) {
        progress(
          0.1 + (0.9 * (i + 1)) / Math.max(1, standard.frames.length),
          `CREPE Tiny: ${i + 1} / ${standard.frames.length} frames`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    progress(1, "Checking harmonic and segment evidence");
    return {
      estimates,
      modelMs,
      inferenceMs: performance.now() - inferenceStarted,
      inferredFrames,
    };
  } finally {
    await session.release();
  }
}
