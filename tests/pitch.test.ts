import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analysePitch,
  CELLO_CONFIG,
  frequencyToPitch,
  measuredObservations,
  mixToMono,
  rejectOctaveSpikes,
  type PitchFrame,
} from "../src/lib/pitch.ts";

const rate = CELLO_CONFIG.sampleRate;
function tone(
  frequency: number,
  harmonics = [1],
  amplitude = 0.3,
  duration = 1.5,
) {
  return Float32Array.from(
    { length: Math.floor(rate * duration) },
    (_, i) =>
      (amplitude *
        harmonics.reduce(
          (sum, level, h) =>
            sum +
            level *
              Math.sin(
                (2 * Math.PI * frequency * (h + 1) * i) / rate + h * 0.31,
              ),
          0,
        )) /
      harmonics.reduce((a, b) => a + Math.abs(b), 0),
  );
}
function noise(length: number) {
  let seed = 1234567;
  return Float32Array.from({ length }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 2 ** 32 - 0.5) * 0.5;
  });
}
test("frequency conversion gives standard notes, references, and signed cents", () => {
  for (const [frequency, name, midi] of [
    [65.40639132514966, "C2", 36],
    [97.99885899543733, "G2", 43],
    [146.8323839587038, "D3", 50],
    [220, "A3", 57],
  ] as const) {
    const pitch = frequencyToPitch(frequency);
    assert.equal(pitch.note, name);
    assert.equal(pitch.nearestMidi, midi);
    assert.ok(Math.abs(pitch.cents) < 1e-9);
    for (const cents of [-20, 20])
      assert.ok(
        Math.abs(
          frequencyToPitch(frequency * 2 ** (cents / 1200)).cents - cents,
        ) < 1e-9,
      );
  }
  assert.equal(frequencyToPitch(442, 442).note, "A4");
  assert.equal(frequencyToPitch(442, 442).cents, 0);
  for (const value of [0, -1, NaN, Infinity])
    assert.throws(() => frequencyToPitch(value), /positive finite/);
});

