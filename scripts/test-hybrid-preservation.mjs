/** Existing workflows exercised in a real browser with a synthetic microphone device. */
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const base = process.env.STRINGMENTOR_BASE_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
const context = await browser.newContext({ permissions: ["microphone"] }),
  page = await context.newPage();
const report = {
  tests: [],
  status: "running",
  pageErrors: [],
  failedRequests: [],
};
page.on("pageerror", (error) => report.pageErrors.push(error.message));
page.on("requestfailed", (request) =>
  report.failedRequests.push({
    url: request.url(),
    failure: request.failure(),
  }),
);
const nav = async (name) => {
  await page.getByRole("link", { name, exact: true }).first().click();
  const paths = { Playlists: "playlists", Settings: "settings", Recordings: "recordings", "Practice Studio": "practice" };
  await page.waitForURL(new URL(paths[name], `${base}/`).href);
  await page.getByRole("heading", { level: 1 }).filter({ hasText: name }).waitFor();
};
try {
  await page.goto(`${base}/practice`);
  await page
    .getByRole("button", { name: "Start recording audio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop Recording", exact: true })
    .waitFor();
  await page.waitForTimeout(1300);
  await page
    .getByRole("button", { name: "Stop Recording", exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button[aria-label="Play audio"]')].some(
      (b) => !b.disabled,
    ),
  );
  await page
    .getByRole("button", { name: "Play audio", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Pause audio", exact: true })
    .first()
    .click();
  report.tests.push(
    "Microphone permission on click, recording, stop, local save and playback (synthetic Chromium device)",
  );
  await nav("Playlists");
  await page.getByLabel("Create a practice playlist").fill("Hybrid validation");
  await page
    .getByRole("button", { name: "Create playlist", exact: true })
    .click();
  const select = page.getByLabel("Add a recording to Hybrid validation");
  const value = await select.locator("option").nth(1).getAttribute("value");
  await select.selectOption(value);
  await page.getByText("1 tracks", { exact: true }).waitFor();
  await nav("Settings");
  await page
    .getByRole("button", { name: /Violin Your other string voice/ })
    .click();
  await page.waitForFunction(
    () => document.querySelector("#instrument")?.value === "violin",
  );
  // Playwright 1.51's waitForFunction treats an async predicate's Promise as
  // truthy. Poll awaited IDB reads explicitly and wait for the debounced save.
  let persisted = false;
  for (let attempt = 0; attempt < 150 && !persisted; attempt++) {
    persisted = await page.evaluate(
      async () =>
        await new Promise((resolve) => {
          const request = indexedDB.open("stringmentor-studio", 1);
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction("preferences", "readonly");
            const read = tx.objectStore("preferences").get("settings");
            tx.oncomplete = () => {
              resolve(
                read.result?.instrument === "violin" &&
                  read.result.playlists?.[0]?.trackIds.length === 1,
              );
              db.close();
            };
            tx.onerror = () => {
              db.close();
              resolve(false);
            };
          };
          request.onerror = () => resolve(false);
        }),
    );
    if (!persisted) await page.waitForTimeout(100);
  }
  assert.equal(persisted, true, "Preferences committed before refresh");
  await page.reload();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button[aria-pressed='true']")].some((b) =>
      b.textContent.includes("Violin"),
    ),
  );
  assert.equal(
    await page
      .getByRole("button", { name: /Violin Your other string voice/ })
      .getAttribute("aria-pressed"),
    "true",
  );
  await nav("Playlists");
  await page.getByText("1 tracks", { exact: true }).waitFor();
  await nav("Recordings");
  await page.locator(".recording-row").first().waitFor();
  assert.equal(await page.locator(".recording-row").count(), 1);
  assert.match(await page.locator(".recording-detail").innerText(), /Cello/);
  report.tests.push(
    "Playlist membership, recording bytes/metadata and violin setting persist across refresh without relabelling the cello take",
  );
  await page
    .locator(".recording-row")
    .getByRole("button", { name: /Load .* into player/ })
    .click();
  await nav("Practice Studio");
  await page
    .getByRole("button", { name: "Play audio", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Pause audio", exact: true })
    .first()
    .click();
  report.tests.push("Persisted microphone take reloads and plays");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = String(error);
  report.url = page.url();
  report.buttons = await page
    .locator("button[aria-pressed]")
    .evaluateAll((bs) =>
      bs.map((b) => ({
        text: b.textContent,
        pressed: b.getAttribute("aria-pressed"),
      })),
    );
  report.saved = await page.evaluate(
    async () =>
      await new Promise((resolve) => {
        const r = indexedDB.open("stringmentor-studio", 1);
        r.onsuccess = () => {
          const db = r.result,
            t = db.transaction("preferences", "readonly"),
            g = t.objectStore("preferences").get("settings");
          g.onsuccess = () => resolve(g.result);
          t.oncomplete = () => db.close();
        };
        r.onerror = () => resolve("unavailable");
      }),
  );
  writeFileSync(
    "work/hybrid/preservation-body.txt",
    await page.locator("body").innerText(),
  );
  await page.screenshot({
    path: "work/hybrid/preservation-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  writeFileSync(
    "work/hybrid/preservation.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
