import { test } from "node:test";
import assert from "node:assert/strict";
import { analysePitch, frequencyToPitch } from "../src/lib/pitch.ts";
import {
  analyseTone,
  clippingEvidence,
  intervalObservations,
  mean,
  reviewEvent,
  summariseInterval,
  TONE_CONFIG,
  type AcousticEvent,
} from "../src/lib/tone.ts";

const RATE = TONE_CONFIG.sampleRate;
const sine = (t: number, hz = 146.832) => Math.sin(2 * Math.PI * hz * t);
const rich = (t: number, hz = 146.832) =>
  0.16 * sine(t, hz) + 0.08 * sine(t, 2 * hz) + 0.04 * sine(t, 3 * hz);
function signal(seconds: number, fn: (t: number, i: number) => number) {
  return Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) =>
    fn(i / RATE, i),
  );
}
function noiseSource() {
  let state = 123456789;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return (state / 2 ** 32) * 2 - 1;
  };
}
function context(
  seconds: number,
  hz: (time: number) => number | null = () => 146.832,
) {
  return Array.from({ length: Math.floor((seconds * RATE) / 512) }, (_, i) => {
    const time = (i * 512) / RATE;
    const frequency = hz(time);
    const p = frequency ? frequencyToPitch(frequency) : null;
    return {
      time,
      frequency,
      midi: p?.midi ?? null,
      note: p?.note ?? null,
      clarity: frequency ? 1 : 0,
    };
  });
}
function evaluate(events: AcousticEvent[], labels: number[], tolerance = 0.15) {
  const unmatched = new Set(labels.map((_, i) => i));
  const errors: number[] = [];
  for (const event of events) {
    const candidates = [...unmatched]
      .filter((i) => Math.abs(labels[i] - event.time) <= tolerance)
      .sort(
        (a, b) =>
          Math.abs(labels[a] - event.time) - Math.abs(labels[b] - event.time),
      );
    if (candidates.length) {
      errors.push(Math.abs(labels[candidates[0]] - event.time));
      unmatched.delete(candidates[0]);
    }
  }
  return {
    matched: errors.length,
    falsePositives: events.length - errors.length,
    missed: unmatched.size,
    precision: events.length ? errors.length / events.length : 0,
    recall: labels.length ? errors.length / labels.length : 0,
    maxError: errors.length ? Math.max(...errors) : null,
    meanError: errors.length ? mean(errors) : null,
  };
}

test("tone metrology: constant sine and harmonic mixture have accurate level/centroid and no events", (t) => {
  const sineResult = analyseTone(signal(3, (t) => 0.2 * sine(t)));
  const summary = summariseInterval(sineResult.frames, 0.2, 2.8);
  assert.ok(
    Math.abs(summary.meanDbfs! - 20 * Math.log10(0.2 / Math.sqrt(2))) < 0.03,
  );
  assert.ok(Math.abs(summary.centroidHz! - 146.832) < 2);
  assert.ok(summary.flatness! < 0.00001);
  assert.equal(sineResult.events.length, 0);
  const samples = signal(3, (t) => rich(t));
  const pitch = analysePitch(samples);
  const result = analyseTone(samples, pitch.frames);
  const stable = summariseInterval(result.frames, 0.3, 2.7);
  assert.equal(stable.note, "D3");
  assert.ok(stable.harmonicSupport! > 0.95);
  assert.ok(stable.levelStdDb! < 0.1);
  assert.equal(result.events.length, 0);
  assert.ok(result.passages.length > 0);
  assert.ok(result.frames.some((f) => f.brightnessSpread !== null));
  t.diagnostic(
    `Sine RMS level error ${Math.abs(summary.meanDbfs! - 20 * Math.log10(0.2 / Math.sqrt(2))).toFixed(6)} dB; centroid error ${Math.abs(summary.centroidHz! - 146.832).toFixed(6)} Hz`,
  );
});

test("gradual crescendos/decrescendos yield supported observations without false boundaries", () => {
  for (const direction of [1, -1]) {
    const result = analyseTone(
      signal(4, (t) => rich(t) * 10 ** ((direction * (t - 2) * 3) / 20)),
      context(4),
    );
    const summary = summariseInterval(result.frames, 0.1, 3.9);
    assert.ok(summary.trendDb! * direction > 7);
    assert.equal(result.events.length, 0);
    assert.ok(
      intervalObservations(summary, []).some((s) =>
        s.includes(direction > 0 ? "increases" : "decreases"),
      ),
    );
  }
});

