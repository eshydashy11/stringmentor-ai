import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gateCrepe,
  scoreAligned,
  transitionResponse,
  coverage,
} from "../scripts/crepe/metrics.ts";

test("CREPE benchmark distinguishes wrong, withheld, one/two octaves and unlabelled measurements", () => {
  const result = scoreAligned(
    [100, 200, 400, 150, null, 999],
    [100, 100, 100, 100, 100, null],
  );
  assert.equal(result.total, 5);
  assert.equal(result.correct, 1);
  assert.equal(result.wrong, 3);
  assert.equal(result.withheld, 1);
  assert.equal(result.octaveErrors, 2);
  assert.equal(result.oneOctaveErrors, 1);
  assert.equal(scoreAligned([100], [null]).correctFraction, null);
  assert.deepEqual(coverage([100, null, 150]), {
    frames: 3,
    accepted: 2,
    withheld: 1,
    fraction: 2 / 3,
  });
  assert.throws(() => scoreAligned([100], []), /Mismatched/);
  assert.throws(() => scoreAligned([NaN], [100]), /Invalid/);
});
test("CREPE gates never substitute another frequency and retain exact threshold semantics", () => {
  const result = gateCrepe(
    [100, 100, 54, 1001, 100, null],
    [0.5, 0.499, 1, 1, 1, 0],
    [0.003, 0.1, 0.1, 0.1, 0.002, 0.1],
  );
  assert.deepEqual(result.frequency, [100, null, null, null, null, null]);
  assert.equal(result.rejections.range, 2);
  assert.equal(result.rejections.amplitude, 1);
  assert.equal(gateCrepe([100], [0.2], [0.1], 0).frequency[0], 100);
  assert.equal(gateCrepe([100], [0.9], [NaN]).frequency[0], null);
  assert.throws(() => gateCrepe([100], [], [0.1]), /Mismatched/);
});
test("response timing uses aligned centres, counts misses and excludes indistinguishable repeated-note onsets", () => {
  const notes = [
    { start: 0, end: 1, frequency: 100 },
    { start: 1, end: 2, frequency: 200 },
    { start: 2, end: 3, frequency: 200 },
    { start: 3, end: 4, frequency: 300 },
  ];
  const result = transitionResponse(
    [0.9, 1.02, 2.01, 3.02],
    [100, 200, 200, null],
    notes,
  );
  assert.equal(result.total, 2);
  assert.equal(result.found, 1);
  assert.equal(result.missed, 1);
  assert.equal(result.repeatedNotesExcluded, 1);
  assert.ok(Math.abs(result.signedMedianMs! - 20) < 1e-8);
  const early = transitionResponse([0.98, 1.02], [200, 200], notes.slice(0, 2));
  assert.equal(early.early, 1);
});
