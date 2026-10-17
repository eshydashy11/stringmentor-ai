import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generatePracticeFeedback,
  FEEDBACK_RULES,
} from "../src/lib/practice-feedback.ts";
import { feedbackExport } from "../src/lib/feedback-export.ts";
import { practiceFixture, feedbackInput } from "./helpers/practice-fixture.ts";

function fixture(cents = 2) {
  const input = feedbackInput("pitch", practiceFixture(0, cents));
  input.analysis!.pitch.frames.forEach((f) => {
    f.cents = cents;
  });
  return input;
}

test("reliable subthreshold pitch gets a neutral measured summary, not insufficient evidence or praise", () => {
  const input = fixture();
  const original = structuredClone(input);
  const output = generatePracticeFeedback(input);
  const assessment = output.pitchAssessment!;
  assert.equal(assessment.status, "no-qualifying-pattern");
  assert.equal(output.insufficient, null);
  assert.equal(output.findings.length, 0);
  assert.equal(assessment.reliableFrames, 340);
  assert.equal(assessment.reliableFrameCoverage, 1);
  assert.equal(assessment.regions.length, 1);
  assert.equal(assessment.regions[0].meanOffsetCents, 2);
  assert.equal(assessment.regions[0].spreadCents, 0);
  assert.equal(assessment.regions[0].driftCents, 0);
  assert.equal(assessment.sustainedSeconds, (339 * 512) / 22050);
  assert.equal(assessment.sustainedCoverage, assessment.sustainedSeconds / 8);
  assert.match(assessment.explanation, /8 cents.*12 cents/);
  assert.match(assessment.limitations, /not proof of correct intonation/);
  assert.doesNotMatch(
    assessment.summary,
    /excellent|good intonation|in tune|correct note/i,
  );
  assert.deepEqual(input, original);
  assert.deepEqual(output, generatePracticeFeedback(input));
  const json = JSON.parse(
    JSON.stringify(
      feedbackExport(
        { id: input.recordingId, name: "Cello", instrument: "cello" },
        input.analysis!,
        output,
        {},
        input.interval,
        {},
        {},
      ),
    ),
  );
  assert.deepEqual(json.feedback.pitchAssessment, assessment);
});

test("insufficient pitch identifies actual harmonic, margin, missing-estimate and duration failures", () => {
  for (const gate of [
    "support",
    "margin",
    "missing",
    "candidate",
    "duration",
    "empty",
  ] as const) {
    const input = fixture();
    const frames = input.analysis!.pitch.frames;
    if (gate === "support")
      frames.forEach((f) => {
        f.diagnostics!.candidates[0].support =
          FEEDBACK_RULES.minHarmonicSupport - 0.001;
      });
    if (gate === "margin")
      frames.forEach((f) => {
        f.diagnostics!.margin = FEEDBACK_RULES.minPitchMargin - 0.001;
      });
    if (gate === "missing")
      frames.forEach((f) => {
        f.frequency = null;
        f.cents = null;
      });
    if (gate === "candidate")
      frames.forEach((f) => {
        f.diagnostics!.selectedCandidate = null;
      });
    if (gate === "duration") input.interval = { start: 0, end: 0.5 };
    if (gate === "empty") input.analysis!.pitch.frames = [];
    const output = generatePracticeFeedback(input);
    const assessment = output.pitchAssessment!;
    assert.equal(assessment.status, "insufficient-evidence", gate);
    assert.ok(output.insufficient);
    assert.equal(output.findings.length, 0);
    assert.equal(assessment.regions.length, 0);
    const messages = {
      support: /harmonic support ≥ 0.75/,
      margin: /candidate margin ≥ 0.06/,
      missing: /no usable tracked pitch/,
      candidate: /lack selected harmonic-candidate/,
      duration: /shorter than 0.7 s/,
      empty: /No pitch frames/,
    };
    assert.match(assessment.gateFailures.join(" "), messages[gate]);
    assert.ok(Number.isFinite(assessment.sustainedCoverage));
    assert.equal(assessment.sustainedSeconds, 0);
  }
});