test("abrupt energy steps are uncertain acoustic events, not automatic bow reversals", (t) => {
  const result = analyseTone(
    signal(4, (t) => rich(t) * (t >= 2 ? 0.25 : 1)),
    context(4),
  );
  const metrics = evaluate(result.events, [2]);
  t.diagnostic(JSON.stringify(metrics));
  assert.equal(metrics.matched, 1);
  assert.equal(metrics.falsePositives, 0);
  assert.ok(result.events.every((e) => e.kind !== "candidate-bow-reversal"));
});

test("brightness changes are measured and flagged without interpreting tone quality", (t) => {
  const result = analyseTone(
    signal(4, (t) =>
      t < 2
        ? rich(t)
        : 0.04 * sine(t) + 0.08 * sine(t, 293.664) + 0.16 * sine(t, 587.328),
    ),
    context(4),
  );
  const before = summariseInterval(result.frames, 0.5, 1.5),
    after = summariseInterval(result.frames, 2.5, 3.5);
  assert.ok(after.centroidHz! - before.centroidHz! > 200);
  const metrics = evaluate(result.events, [2]);
  t.diagnostic(JSON.stringify(metrics));
  assert.equal(metrics.matched, 1);
  assert.equal(metrics.falsePositives, 0);
  assert.ok(result.events.every((e) => e.kind === "other-transient"));
});

test("noise bursts and transient artefacts do not become confirmed technique claims", (t) => {
  const noise = noiseSource();
  const result = analyseTone(
    signal(4, (t) => rich(t) + (t >= 1.8 && t < 2.2 ? 0.5 * noise() : 0)),
    context(4, (t) => (t >= 1.75 && t <= 2.25 ? null : 146.832)),
  );
  const during = summariseInterval(result.frames, 1.9, 2.1),
    before = summariseInterval(result.frames, 0.5, 1.5);
  assert.ok(during.flatness! > before.flatness! + 0.1);
  const metrics = evaluate(result.events, [1.8, 2.2]);
  t.diagnostic(JSON.stringify(metrics));
  assert.equal(metrics.matched, 2);
  assert.equal(metrics.falsePositives, 0);
  assert.ok(result.events.every((e) => e.kind !== "candidate-bow-reversal"));
  const click = analyseTone(
    signal(3, (t, i) => rich(t) + (i === Math.round(1.5 * RATE) ? 0.9 : 0)),
    context(3),
  );
  assert.ok(click.events.every((e) => e.kind !== "candidate-bow-reversal"));
});

test("synthetic note changes without envelope dips are separated from bow candidates", (t) => {
  const samples = signal(4, (t) => rich(t, t < 2 ? 146.832 : 220));
  const pitch = analysePitch(samples);
  const result = analyseTone(samples, pitch.frames);
  const metrics = evaluate(result.events, [2]);
  t.diagnostic(JSON.stringify(metrics));
  assert.equal(metrics.matched, 1);
  assert.equal(metrics.falsePositives, 0);
  assert.equal(result.events[0].kind, "note-change");
});

test("bow-like envelope dips plus spectral disturbance have known timestamp evaluation", (t) => {
  const labels = [1, 2, 3, 4];
  const samples = signal(5, (time) => {
    const distance = Math.min(...labels.map((at) => Math.abs(time - at)));
    const dip = Math.exp(-((distance / 0.045) ** 2));
    return rich(time) * (1 - 0.85 * dip) + 0.025 * dip * sine(time, 1900);
  });
  const result = analyseTone(samples, context(5));
  const metrics = evaluate(result.events, labels);
  t.diagnostic(JSON.stringify(metrics));
  assert.equal(metrics.recall, 1);
  assert.equal(metrics.precision, 1);
  assert.ok(metrics.maxError! < 0.06);
  assert.ok(result.events.every((e) => e.kind === "candidate-bow-reversal"));
  // With no acoustic perturbation, even an asserted stroke count must not create events.
  const smooth = analyseTone(
    signal(5, (t) => rich(t)),
    context(5),
  );
  assert.equal(smooth.events.length, 0);
});

