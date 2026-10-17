import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CELLO_CONFIG,
  analysePitch,
  type PitchFrame,
  type PitchResult,
} from "../src/lib/pitch.ts";
import {
  candidateFailures,
  makeSequence,
  matchBoundaries,
  onsetResponse,
  quantile,
  rejectionAudit,
  scoreFrames,
} from "../scripts/lib/fast-pitch-audit.ts";

function result(frames: PitchFrame[]): PitchResult {
  return {
    frames,
    duration: 1,
    config: { ...CELLO_CONFIG },
    usableFrames: frames.filter((f) => f.frequency !== null).length,
    coverage: 0,
    meanClarity: 0,
    sufficient: false,
    observations: [],
  };
}
function frame(time: number, frequency: number | null): PitchFrame {
  return {
    time,
    frequency,
    cents: null,
    midi: null,
    note: null,
    clarity: 0,
    rms: 0.1,
  };
}

test("audit scoring partitions correct, incorrect and withheld without counting gaps as correct", () => {
  const notes = [
    { start: 0, end: 0.5, frequency: 100 },
    { start: 0.5, end: 1, frequency: 150 },
  ];
  const measured = result([
    frame(0.2, 100),
    frame(0.4, null),
    frame(0.5, 100),
    frame(0.7, 300),
    frame(0.9, 150),
  ]);
  const scores = scoreFrames(measured, notes);
  assert.equal(scores.total, 5);
  assert.equal(scores.correct, 2);
  assert.equal(scores.wrong, 2);
  assert.equal(scores.withheld, 1);
  assert.equal(scores.coverage, 0.8);
  assert.equal(scores.acceptedAccuracy, 0.5);
  assert.equal(scores.correctFraction, 0.4);
  assert.equal(scores.octaveWrong, 1);
  assert.equal(scores.previousNoteMatches, 1);
  assert.equal(scores.byContext.mixedWindow.total, 1);
  const empty = scoreFrames(result([frame(0.2, null)]), notes);
  assert.equal(empty.acceptedAccuracy, null);
  assert.equal(empty.acceptedAbsoluteCentsMedian, null);
});

test("audit onset/event metrics retain misses and early responses and never match one event twice", () => {
  assert.deepEqual(matchBoundaries([], [0.5]).matched, 0);
  const duplicate = matchBoundaries([0.49, 0.51], [0.5]);
  assert.equal(duplicate.matched, 1);
  assert.equal(duplicate.precision, 0.5);
  assert.equal(duplicate.recall, 1);
  assert.ok(Math.abs(duplicate.signedMedianMs! + 10) < 1e-9);
  const notes = [
    { start: 0, end: 0.5, frequency: 100 },
    { start: 0.5, end: 0.75, frequency: 150 },
    { start: 0.75, end: 1, frequency: 200 },
  ];
  const timing = onsetResponse(
    result([frame(0.48, 150), frame(0.8, null)]),
    notes,
  );
  assert.equal(timing.found, 1);
  assert.equal(timing.missed, 1);
  assert.ok(Math.abs(timing.signedMedianMs! + 20) < 1e-9);
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([10, 0], 0.5), 5);
});

test("synthetic source is deterministic, onset labels are sample-aligned, and overlap is explicit", () => {
  const clean = makeSequence("clean", [36, 43], 0.125, "clean", 1);
  assert.deepEqual(clean, makeSequence("clean", [36, 43], 0.125, "clean", 1));
  assert.equal(clean.notes[1].start, Math.round(0.125 * 22050) / 22050);
  assert.ok(clean.samples.every(Number.isFinite));
  const noisy = makeSequence("noisy", [36, 43], 0.125, "attack-noise", 1);
  assert.deepEqual(
    noisy.samples,
    makeSequence("noisy", [36, 43], 0.125, "attack-noise", 1).samples,
  );
  assert.notDeepEqual(clean.samples, noisy.samples);
  const resonance = makeSequence("resonance", [36, 43], 0.125, "resonance", 1);
  assert.notEqual(
    resonance.samples[Math.round(clean.notes[1].start * 22050)],
    0,
  );
});

test("audit gate explanations match production decisions and all window experiments leave config unchanged", () => {
  const original = { ...CELLO_CONFIG };
  const signal = makeSequence("rapid", [43, 50, 55, 59], 0.125, "clean", 1);
  for (const windowSize of [4096, 2048, 1024]) {
    const measured = analysePitch(signal.samples, {
      ...CELLO_CONFIG,
      windowSize,
    });
    const audit = rejectionAudit(measured);
    assert.equal(
      Object.values(audit.final).reduce((a, b) => a + b, 0),
      measured.frames.length,
    );
    assert.equal(
      audit.weakWithNoEligible + audit.weakDespiteEligible,
      audit.tracker["weak-evidence"] ?? 0,
    );
    for (const f of measured.frames.filter((f) => f.frequency !== null)) {
      const d = f.diagnostics!;
      assert.deepEqual(
        candidateFailures(d.candidates[d.selectedCandidate!], measured.config),
        [],
      );
    }
  }
  assert.deepEqual(CELLO_CONFIG, original);
});
