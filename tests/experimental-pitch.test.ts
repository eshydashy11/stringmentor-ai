import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { analysePitch, CELLO_CONFIG } from "../src/lib/pitch.ts";
import { analyseExperimentalPitch } from "../src/lib/experimental-pitch.ts";
import { makeSequence } from "../scripts/lib/fast-pitch-audit.ts";
import { extraCases } from "../scripts/lib/experimental-cases.ts";

test("experimental analysis is aligned, immutable and independently gated; optional 1024 cannot override by clarity", () => {
  const signal = makeSequence("fast", [43, 50, 55, 59, 62, 59, 55, 50], 0.125);
  const standard = analysePitch(signal.samples),
    before = structuredClone(standard);
  const adaptive = analyseExperimentalPitch(signal.samples, standard);
  assert.deepEqual(standard, before);
  assert.equal(adaptive.pitch.frames.length, standard.frames.length);
  adaptive.decisions.forEach((d, i) => {
    assert.equal(d.centreSample, 2048 + 512 * i);
    assert.equal(adaptive.pitch.frames[i].time, standard.frames[i].time);
    if (d.status === "recovered") {
      assert.equal(standard.frames[i].frequency, null);
      const m = d.shorter.find((e) => e.windowSize === 2048)!;
      assert.ok(m.cycles! >= 6);
      if (d.supportException) {
        assert.ok(m.supportOnlyNearMiss);
        assert.equal(m.checks.filter((g) => !g.passed).length, 1);
        assert.ok(d.anchors.length >= 2);
      } else assert.deepEqual(m.failures, []);
      assert.ok(m.candidateFrequency);
    }
    if (d.status === "disagreement")
      assert.equal(adaptive.pitch.frames[i].frequency, null);
  });
  const withoutSmall = analyseExperimentalPitch(signal.samples, standard, {
    use1024: false,
  });
  assert.equal(withoutSmall.stats.evaluated1024, 0);
  assert.throws(
    () => analyseExperimentalPitch(signal.samples.subarray(10), standard),
    /matching Standard/,
  );
  assert.equal(CELLO_CONFIG.windowSize, 4096);
});

test("sustained tones, motion, octaves and silence retain the Standard reference without fabricated frames", () => {
  for (const signal of extraCases()) {
    const standard = analysePitch(signal.samples),
      before = structuredClone(standard);
    const adaptive = analyseExperimentalPitch(signal.samples, standard);
    assert.deepEqual(standard, before, signal.id);
    if (signal.id.startsWith("sustain") || signal.id === "silence")
      assert.deepEqual(
        adaptive.pitch.frames.map((f) => f.frequency),
        standard.frames.map((f) => f.frequency),
        signal.id,
      );
    if (signal.id === "silence") assert.equal(adaptive.pitch.usableFrames, 0);
    for (const d of adaptive.decisions) assert.ok(d.reason);
  }
});

test("busy experimental computation can be terminated from another thread without waiting for DSP completion", async (t) => {
  const root = new URL("../", import.meta.url).href;
  const worker = new Worker(
    `
    const {parentPort} = require('node:worker_threads');
    (async()=>{
      const {analysePitch}=await import(${JSON.stringify(root + "src/lib/pitch.ts")});
      const {analyseExperimentalPitch}=await import(${JSON.stringify(root + "src/lib/experimental-pitch.ts")});
      const samples=Float32Array.from({length:22050*4},(_,i)=>0.2*Math.sin(2*Math.PI*(100+i/22050*8)*i/22050));
      const standard=analysePitch(samples);
      analyseExperimentalPitch(samples,standard,{progress:p=>{if(p===0)parentPort.postMessage('experimental-running')}});
      parentPort.postMessage('completed');
    })().catch(e=>{throw e});
  `,
    { eval: true },
  );
  let completed = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("worker did not start")),
        60000,
      );
      worker.on("error", reject);
      worker.on("message", (message) => {
        if (message === "completed") completed = true;
        if (message === "experimental-running") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    const start = performance.now();
    await worker.terminate();
    t.diagnostic(
      `Experimental worker termination: ${(performance.now() - start).toFixed(1)} ms; completion received: ${completed}`,
    );
    assert.equal(completed, false);
  } finally {
    await worker.terminate();
  }
});

test("within-note harmonic variation and simulated bow-noise bursts do not justify false pitch changes", (t) => {
  for (const kind of ["harmonic variation", "noise bursts"]) {
    let seed = 8821;
    const frequency = 146.8323839587038;
    const samples = Float32Array.from({ length: 44100 }, (_, i) => {
      const time = i / 22050,
        phase = 2 * Math.PI * frequency * time;
      seed = (1664525 * seed + 1013904223) >>> 0;
      const burst =
        kind === "noise bursts" && time % 0.4 < 0.016
          ? 0.06 * (seed / 2 ** 31 - 1)
          : 0;
      return (
        0.15 *
          (Math.sin(phase) +
            (0.5 + 0.3 * Math.sin(2 * Math.PI * 7 * time)) *
              Math.sin(2 * phase) +
            (0.3 + 0.2 * Math.cos(2 * Math.PI * 3 * time)) *
              Math.sin(3 * phase)) +
        burst
      );
    });
    const standard = analysePitch(samples),
      result = analyseExperimentalPitch(samples, standard);
    const count = (frames: typeof standard.frames) => ({
      correct: frames.filter(
        (f) =>
          f.frequency !== null &&
          Math.abs(1200 * Math.log2(f.frequency / frequency)) <= 50,
      ).length,
      wrong: frames.filter(
        (f) =>
          f.frequency !== null &&
          Math.abs(1200 * Math.log2(f.frequency / frequency)) > 50,
      ).length,
      withheld: frames.filter((f) => f.frequency === null).length,
    });
    const a = count(standard.frames),
      b = count(result.pitch.frames);
    assert.equal(a.wrong, 0);
    assert.equal(b.wrong, 0);
    assert.ok(b.correct >= a.correct);
    t.diagnostic(
      JSON.stringify({
        kind,
        standard: a,
        experimental: b,
        acousticProposals: result.boundaries.length,
        segmentBarriers: result.stats.segmentBoundaries,
        noteTransitions: 0,
      }),
    );
  }
});