test("silence, very low amplitude, variable background noise and pitch gaps stay honest", () => {
  for (const samples of [
    new Float32Array(RATE),
    signal(2, (t) => 0.0001 * sine(t)),
    new Float32Array(RATE).fill(0.2),
  ]) {
    const result = analyseTone(samples);
    assert.equal(result.events.length, 0);
    assert.ok(
      result.frames.every(
        (f) =>
          !f.active &&
          f.centroid === null &&
          f.flux === null &&
          f.flatness === null,
      ),
    );
    assert.match(
      intervalObservations(summariseInterval(result.frames, 0, 2), [])[0],
      /Too little sound/,
    );
  }
  const noise = noiseSource();
  const changing = analyseTone(
    signal(5, (t) => rich(t) + (0.002 + (0.01 * t) / 5) * noise()),
    context(5),
  );
  assert.equal(changing.events.length, 0);
  const missingPitch = analyseTone(
    signal(4, (t) => rich(t)),
    context(4, (t) => (t > 1.5 && t < 2.5 ? null : 146.832)),
  );
  assert.equal(missingPitch.events.length, 0);
  assert.ok(
    missingPitch.frames
      .filter((f) => f.time > 1.6 && f.time < 2.4)
      .every((f) => f.midi === null),
  );
});

test("clipping diagnostics count channel samples once and do not alter originals", () => {
  const left = Float32Array.from([0, 1, 1, 1, 0, -1, -1, -1]),
    right = Float32Array.from(left, (x) => -x);
  const original = left.slice();
  const evidence = clippingEvidence([left, right]);
  assert.equal(evidence.nearFullScaleSamples, 12);
  assert.equal(evidence.longestRun, 3);
  assert.equal(evidence.sampleCount, 16);
  assert.equal(evidence.peak, 1);
  assert.deepEqual(left, original);
  assert.throws(() => analyseTone(new Float32Array()), /non-empty/);
  assert.throws(() => analyseTone(Float32Array.from([NaN])), /invalid samples/);
});

test("manual reviews stay separate, enforce valid times, and preserve algorithm evidence", () => {
  const event: AcousticEvent = {
    id: "event-1",
    time: 2,
    kind: "uncertain",
    evidence: ["Measured dip"],
    strength: "limited cues",
    dipDb: 6,
    peakDb: 0,
    stepDb: 0,
    flux: 0.02,
    pitchChangeCents: null,
  };
  const original = structuredClone(event);
  const reviewed = reviewEvent(
    event,
    "adjusted",
    2.2,
    "candidate-bow-reversal",
    4,
  );
  assert.equal(reviewed.time, 2.2);
  assert.equal(reviewed.kind, "candidate-bow-reversal");
  assert.deepEqual(event, original);
  for (const invalid of [-1, 5, NaN, Infinity])
    assert.throws(
      () => reviewEvent(event, "adjusted", invalid, "uncertain", 4),
      /within/,
    );
});

test("same-note comparisons require usable stable pitch and observations avoid mixed-note claims", () => {
  const frames = analyseTone(
    signal(4, (t) => rich(t)),
    context(4),
  ).frames;
  assert.equal(summariseInterval(frames, 0.5, 1.5).note, "D3");
  const mixed = frames.map((f) => ({
    ...f,
    midi: f.time > 2 ? 57 : f.midi,
    note: f.time > 2 ? "A3" : f.note,
  }));
  const summary = summariseInterval(mixed, 0.5, 3.5);
  assert.equal(summary.note, null);
  assert.equal(summary.trendDb, null);
  assert.ok(
    intervalObservations(summary, []).some((s) => s.includes("does not meet")),
  );
  assert.equal(summariseInterval(frames, 8, 9).count, 0);
});

test("level and brightness metrology across four open-string registers and two gains", (t) => {
  let maxLevelError = 0,
    maxCentroidError = 0;
  for (const frequency of [65.406, 97.999, 146.832, 220]) {
    for (const amplitude of [0.02, 0.2]) {
      const result = analyseTone(
        signal(2, (time) => amplitude * sine(time, frequency)),
      );
      const summary = summariseInterval(result.frames, 0.2, 1.8);
      maxLevelError = Math.max(
        maxLevelError,
        Math.abs(summary.meanDbfs! - 20 * Math.log10(amplitude / Math.sqrt(2))),
      );
      maxCentroidError = Math.max(
        maxCentroidError,
        Math.abs(summary.centroidHz! - frequency),
      );
      assert.equal(result.events.length, 0);
      assert.ok(summary.activeCoverage > 0.99);
    }
  }
  t.diagnostic(
    `Eight stationary sine cases: maximum level error ${maxLevelError.toFixed(6)} dB; maximum centroid error ${maxCentroidError.toFixed(6)} Hz`,
  );
  assert.ok(maxLevelError < 0.04);
  assert.ok(maxCentroidError < 3);
});
