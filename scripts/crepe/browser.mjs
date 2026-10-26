/** Separate localhost-only feasibility harness. No production app dependencies. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(
  new URL("../../work/crepe/browser-env/package.json", import.meta.url),
);
const { chromium } = require("playwright-core");
const modelsRoot = resolve("work/crepe/browser");
const ortRoot = resolve(
  "work/crepe/browser-env/node_modules/onnxruntime-web/dist",
);
const fixture = JSON.parse(
  readFileSync(resolve(modelsRoot, "fixtures.json"), "utf8"),
);
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Offline CREPE feasibility benchmark</title></head><body>Local synthetic benchmark only<script type="module">
import * as ort from '/ort/ort.wasm.min.mjs';
ort.env.wasm.numThreads=1;
ort.env.wasm.wasmPaths='/ort/';
ort.env.wasm.proxy=false;
window.ortReady=true;
window.loadModel=async capacity=>{
 const start=performance.now();
 window.fixtures=await (await fetch('/fixtures.json')).json();
 window.session=await ort.InferenceSession.create('/'+capacity+'.onnx',{executionProviders:['wasm'],graphOptimizationLevel:'all'});
 window.capacity=capacity;
 return {loadMs:performance.now()-start,crossOriginIsolated:window.crossOriginIsolated,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency};
};
window.measure=async repetitions=>{
 const fixture=window.fixtures;
 const model=fixture.models.find(m=>m.capacity===window.capacity);
 const times=[];let maxError=0;const differences=[];
 for(let i=0;i<3;i++) await window.session.run({frames:new ort.Tensor('float32',new Float32Array(fixture.frames[i]),[1,1024])});
 for(let repeat=0;repeat<repetitions;repeat++)for(let i=0;i<fixture.frames.length;i++){
  const input=new ort.Tensor('float32',new Float32Array(fixture.frames[i]),[1,1024]);
  const start=performance.now();const result=await window.session.run({frames:input});times.push(performance.now()-start);
  const output=result.activation.data;let error=0;
  for(let k=0;k<360;k++)error=Math.max(error,Math.abs(output[k]-model.referenceActivations[i][k]));
  maxError=Math.max(maxError,error);differences.push(error);
 }
 if(maxError>0.0001)throw new Error('ONNX/WASM activation mismatch: '+maxError);
 return {timesMs:times,maxActivationError:maxError,differences,jsHeapUsedBytes:performance.memory?.usedJSHeapSize??null};
};
</script></body></html>`;
const server = createServer((req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
    return;
  }
  const base = url.pathname.startsWith("/ort/") ? ortRoot : modelsRoot;
  const name = url.pathname.startsWith("/ort/")
    ? url.pathname.slice(5)
    : url.pathname.slice(1);
  const path = resolve(base, name);
  if (!path.startsWith(base + "/") || !existsSync(path)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    path.endsWith(".wasm")
      ? "application/wasm"
      : path.endsWith(".mjs") || path.endsWith(".js")
        ? "application/javascript"
        : path.endsWith(".json")
          ? "application/json"
          : "application/octet-stream",
  );
  res.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const rows = [];
const rss = (processes) =>
  processes.reduce((sum, p) => {
    try {
      return (
        sum +
        Number(
          readFileSync(`/proc/${p.id}/status`, "utf8").match(
            /^VmRSS:\s+(\d+)/m,
          )?.[1] ?? 0,
        ) *
          1024
      );
    } catch {
      return sum;
    }
  }, 0);
try {
  for (const capacity of ["tiny", "full"]) {
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--enable-precise-memory-info"],
    });
    try {
      const system = await browser.newBrowserCDPSession();
      const page = await browser.newPage();
      page.setDefaultTimeout(120000);
      await page.goto(`http://127.0.0.1:${port}`);
      await page.waitForFunction(() => window.ortReady);
      const pre = await system.send("SystemInfo.getProcessInfo");
      const beforeRss = rss(pre.processInfo);
      const load = await page.evaluate(
        (capacity) => window.loadModel(capacity),
        capacity,
      );
      let peakRss = rss(
          (await system.send("SystemInfo.getProcessInfo")).processInfo,
        ),
        reading = false;
      const sampler = setInterval(async () => {
        if (reading) return;
        reading = true;
        try {
          peakRss = Math.max(
            peakRss,
            rss((await system.send("SystemInfo.getProcessInfo")).processInfo),
          );
        } catch {
        } finally {
          reading = false;
        }
      }, 200);
      const session = await page.context().newCDPSession(page);
      const measurements = [];
      try {
        for (const throttle of [1, 4]) {
          await session.send("Emulation.setCPUThrottlingRate", {
            rate: throttle,
          });
          const before = await system.send("SystemInfo.getProcessInfo");
          const result = await page.evaluate(() => window.measure(3));
          const after = await system.send("SystemInfo.getProcessInfo");
          const cpuSeconds = after.processInfo.reduce(
            (sum, p) =>
              sum +
              Math.max(
                0,
                p.cpuTime -
                  (before.processInfo.find((b) => b.id === p.id)?.cpuTime ?? 0),
              ),
            0,
          );
          measurements.push({
            cpuThrottleRate: throttle,
            ...result,
            browserProcessCpuSeconds: cpuSeconds,
          });
          console.log(
            capacity,
            "CPU throttle",
            throttle,
            "mean ms",
            result.timesMs.reduce((a, b) => a + b, 0) / result.timesMs.length,
          );
        }
      } finally {
        clearInterval(sampler);
      }
      const model = fixture.models.find((m) => m.capacity === capacity);
      rows.push({
        capacity,
        onnxBytes: model.bytes,
        onnxGzipBytes: model.gzipBytes,
        onnxSha256: model.sha256,
        opset: model.opset,
        load,
        beforeRssBytes: beforeRss,
        sampledProcessRssSumPeakBytes: peakRss,
        measurements,
      });
      writeFileSync(
        "work/crepe/run/browser.json",
        JSON.stringify(
          {
            completed: rows.length === 2,
            createdAt: new Date().toISOString(),
            manifestSha256: fixture.manifestSha256,
            fixtureSha256: createHash("sha256")
              .update(readFileSync(resolve(modelsRoot, "fixtures.json")))
              .digest("hex"),
            backend:
              "ONNX Runtime Web 1.22.0 WASM SIMD; one thread; headless desktop Chromium",
            samples: fixture.choices,
            physicalMobileTested: false,
            memoryCaveat:
              "RSS sums can double-count shared pages, sampled every 200ms; JS heap excludes some native/WASM allocations.",
            cases: rows,
          },
          null,
          2,
        ),
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
