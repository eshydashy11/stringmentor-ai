import { test } from "node:test";
import assert from "node:assert/strict";
import { crepeComparison } from "../src/lib/crepe-comparison.ts";
import { HYBRID_POLICY, type HybridResult } from "../src/lib/hybrid-pitch.ts";
import { practiceFixture } from "./helpers/practice-fixture.ts";

function fixture() {
  const standard = practiceFixture().pitch;
  standard.frames = standard.frames
    .slice(0, 6)
    .map((f, i) => ({
      ...f,
      rms: i === 3 ? 0.002 : 0.1,
      frequency: i === 0 ? 65.4 : null,
    }));
  const frequencies = [196.2, 220, 220, 220, 1001, 146.8],
    confidence = [0.95, 0.51, 0.49, 0.95, 0.95, 0.5];
  const hybrid: HybridResult = {
    version: "2E.1", policy: HYBRID_POLICY,
    stats: {recovered:0, neuralRecovered:0, disagreements:0, harmonicGuards:0, withheld:5},
    timing: {modelMs:0,inferenceMs:0,arbitrationMs:0,totalMs:0,inferredFrames:6},
    model:{sha256:"fixture",runtime:"fixture",backend:"fixture"},
    pitch: { ...standard, frames: standard.frames.map((f) => ({ ...f })) },
    decisions: standard.frames.map((f, i) => ({
      time: f.time, frequency: f.frequency, source: f.frequency === null ? null : "standard", reason:"fixture", failed:[], acoustic:null, conflicts:[], disagreement:false, harmonicGuard:false, recovered:false,
      neural: {
        frequency: frequencies[i],
        confidence: confidence[i],
        peaks: [],
      },
    })),
  };
  return { standard, hybrid };
}
test("raw CREPE stays independent of guarded acceptance, including disputed third harmonics and withheld frames", () => {
  const { standard, hybrid } = fixture(),
    before = JSON.stringify({ standard, hybrid });
  const result = crepeComparison(standard, hybrid);
  assert.equal(result.crepe.accepted, 3);
  assert.equal(result.standard.accepted, 1);
  assert.equal(result.hybrid.accepted, 1);
  assert.equal(result.rows[0].frequency, 196.2);
  assert.ok(Math.abs(result.rows[0].ratioToStandard! - 3) < 1e-12);
  assert.equal(result.rows[0].disagreement, true);
  assert.equal(result.rows[0].hybridWithheld, false);
  assert.equal(result.hybridWithheld, 2);
  assert.equal(result.rows[1].frequency, 220);
  assert.equal(result.rows[5].frequency, 146.8);
  assert.equal(result.rows[5].hybridWithheld, true);
  assert.equal(JSON.stringify({ standard, hybrid }), before);
  assert.deepEqual(
    result.rows.map((r) => r.time),
    standard.frames.map((f) => f.time),
  );
});
test("basic gates preserve gaps and reject nonfinite, quiet, out-of-range and low-activation candidates", () => {
  const { standard, hybrid } = fixture();
  let result = crepeComparison(standard, hybrid);
  assert.equal(result.rows[2].midi, null);
  assert.equal(result.rows[3].midi, null);
  assert.equal(result.rows[4].midi, null);
  hybrid.decisions[0].neural.frequency = NaN;
  hybrid.decisions[1].neural.confidence = Infinity;
  result = crepeComparison(standard, hybrid);
  assert.equal(result.rows[0].frequency, null);
  assert.equal(result.rows[1].frequency, null);
  hybrid.decisions[0].time += 1;
  assert.throws(() => crepeComparison(standard, hybrid), /timestamps/);
});
test("empty comparisons have honest zero coverage", () => {
  const { standard, hybrid } = fixture();
  standard.frames = [];
  hybrid.pitch.frames = [];
  hybrid.decisions = [];
  assert.equal(crepeComparison(standard, hybrid).crepe.coverage, 0);
});
