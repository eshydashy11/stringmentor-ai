import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateChecks,
  selectRecovery,
  type RecoveryContext,
} from "../src/lib/experimental-evidence.ts";
import {
  classifyBoundary,
  type BoundaryProposal,
} from "../src/lib/experimental-boundaries.ts";
import type { PitchCandidate } from "../src/lib/pitch-candidates.ts";

// Constructed policy inputs. The Beethoven audio/margin/harmonic labels are NOT available.
const candidate: PitchCandidate = {
  frequency: 188.6,
  support: 0.77,
  periodicity: 0.91,
  score: 0.73,
  primitive: true,
  harmonics: [1, 2, 3, 4],
};
function context(overrides: Partial<PitchCandidate> = {}): RecoveryContext {
  const c = { ...candidate, ...overrides };
  return {
    candidate: c,
    checks: candidateChecks(c, 0.12, 2048, 0.1),
    frequency: c.frequency,
    centreSample: 4096,
    anchors: [
      { centreSample: 3584, frequency: 188.4 },
      { centreSample: 4608, frequency: 188.8 },
    ],
    corroboratingFrequency: 188.5,
    boundaryOverlap: false,
  };
}
test("support-only near miss needs strong independent bilateral and cross-resolution evidence; raw gate stays failed", () => {
  const c = context(),
    r = selectRecovery(c);
  assert.equal(r.accepted, true);
  assert.equal(r.supportException, true);
  assert.deepEqual(
    c.checks.filter((g) => !g.passed).map((g) => g.code),
    ["harmonic-support"],
  );
  assert.equal(
    selectRecovery({ ...c, anchors: c.anchors.slice(0, 1) }).accepted,
    false,
  );
  assert.equal(
    selectRecovery({ ...c, corroboratingFrequency: null }).accepted,
    false,
  );
  assert.equal(selectRecovery({ ...c, boundaryOverlap: true }).accepted, false);
  assert.equal(
    selectRecovery({
      ...c,
      anchors: c.anchors.map((a) => ({
        ...a,
        centreSample: a.centreSample < 4096 ? 2000 : 6200,
      })),
    }).accepted,
    false,
  );
  for (const patch of [
    { support: 0.74 },
    { periodicity: 0.89 },
    { score: 0.69 },
    { harmonics: [2, 4, 6] },
    { primitive: false },
  ])
    assert.equal(selectRecovery(context(patch)).accepted, false);
});
test("multiple acoustic failures and competing octave/subharmonic candidates cannot be filled by temporal support", () => {
  for (const f of [125.2, 83.2, 71, 134.6, 142.6]) {
    const c = context({
      frequency: f,
      support: 0.6,
      periodicity: 0.5,
      score: 0.5,
    });
    c.checks = candidateChecks(c.candidate, 0.02, 2048, 0.1);
    const result = selectRecovery(c);
    assert.equal(result.accepted, false);
    for (const code of [
      "harmonic-support",
      "periodicity",
      "score",
      "ambiguity",
    ])
      assert.ok(result.codes.includes(code));
  }
  const c = context({ support: 0.99, periodicity: 0.98, score: 0.96 });
  assert.ok(
    selectRecovery({ ...c, corroboratingFrequency: 377.2 }).codes.includes(
      "cross-resolution-disagreement",
    ),
  );
  assert.ok(
    selectRecovery({
      ...c,
      anchors: [c.anchors[0], { centreSample: 4608, frequency: 94.3 }],
    }).codes.includes("segment-conflict"),
  );
  const ambiguous = {
    ...c,
    checks: candidateChecks(c.candidate, 0.079, 2048, 0.1),
  };
  assert.equal(selectRecovery(ambiguous).accepted, false);
});
test("amplitude, range and cycle checks remain distinct; noise is not called silence", () => {
  assert.ok(
    candidateChecks(undefined, 0, 2048, 0.001).some(
      (g) => g.code === "amplitude" && !g.passed,
    ),
  );
  assert.ok(
    candidateChecks(undefined, 0, 2048, 0.1).some(
      (g) => g.code === "amplitude" && g.passed,
    ),
  );
  assert.ok(
    candidateChecks({ ...candidate, frequency: 30 }, 0.12, 1024, 0.1).some(
      (g) => g.code === "range" && !g.passed,
    ),
  );
  assert.ok(
    candidateChecks({ ...candidate, frequency: 83 }, 0.12, 1024, 0.1).some(
      (g) => g.code === "cycles" && !g.passed,
    ),
  );
});
const proposal: BoundaryProposal = {
  centreSample: 4096,
  startSample: 3840,
  endSample: 4352,
  cues: ["local multiband spectral change"],
  lowFlux: 0.1,
  highFlux: 0.4,
  envelopeChangeDb: 0,
  threshold: 0.15,
  usedForSegmentation: false,
  interpretation: "",
};
test("boundary classification retains uncertain flux without treating vibrato or timbre change as note onset", () => {
  assert.equal(
    classifyBoundary(proposal, [188, 189], [190, 191]).usedForSegmentation,
    false,
  );
  assert.equal(
    classifyBoundary(proposal, [188, 189], [220, 221]).usedForSegmentation,
    true,
  );
  assert.equal(
    classifyBoundary(proposal, [188, null], [220, 221]).usedForSegmentation,
    false,
  );
  assert.equal(
    classifyBoundary(
      { ...proposal, envelopeChangeDb: 8 },
      [188, 189],
      [190, 191],
    ).usedForSegmentation,
    false,
  );
  assert.equal(
    classifyBoundary(
      { ...proposal, envelopeChangeDb: 8, lowFlux: 0.3 },
      [188, 189],
      [190, 191],
    ).usedForSegmentation,
    true,
  );
});