test("synthetic cello benchmark: all open strings, ±20 cents, harmonic and octave cases", (t) => {
  const measurements: {
    signal: string;
    maxCents: number;
    meanCents: number;
    coverage: number;
  }[] = [];
  for (const [label, frequency] of [
    ["C2", 65.40639132514966],
    ["G2", 97.99885899543733],
    ["D3", 146.8323839587038],
    ["A3", 220],
  ] as const) {
    for (const detuning of [0, 20, -20]) {
      for (const [kind, harmonics] of [
        ["sine", [1]],
        ["rich", [1, 0.8, 0.6, 0.4, 0.3, 0.2]],
        ["dominant-second", [0.12, 1, 0.4, 0.2]],
        ["missing-fundamental", [0, 1, 0.65, 0.3]],
      ] as const) {
        const actual = frequency * 2 ** (detuning / 1200);
        const result = analysePitch(tone(actual, [...harmonics]));
        const errors = result.frames
          .filter((f) => f.frequency !== null)
          .map((f) => Math.abs(1200 * Math.log2(f.frequency! / actual)));
        assert.ok(
          result.coverage > 0.95,
          `${label}/${kind}/${detuning}: insufficient coverage`,
        );
        assert.ok(errors.length > 0);
        const max = Math.max(...errors);
        assert.ok(
          max < 3,
          `${label}/${kind}/${detuning}: error ${max} cents exceeds 3-cent tolerance`,
        );
        measurements.push({
          signal: `${label} ${detuning > 0 ? "+" : ""}${detuning} ${kind}`,
          maxCents: max,
          meanCents: errors.reduce((a, b) => a + b, 0) / errors.length,
          coverage: result.coverage,
        });
      }
    }
  }
  t.diagnostic(
    `Synthetic benchmark (${measurements.length} signals, 1.5 s each): maximum absolute error ${Math.max(...measurements.map((m) => m.maxCents)).toFixed(6)} cents; mean absolute error ${(measurements.reduce((sum, m) => sum + m.meanCents, 0) / measurements.length).toFixed(6)} cents; minimum coverage ${(100 * Math.min(...measurements.map((m) => m.coverage))).toFixed(2)}%. Tolerance: <3 cents per usable frame, >95% coverage per signal. Synthetic only; no real-cello accuracy claim.`,
  );
});
test("silence, DC offset, and very quiet audio are excluded", () => {
  for (const samples of [
    new Float32Array(rate),
    new Float32Array(rate).fill(0.2),
    tone(65.406, [1], 0.0001),
  ]) {
    const result = analysePitch(samples);
    assert.equal(result.coverage, 0);
    assert.equal(result.sufficient, false);
    assert.deepEqual(result.observations, []);
    assert.ok(
      result.frames.every(
        (f) => f.rejection === "silence" && f.frequency === null,
      ),
    );
  }
  const offset = tone(220).map((v) => v + 0.25);
  assert.ok(analysePitch(offset).coverage > 0.95);
});
test("deterministic broadband noise has low confidence and no pitch judgments", () => {
  const result = analysePitch(noise(rate * 2));
  assert.equal(result.coverage, 0);
  assert.ok(
    result.frames.every(
      (f) =>
        f.frequency === null &&
        (f.rejection === "low-confidence" || f.rejection === "out-of-range"),
    ),
  );
  assert.ok(
    result.frames.some(
      (f) => f.rejection === "low-confidence" && f.clarity < 0.9,
    ),
  );
  assert.equal(result.sufficient, false);
  assert.deepEqual(result.observations, []);
});
test("range filtering, short audio, invalid samples and configuration are handled", () => {
  for (const frequency of [30, 1600])
    assert.equal(analysePitch(tone(frequency)).coverage, 0);
  assert.equal(analysePitch(new Float32Array(100)).sufficient, false);
  assert.throws(() => analysePitch(new Float32Array()), /non-empty/);
  assert.throws(
    () => analysePitch(new Float32Array(4096).fill(NaN)),
    /invalid samples/,
  );
  assert.throws(
    () => analysePitch(tone(220), { ...CELLO_CONFIG, hopSize: 0 }),
    /Invalid pitch/,
  );
});
test("stereo averages normally and avoids phase cancellation or a silent channel", () => {
  const a = tone(65.406);
  assert.deepEqual(mixToMono([a, a]), a);
  assert.deepEqual(mixToMono([a, a.map((v) => -v)]), a);
  assert.ok(
    analysePitch(mixToMono([new Float32Array(a.length), a])).coverage > 0.95,
  );
  assert.throws(() => mixToMono([]), /invalid/);
  assert.throws(() => mixToMono([a, new Float32Array(2)]), /invalid/);
});
function frame(midi: number, time = 0): PitchFrame {
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  const pitch = frequencyToPitch(frequency);
  return {
    time,
    frequency,
    midi,
    note: pitch.note,
    cents: pitch.cents,
    clarity: 0.99,
    rms: 0.1,
  };
}
test("isolated octave spikes are rejected while sustained octave leaps remain", () => {
  const frames = [36, 36, 48, 36, 36, 48, 48, 48].map((n) => frame(n));
  rejectOctaveSpikes(frames);
  assert.equal(frames[2].frequency, null);
  assert.equal(frames[2].rejection, "unstable");
  assert.ok(frames.slice(5).every((f) => f.midi === 48));
});
test("observations use stable measured regions and suppress transitions/vibrato judgments", () => {
  for (const cents of [-20, 20]) {
    const result = analysePitch(tone(220 * 2 ** (cents / 1200), [1], 0.3, 2));
    assert.ok(
      result.observations.some((s) =>
        s.includes(cents > 0 ? "above" : "below"),
      ),
    );
  }
  const frames = Array.from({ length: 150 }, (_, i) =>
    frame(57 + 0.3 * Math.sin(i / 3), (i * CELLO_CONFIG.hopSize) / rate),
  );
  assert.deepEqual(measuredObservations(frames, CELLO_CONFIG), []);
  const transitions = Array.from({ length: 150 }, (_, i) =>
    frame(36 + i / 8, (i * CELLO_CONFIG.hopSize) / rate),
  );
  assert.deepEqual(measuredObservations(transitions, CELLO_CONFIG), []);
  const mixed = [
    ...analysePitch(tone(220)).frames,
    ...analysePitch(noise(rate)).frames,
  ];
  assert.ok(
    measuredObservations(mixed, CELLO_CONFIG).some((s) =>
      s.includes("low pitch clarity"),
    ),
  );
});
test("timestamps, hop spacing and progress correspond to analysed samples", () => {
  const progress: number[] = [];
  const result = analysePitch(tone(220), { ...CELLO_CONFIG }, (value) =>
    progress.push(value),
  );
  assert.equal(result.frames[0].time, CELLO_CONFIG.windowSize / (2 * rate));
  assert.ok(
    Math.abs(
      result.frames[1].time -
        result.frames[0].time -
        CELLO_CONFIG.hopSize / rate,
    ) < 1e-12,
  );
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, i) => i === 0 || value >= progress[i - 1]));
});