test("many reliable but fragmented measurements do not imply sustained coverage", () => {
  const input = fixture();
  input.analysis!.pitch.frames.forEach((f, i) => {
    if (i % 20 === 0) f.diagnostics!.margin = 0;
  });
  const result = generatePracticeFeedback(input).pitchAssessment!;
  assert.equal(result.status, "insufficient-evidence");
  assert.equal(result.reliableFrameCoverage, 0.95);
  assert.equal(result.sustainedCoverage, 0);
  assert.match(result.gateFailures.join(" "), /shorter than 0.7 s/);
  // Missing timestamps also split continuity even when all remaining frames are reliable.
  const gaps = fixture();
  gaps.analysis!.pitch.frames = gaps.analysis!.pitch.frames.filter(
    (_, i) => i % 20 !== 0,
  );
  assert.equal(
    generatePracticeFeedback(gaps).pitchAssessment!.status,
    "insufficient-evidence",
  );
});

test("supported offset and drift retain timestamped evidence and investigations, including threshold boundaries", () => {
  const input = fixture(FEEDBACK_RULES.pitchOffsetCents);
  let output = generatePracticeFeedback(input);
  assert.equal(output.pitchAssessment!.status, "notable-pattern");
  assert.equal(output.insufficient, null);
  const offset = output.findings[0];
  assert.equal(
    offset.measurements.find((m) => m.label === "Mean reference offset")!.value,
    8,
  );
  assert.equal(offset.investigation, "pitch");
  assert.ok(offset.uncertainty.length > 0);
  assert.deepEqual(
    offset.interval,
    output.pitchAssessment!.regions[0].interval,
  );
  assert.equal(offset.references[0].module, "pitch");
  input.analysis!.pitch.frames.forEach((f) => {
    f.cents = 7.999;
  });
  assert.equal(
    generatePracticeFeedback(input).pitchAssessment!.status,
    "no-qualifying-pattern",
  );
  input.analysis!.pitch.frames.forEach((f, i, frames) => {
    f.cents = -12 + (24 * i) / (frames.length - 1);
  });
  output = generatePracticeFeedback(input);
  assert.equal(output.pitchAssessment!.status, "notable-pattern");
  assert.equal(output.findings[0].title, "A sustained pitch moves");
  assert.ok(
    output.findings[0].measurements.find(
      (m) => m.label === "Last minus first third",
    )!.value > 12,
  );
});

test("wide reliable motion is measured but not misrepresented as below-threshold offset or drift", () => {
  const input = fixture();
  input.analysis!.pitch.frames.forEach((f, i) => {
    f.cents = i % 2 ? 30 : -30;
  });
  const output = generatePracticeFeedback(input);
  assert.equal(output.pitchAssessment!.status, "no-qualifying-pattern");
  assert.equal(output.insufficient, null);
  assert.equal(output.findings.length, 0);
  assert.equal(output.pitchAssessment!.regions[0].spreadCents, 60);
  assert.equal(output.pitchAssessment!.regions[0].eligibleForPattern, false);
  assert.match(
    output.pitchAssessment!.explanation,
    /not established as below threshold/,
  );
  assert.match(
    output.pitchAssessment!.gateFailures.join(" "),
    /35-cent spread limit/,
  );
});

test("summary respects selected intervals, evidence boundaries and note changes without pooling notes", () => {
  const input = fixture();
  input.interval = { start: 1, end: 7 };
  input.analysis!.pitch.frames.forEach((f) => {
    f.cents = f.time < 4 ? 2 : -3;
    f.note = f.time < 4 ? "D3" : "A3";
    f.diagnostics!.margin = FEEDBACK_RULES.minPitchMargin;
    f.diagnostics!.candidates[0].support = FEEDBACK_RULES.minHarmonicSupport;
  });
  const output = generatePracticeFeedback(input);
  assert.equal(output.pitchAssessment!.status, "no-qualifying-pattern");
  assert.equal(output.pitchAssessment!.regions.length, 2);
  for (const region of output.pitchAssessment!.regions) {
    assert.ok(region.interval.start >= 1 && region.interval.end <= 7);
    assert.equal(region.spreadCents, 0);
  }
  assert.ok(output.pitchAssessment!.sustainedCoverage > 0.98);
  assert.ok(output.pitchAssessment!.sustainedCoverage < 1);
  const custom = generatePracticeFeedback(input, {
    ...FEEDBACK_RULES,
    pitchOffsetCents: 1,
  });
  assert.equal(custom.pitchAssessment!.status, "notable-pattern");
  assert.deepEqual(
    custom.pitchAssessment!.regions,
    output.pitchAssessment!.regions,
  );
  assert.equal(
    generatePracticeFeedback({ ...input, goal: "dynamics" }).pitchAssessment,
    null,
  );
  assert.equal(
    generatePracticeFeedback({ ...input, recordingId: "wrong" })
      .pitchAssessment,
    null,
  );
});
