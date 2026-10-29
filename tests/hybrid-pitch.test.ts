import { test } from "node:test";
import assert from "node:assert/strict";
import { analysePitch, type PitchFrame } from "../src/lib/pitch.ts";
import { analyseExperimentalPitch } from "../src/lib/experimental-pitch.ts";
import { selectHybrid, harmonicRatio } from "../src/lib/hybrid-pitch.ts";
import {
  crepeWindow,
  resampleForCrepe,
  decodeCrepe,
  type NeuralEstimate,
} from "../src/lib/crepe-input.ts";
import { makeSequence } from "../scripts/lib/fast-pitch-audit.ts";
import { experimentalFixture } from "./helpers/experimental-fixture.ts";
import { practiceFixture } from "./helpers/practice-fixture.ts";
import { validateBundle } from "../src/lib/practice-session.ts";

const neural = (f: number | null, confidence = 0.95): NeuralEstimate => ({
  frequency: f,
  confidence,
  peaks: [],
});

test("hybrid protects every accepted C2/G2/D3/A3 estimate from neural 2x/3x/4x errors without mutating inputs", () => {
  for (const midi of [36, 43, 50, 57]) {
    const signal = makeSequence("held", [midi], 0.5, "clean", 1);
    const standard = analysePitch(signal.samples),
      exp = analyseExperimentalPitch(signal.samples, standard);
    const before = JSON.stringify({ standard, exp });
    for (const ratio of [2, 3, 4]) {
      const result = selectHybrid(
        standard,
        exp,
        standard.frames.map((f) => neural((f.frequency ?? 100) * ratio)),
      );
      assert.deepEqual(
        result.pitch.frames.map((f) => f.frequency),
        standard.frames.map((f) => f.frequency),
      );
    }
    assert.equal(JSON.stringify({ standard, exp }), before);
  }
  assert.equal(harmonicRatio(65.4, 196.2), 3);
  assert.equal(harmonicRatio(110, 220), 2);
  assert.equal(harmonicRatio(110, 188), null);
});

