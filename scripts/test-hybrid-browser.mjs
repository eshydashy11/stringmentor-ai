/** Real production UI/worker test. Run against `npm run start`, never a mocked model. */
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const root = "work/hybrid";
mkdirSync(root, { recursive: true });
const base = process.env.STRINGMENTOR_BASE_URL || "http://127.0.0.1:3000";
const input = process.env.STRINGMENTOR_CELLO_SAMPLE_PATH || "";
if (!input)
  throw new Error(
    "Set STRINGMENTOR_CELLO_SAMPLE_PATH to the original Cello Open Strings sample.m4a for the mandatory real regression.",
  );
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
const requests = [],
  errors = [];
page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
page.on("pageerror", (e) => errors.push(e.message));
const report = { startedAt: new Date().toISOString(), buildId: readFileSync(".next/BUILD_ID", "utf8").trim(), base, tests: [], errors };
const save = () =>
  writeFileSync(`${root}/browser-ui.json`, JSON.stringify(report, null, 2));
await context.addInitScript(() => {
  window.__workerResults = [];
  window.__workerMessages = [];
  window.__workers = [];
  window.__decodes = 0;
  window.__workerError = null;
  const Original = window.Worker;
  window.__NativeWorker = Original;
  window.Worker = class extends Original {
    constructor(url, options) {
      super(url, options);
      window.__workers.push(String(url));
      this.addEventListener("message", (e) => {
        if (e.data?.type === "error") window.__workerError = e.data.message;
        if (e.data?.type === "result" && e.data.pitch) {
          window.__workerResults.push(e.data);
          window.__analysisWorkerUrl = String(url);
        }
        if (e.data?.type === "progress") window.__workerMessages.push(e.data);
      });
    }
  };
  const decode = OfflineAudioContext.prototype.decodeAudioData;
  OfflineAudioContext.prototype.decodeAudioData = function (...args) {
    window.__decodes++;
    return decode.apply(this, args);
  };
});
const advance = async () => {
  await page.locator(".advanced-level > summary").click();
  await page.getByLabel("Pitch analysis mode").waitFor();
};
const analyse = async () => {
  await page.evaluate(() => {
    window.__workerError = null;
  });
  await page
    .locator('[aria-labelledby="advanced-intonation-title"]')
    .getByRole("button", { name: /Analyse/ })
    .click();
};
const waitResult = async (count) => {
  await page.waitForFunction(
    (n) =>
      window.__workerResults.length >= n ||
      window.__workerError ||
      [...document.querySelectorAll('[role="alert"]')].some(
        (e) =>
          e.textContent.includes("Hybrid Tiny") ||
          e.textContent.includes("analysis worker"),
      ),
    count,
    { timeout: 240000 },
  );
  const workerError = await page.evaluate(() => window.__workerError);
  if (workerError) throw new Error(workerError);
  const alerts = await page.locator('[role="alert"]').allTextContents();
  if (alerts.some((t) => /Hybrid Tiny|analysis worker/.test(t)))
    throw new Error(alerts.join(" "));
};
try {
  await page.goto(`${base}/practice`);
  await page.getByLabel("Upload audio files").setInputFiles(input);
  await page
    .getByRole("button", { name: "Play audio", exact: true })
    .first()
    .waitFor();
  await advance();
  assert.equal(
    await page.getByLabel("Pitch analysis mode").inputValue(),
    "standard",
  );
  await analyse();
  await waitResult(1);
  assert.ok(
    !requests.some(
      (r) => r.url.includes(".onnx") || r.url.includes("/vendor/"),
    ),
  );
  report.tests.push(
    "Standard default; no model/runtime request during Standard analysis",
  );
  save();
  const before = await page.evaluate(() => window.__workerResults[0]);
  writeFileSync(
    `${root}/worker-url.json`,
    JSON.stringify({
      workerUrl: await page.evaluate(() => window.__analysisWorkerUrl),
    }),
  );
  await page.getByLabel("Pitch analysis mode").selectOption("hybrid-tiny");
  await analyse();
  await page.waitForFunction(
    () => window.__workerMessages.some((m) => m.stage?.includes("CREPE")),
    null,
    { timeout: 60000 },
  );
  await waitResult(2);
  const measured = await page.evaluate(() => ({
    result: window.__workerResults[1],
    decodes: window.__decodes,
    progress: window.__workerMessages,
  }));
  const result = measured.result;
  assert.ok(
    await page
      .locator('[aria-labelledby="advanced-intonation-title"]')
      .getByText(/Hybrid-specific practice observations are not implemented/)
      .isVisible(),
  );
  assert.ok(
    await page
      .locator('[aria-labelledby="advanced-intonation-title"]')
      .getByText(/Standard reference evidence at this timestamp/)
      .isVisible(),
  );
  assert.ok(result.hybrid);
  assert.equal(measured.decodes, 2);
  assert.deepEqual(
    result.pitch.frames.map((f) => f.frequency),
    before.pitch.frames.map((f) => f.frequency),
  );
  assert.deepEqual(result.result, before.result);
  assert.ok(
    await page
      .getByTestId("hybrid-diagnostics")
      .getByText(/Hybrid Tiny: /)
      .isVisible(),
  );
  assert.ok(
    (await page
      .locator('[aria-labelledby="advanced-intonation-title"] .recharts-line')
      .count()) > 0,
  );
  assert.ok(
    result.hybrid.decisions.every(
      (d, i) => d.time === result.pitch.frames[i].time,
    ),
  );
  const c2 = result.hybrid.pitch.frames.filter(
    (f) => f.time >= 1.4 && f.time < 4.2,
  );
  assert.equal(
    c2.filter(
      (f) =>
        f.frequency !== null &&
        Math.abs(1200 * Math.log2(f.frequency / 65.40639132514966)) > 50,
    ).length,
    0,
  );
  report.tests.push(
    "Real original M4A decoded once per job; complete WASM Tiny analysis, progress, graph and aligned diagnostics; C2 no wrong accepted frames; Standard/tone identical",
  );
  report.v1 = {
    timing: result.hybrid.timing,
    stats: result.hybrid.stats,
    c2: {
      total: c2.length,
      accepted: c2.filter((f) => f.frequency !== null).length,
    },
  };
  writeFileSync(`${root}/ui-v1-result.json`, JSON.stringify(result));
  save();
  // Seeking and mode changes reuse results; no decoding or inference repeats.
  await page.locator("#advanced-pitch-timestamp").fill("100");
  await page.locator("#advanced-pitch-timestamp").dispatchEvent("change");
  await page
    .locator('[aria-labelledby="advanced-intonation-title"]')
    .getByRole("button", { name: "Seek player to timestamp" })
    .click();
  assert.ok(
    await page.evaluate(() => document.querySelector("audio").currentTime > 2),
  );
  await page.getByLabel("Pitch analysis mode").selectOption("standard");
  await page.getByLabel("Pitch analysis mode").selectOption("hybrid-tiny");
  assert.equal(await page.evaluate(() => window.__decodes), 2);
  await page
    .getByRole("button", { name: "Play audio", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Pause audio", exact: true })
    .first()
    .click();
  report.tests.push(
    "Playback and timestamp inspection work; mode switching reuses completed results",
  );
  save();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export feedback/ }).click();
  const download = await downloadPromise;
  await download.saveAs(`${root}/review-export.json`);
  const exported = JSON.parse(
    readFileSync(`${root}/review-export.json`, "utf8"),
  );
  assert.ok(exported.hybridComparison);
  report.tests.push("Review export includes hybrid evidence separately");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.getByLabel("Pitch analysis mode").isVisible());
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
  );
  await page.screenshot({ path: `${root}/mobile-layout.png`, fullPage: true });
  report.tests.push(
    "390px responsive layout has no horizontal page overflow (desktop emulation, not phone speed)",
  );
  save();
  // Cache hit succeeds when model network is blocked; cancel a new inference job.
  await page.route("**/models/*.onnx", (route) => route.abort());
  await analyse();
  await page.waitForFunction(
    () =>
      window.__workerMessages.some((m) => m.stage?.includes("cached CREPE")),
    null,
    { timeout: 60000 },
  );
  await page
    .locator('[aria-labelledby="advanced-intonation-title"]')
    .getByRole("button", { name: "Cancel analysis" })
    .click();
  await page
    .locator('[aria-labelledby="advanced-intonation-title"]')
    .getByText("Analysis cancelled. Your recording is unchanged.")
    .waitFor();
  report.tests.push(
    "Verified model cache reused with model network blocked; cancellation terminates job",
  );
  await page.unroute("**/models/*.onnx");
  // Bad model: must reject it, never silently show a completed hybrid graph.
  await page.evaluate(() => caches.delete("stringmentor-verified-models-v1"));
  await page.route("**/models/*.onnx", (route) =>
    route.fulfill({ status: 200, body: "not a verified model" }),
  );
  await analyse();
  await page
    .locator('[aria-labelledby="advanced-intonation-title"]')
    .getByRole("alert")
    .filter({ hasText: /integrity/ })
    .waitFor({ timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__workerResults.length), 2);
  report.tests.push(
    "Corrupt model rejected by SHA-256 with actionable error; no false result",
  );
  await page.unroute("**/models/*.onnx");
  // Standard still succeeds after hybrid failure.
  await page.getByLabel("Pitch analysis mode").selectOption("standard");
  await analyse();
  await waitResult(3);
  report.tests.push("Standard succeeds after hybrid failure");
  // Offline cold-load failure.
  await page.getByLabel("Pitch analysis mode").selectOption("hybrid-tiny");
  await page.route("**/models/*.onnx", (route) => route.abort());
  await analyse();
  await page
    .locator('[aria-labelledby="advanced-intonation-title"]')
    .getByRole("alert")
    .filter({ hasText: /could not load/ })
    .waitFor({ timeout: 60000 });
  report.tests.push("Cold model download failure is explicit and recoverable");
  await page.unroute("**/models/*.onnx");
  const workerUrl = await page.evaluate(() => window.__analysisWorkerUrl);
  writeFileSync(`${root}/worker-url.json`, JSON.stringify({ workerUrl }));
  await page.reload();
  await advance();
  assert.equal(
    await page.getByLabel("Pitch analysis mode").inputValue(),
    "standard",
  );
  await page
    .getByRole("link", { name: "Recordings", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", {
      name: /Load Cello Open Strings sample.m4a into player/,
    })
    .click();
  await page
    .getByRole("link", { name: "Practice Studio", exact: true })
    .first()
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button[aria-label="Play audio"]')].some(
      (b) => !b.disabled,
    ),
  );
  report.tests.push(
    "Stored recording survives refresh; analysis mode resets to Standard",
  );
  assert.deepEqual(errors, []);
  const external = requests.filter(
    (r) =>
      !r.url.startsWith(base) &&
      !r.url.startsWith("blob:") &&
      !r.url.startsWith("data:"),
  );
  assert.deepEqual(external, []);
  assert.ok(requests.every((r) => r.method === "GET"));
  report.tests.push(
    "No audio or analysis network upload; only same-origin GET requests",
  );
  report.status = "passed";
  save();
  console.log(
    JSON.stringify(
      { status: report.status, tests: report.tests, v1: report.v1 },
      null,
      2,
    ),
  );
} catch (error) {
  report.status = "failed";
  report.failure = String(error);
  save();
  await page.screenshot({ path: `${root}/failure.png`, fullPage: true });
  throw error;
} finally {
  await browser.close();
}
