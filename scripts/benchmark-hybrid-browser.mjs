/** All inference uses the built production worker, including the actual JS resampler. */
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = "work/hybrid",
  manifestBytes = readFileSync(`${root}/manifest.json`),
  manifest = JSON.parse(manifestBytes);
const base = process.env.STRINGMENTOR_BASE_URL || "http://127.0.0.1:3000";
const { workerUrl } = JSON.parse(
  readFileSync(`${root}/worker-url.json`, "utf8"),
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const context = await browser.newContext(),
  page = await context.newPage();
const output = {
  version: 1,
  createdAt: new Date().toISOString(),
  manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
  policySha256: manifest.policySha256,
  buildId: readFileSync(".next/BUILD_ID", "utf8").trim(),
  sourceHashes: Object.fromEntries(["src/lib/hybrid-pitch.ts", "src/lib/crepe-input.ts", "src/lib/crepe-browser.ts", "src/workers/tone.worker.ts"].map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
  cases: [],
};
try {
  await page.goto(`${base}/practice`);
  output.environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    crossOriginIsolated: crossOriginIsolated,
  }));
  const fixtures = JSON.parse(
    readFileSync("tests/fixtures/crepe-tiny-reference.json", "utf8"),
  );
  // Verify all 360 activations against the upstream-verified PyTorch export, in this unisolated origin.
  output.parity = await page.evaluate(async (fixtures) => {
    const ort = await import("/vendor/onnxruntime-1.22.0/ort.wasm.min.mjs");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "/vendor/onnxruntime-1.22.0/";
    const session = await ort.InferenceSession.create(
      "/models/crepe-tiny-ca2c743a.onnx",
      { executionProviders: ["wasm"] },
    );
    let maxError = 0;
    const expected = fixtures.models.find((m) => m.capacity === "tiny");
    for (let i = 0; i < fixtures.frames.length; i++) {
      const tensor = new ort.Tensor(
        "float32",
        Float32Array.from(fixtures.frames[i]),
        [1, 1024],
      );
      const result = await session.run({ frames: tensor });
      for (let k = 0; k < 360; k++)
        maxError = Math.max(
          maxError,
          Math.abs(
            result.activation.data[k] - expected.referenceActivations[i][k],
          ),
        );
      tensor.dispose();
      result.activation.dispose();
    }
    await session.release();
    return { maxActivationError: maxError, frames: fixtures.frames.length };
  }, fixtures);
  assert.ok(output.parity.maxActivationError < 1e-4);
  for (const c of manifest.cases) {
    const bytes = readFileSync(c.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), c.pcmSha256);
    const samples = Array.from(
      new Float32Array(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      ),
    );
    const measured = await page.evaluate(
      async ({ samples, workerUrl }) => {
        const worker = new Worker(workerUrl),
          mono = Float32Array.from(samples),
          start = performance.now();
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            worker.terminate();
            reject(
              new Error(
                "Production worker exceeded ten-minute validation deadline",
              ),
            );
          }, 600000);
          worker.onerror = (e) => {
            clearTimeout(timer);
            worker.terminate();
            reject(new Error(e.message));
          };
          worker.onmessage = (e) => {
            if (e.data.type === "error") {
              clearTimeout(timer);
              worker.terminate();
              reject(new Error(e.data.message));
            }
            if (e.data.type === "result") {
              clearTimeout(timer);
              worker.terminate();
              resolve({ result: e.data, wallMs: performance.now() - start });
            }
          };
          worker.postMessage(
            {
              channels: [mono],
              sampleRate: 22050,
              experimental: true,
              hybrid: true,
            },
            [mono.buffer],
          );
        });
      },
      { samples, workerUrl },
    );
    const { result, wallMs } = measured;
    assert.equal(result.hybrid.pitch.frames.length, c.targets.length);
    const row = {
      id: c.id,
      wallMs,
      standard: result.pitch.frames.map((f) => f.frequency),
      experimental: result.experimental.pitch.frames.map((f) => f.frequency),
      hybrid: result.hybrid.pitch.frames.map((f) => f.frequency),
      neural: result.hybrid.decisions.map((d) => ({
        frequency: d.neural.frequency,
        confidence: d.neural.confidence,
      })),
      decisions: result.hybrid.decisions.map(
        ({
          time,
          frequency,
          source,
          reason,
          failed,
          conflicts,
          harmonicGuard,
        }) => ({
          time,
          frequency,
          source,
          reason,
          failed,
          conflicts,
          harmonicGuard,
        }),
      ),
      stats: result.hybrid.stats,
      timing: result.hybrid.timing,
      standardMs: result.experimental.standardMs,
      experimentalAdditionalMs: result.experimental.experimentalMs,
    };
    output.cases.push(row);
    writeFileSync(`${root}/browser-corpus.json`, JSON.stringify(output));
    console.log(
      c.id,
      `${result.pitch.usableFrames}/${result.experimental.pitch.usableFrames}/${result.hybrid.pitch.usableFrames} usable of ${c.targets.length}`,
      `${(wallMs / 1000).toFixed(2)}s`,
    );
  }
  output.completed = true;
  writeFileSync(`${root}/browser-corpus.json`, JSON.stringify(output));
} finally {
  await browser.close();
}