function recoveryFixture() {
  const bundle = practiceFixture();
  const base = bundle.pitch.frames[0];
  const candidate = {
    frequency: 220,
    support: 0.86,
    periodicity: 0.91,
    score: 0.82,
    primitive: true,
    harmonics: [1, 2, 3],
  };
  bundle.pitch.frames = Array.from(
    { length: 5 },
    (_, i): PitchFrame => ({
      ...base,
      time: (2048 + i * 512) / 22050,
      frequency: null,
      midi: null,
      cents: null,
      note: null,
      rms: 0.1,
      diagnostics: {
        rawFrequency: null,
        rawClarity: 0,
        candidates: [candidate],
        decision: "weak-evidence",
        margin: 0.1,
        corrected: false,
        selectedCandidate: null,
        detail: "fixture",
      },
    }),
  );
  const exp = experimentalFixture(bundle);
  exp.decisions.forEach((d, i) => {
    d.shorter = [
      {
        windowSize: 2048,
        centreSample: d.centreSample,
        frequency: null,
        candidateFrequency: 220,
        cycles: 20,
        failures: [],
        checks: [],
        supportOnlyNearMiss: false,
        frame: structuredClone(bundle.pitch.frames[i]),
      },
    ];
  });
  return {
    bundle,
    exp,
    predictions: bundle.pitch.frames.map(() => neural(220)),
    candidate,
  };
}
test("current spectral and bilateral neural evidence can recover a gap, but high neural frequency alone cannot", () => {
  const { bundle, exp, predictions } = recoveryFixture();
  const result = selectHybrid(bundle.pitch, exp, predictions);
  assert.equal(result.decisions[2].source, "crepe-tiny");
  assert.equal(result.decisions[0].frequency, null);
  const noEvidence = structuredClone(exp);
  noEvidence.decisions[2].shorter = [];
  assert.equal(
    selectHybrid(bundle.pitch, noEvidence, predictions).decisions[2].frequency,
    null,
  );
  predictions[1] = neural(440);
  predictions[0] = neural(440);
  assert.ok(
    selectHybrid(bundle.pitch, exp, predictions).decisions[2].failed.includes(
      "missing-bilateral-segment-support",
    ),
  );
});
test("lower primitive harmonic evidence blocks C2-to-G3 rescue even when Standard withheld; octave conflicts are never averaged", () => {
  const { bundle, exp, predictions, candidate } = recoveryFixture();
  bundle.pitch.frames[2].diagnostics!.candidates.push({
    ...candidate,
    frequency: 220 / 3,
    support: 0.7,
    score: 0.65,
  });
  const d = selectHybrid(bundle.pitch, exp, predictions).decisions[2];
  assert.equal(d.frequency, null);
  assert.ok(d.failed.includes("harmonic-conflict"));
  assert.equal(d.conflicts[0].ratio, 3);
});
test("boundary, weak spectral, silence, invalid neural and transitional-region gates are independent", () => {
  for (const kind of ["boundary", "silence", "weak", "nan", "crossover"]) {
    const { bundle, exp, predictions } = recoveryFixture();
    if (kind === "silence") bundle.pitch.frames[2].rms = 0;
    if (kind === "weak")
      exp.decisions[2].shorter[0].frame.diagnostics!.candidates[0].support = 0.74;
    if (kind === "nan") predictions[2].confidence = NaN;
    if (kind === "crossover")
      predictions.forEach((p) => {
        p.frequency = 130;
      });
    if (kind === "boundary")
      exp.boundaries.push({
        centreSample: 3072,
        startSample: 3000,
        endSample: 3150,
        usedForSegmentation: true,
      } as (typeof exp.boundaries)[number]);
    assert.equal(
      selectHybrid(bundle.pitch, exp, predictions).decisions[2].frequency,
      null,
      kind,
    );
  }
});
test("hybrid results validate alignment and protected Standard identity", () => {
  const { bundle, exp, predictions } = recoveryFixture();
  const selected = selectHybrid(bundle.pitch, exp, predictions);
  bundle.experimental = exp;
  bundle.hybrid = {
    ...selected,
    timing: {
      modelMs: 1,
      inferenceMs: 1,
      arbitrationMs: 1,
      totalMs: 3,
      inferredFrames: 5,
    },
    model: { sha256: "fixture", runtime: "fixture", backend: "fixture" },
  };
  assert.equal(validateBundle(bundle, bundle.recordingId), true);
  bundle.hybrid.decisions[2].time += 1;
  assert.equal(validateBundle(bundle, bundle.recordingId), false);
});
test("CREPE preprocessing normalises, aligns and rejects invalid data; resampling suppresses aliasing", () => {
  const input = Float32Array.from(
    { length: 22050 },
    (_, i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / 22050) + 0.1,
  );
  const audio = resampleForCrepe(input),
    frame = crepeWindow(audio, 4096);
  assert.equal(audio.length, 16000);
  assert.equal(frame.length, 1024);
  assert.ok(Math.abs(frame.reduce((s, v) => s + v, 0) / 1024) < 1e-7);
  assert.ok(Math.abs(frame.reduce((s, v) => s + v * v, 0) / 1024 - 1) < 1e-6);
  const high = resampleForCrepe(
    Float32Array.from({ length: 22050 }, (_, i) =>
      Math.sin((2 * Math.PI * 10000 * i) / 22050),
    ),
  );
  const rms = Math.sqrt(
    high.slice(100, -100).reduce((s, v) => s + v * v, 0) / (high.length - 200),
  );
  assert.ok(rms < 0.001);
  assert.throws(() => crepeWindow(audio, 0));
  assert.throws(() => resampleForCrepe(new Float32Array([NaN])));
  assert.throws(() => decodeCrepe(new Float32Array(359)));
  assert.equal(decodeCrepe(new Float32Array(360)).frequency, null);
  assert.equal(
    decodeCrepe(new Float32Array(360).fill(-5.960464477539063e-8)).frequency,
    null,
  );
  assert.throws(() => decodeCrepe(new Float32Array(360).fill(-0.001)));
  assert.throws(() => decodeCrepe(new Float32Array(360).fill(NaN)));
  const activation = new Float32Array(360);
  activation[120] = 0.9;
  assert.ok(
    Math.abs(
      decodeCrepe(activation).frequency! -
        10 * 2 ** ((120 * 20 + 1997.3794084376191) / 1200),
    ) < 1e-6,
  );
});
