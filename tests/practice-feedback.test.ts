import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generatePracticeFeedback,
  FEEDBACK_RULES,
  PRACTICE_GOALS,
  type PracticeGoal,
} from "../src/lib/practice-feedback.ts";
import {
  simpleReview,
  advancedReview,
} from "../src/lib/articulation-review.ts";
import { feedbackExport } from "../src/lib/feedback-export.ts";
import { practiceFixture, feedbackInput } from "./helpers/practice-fixture.ts";

test("five musical goals change priorities, language and supported investigations without changing measurements", () => {
  const analysis = practiceFixture();
  const original = structuredClone(analysis);
  const outputs = Object.keys(PRACTICE_GOALS).map((goal) =>
    generatePracticeFeedback(feedbackInput(goal as PracticeGoal, analysis)),
  );
  assert.ok(
    outputs.every((o) => o.findings.length > 0 && o.findings.length <= 3),
  );
  assert.equal(outputs[0].findings[0].investigation, "level");
  assert.equal(outputs[1].findings[0].investigation, "transition");
  assert.equal(outputs[2].findings[0].investigation, "pitch");
  assert.equal(outputs[3].findings[0].investigation, "articulation");
  assert.equal(outputs[4].findings[0].investigation, "expression");
  assert.deepEqual(analysis, original);
});

test("findings expose actual measurements and exact source references, never guessed values", () => {
  const input = feedbackInput();
  const finding = generatePracticeFeedback(input).findings.find((f) =>
    f.measurements.some((m) => m.label === "Level difference"),
  )!;
  assert.ok(finding);
  assert.ok(
    Math.abs(
      finding.measurements.find((m) => m.label === "Level difference")!.value -
        6,
    ) < 1e-9,
  );
  assert.ok(finding.references.every((r) => r.module === "tone"));
  assert.equal(finding.references.length, 2);
  const adjusted = practiceFixture(9);
  const revised = generatePracticeFeedback(feedbackInput("dynamics", adjusted));
  assert.ok(
    revised.findings.some((f) =>
      f.measurements.some(
        (m) => m.label === "Level difference" && Math.abs(m.value - 9) < 1e-9,
      ),
    ),
  );
});

test("all findings and evidence timestamps remain inside the selected recording", () => {
  for (const goal of Object.keys(PRACTICE_GOALS) as PracticeGoal[]) {
    const input = feedbackInput(goal);
    input.interval = { start: 1, end: 7 };
    const out = generatePracticeFeedback(input);
    for (const f of out.findings) {
      for (const interval of [
        f.interval,
        ...f.relatedIntervals,
        ...f.references.map((r) => r.interval),
      ]) {
        assert.ok(
          interval.start >= 0 &&
            interval.end <= 8 &&
            interval.end > interval.start,
        );
      }
      assert.ok(f.interval.start >= 1 && f.interval.end <= 7);
    }
  }
  const input = feedbackInput();
  input.interval = { start: -1, end: 100 };
  assert.equal(generatePracticeFeedback(input).findings.length, 0);
  input.interval = { start: 0, end: 8 };
  input.recordingId = "different-recording";
  assert.equal(generatePracticeFeedback(input).findings.length, 0);
});

test("insufficient harmonic, level and pitch evidence suppresses unsupported findings", () => {
  for (const goal of Object.keys(PRACTICE_GOALS) as PracticeGoal[]) {
    const input = feedbackInput(goal);
    input.analysis!.tone.frames.forEach((f) => {
      f.active = false;
      f.harmonicSupport = null;
      f.note = null;
      f.midi = null;
    });
    input.analysis!.tone.events = [];
    input.analysis!.pitch.frames.forEach((f) => {
      f.frequency = null;
      f.midi = null;
      f.note = null;
      f.cents = null;
      f.rejection = "low-confidence";
    });
    const output = generatePracticeFeedback(input);
    assert.equal(output.findings.length, 0);
    assert.equal(
      output.insufficient,
      "Not enough reliable information to provide feedback for this goal.",
    );
  }
});

test("small differences are not criticised and expressive contrast is not penalised", () => {
  const analysis = practiceFixture(0.5, 0);
  analysis.tone.events = [];
  analysis.tone.frames.forEach((f) => (f.centroid = 500));
  assert.equal(
    generatePracticeFeedback(feedbackInput("dynamics", analysis)).findings
      .length,
    0,
  );
  const expressive = generatePracticeFeedback(feedbackInput("expression"));
  assert.match(expressive.findings[0].relevance, /musical shape/);
  assert.doesNotMatch(
    JSON.stringify(expressive.findings),
    /poor|bad tone|wrong note played|too loud|incorrect bow|quality score.*\d%/i,
  );
  const strict = generatePracticeFeedback(feedbackInput("dynamics", analysis), {
    ...FEEDBACK_RULES,
    levelDifferenceDb: 10,
  });
  assert.equal(strict.findings.length, 0);
});

test("unconfirmed, yes, no, and not-sure reviews have distinct truthful wording and shared state", () => {
  const input = feedbackInput("transitions");
  const event = input.analysis!.tone.events[0];
  let output = generatePracticeFeedback(input);
  assert.ok(
    output.findings.every((f) => !f.observation.includes("You identified")),
  );
  input.reviews[event.id] = simpleReview(event, undefined, "yes", 8);
  output = generatePracticeFeedback(input);
  assert.match(output.findings[0].observation, /You identified a bow reversal/);
  assert.equal(input.reviews[event.id].kind, "candidate-bow-reversal");
  input.reviews[event.id] = simpleReview(
    event,
    input.reviews[event.id],
    "no",
    8,
  );
  assert.equal(input.reviews[event.id].status, "not-bow");
  assert.ok(
    generatePracticeFeedback(input)
      .findings.find((f) => f.eventId === event.id)!
      .observation.includes("did not identify"),
  );
  input.reviews[event.id] = simpleReview(
    event,
    input.reviews[event.id],
    "unsure",
    8,
  );
  assert.equal(input.reviews[event.id].status, "unsure");
  assert.equal(input.reviews[event.id].bowAnswer, "unsure");
  assert.ok(
    generatePracticeFeedback(input).findings.every(
      (f) => !f.observation.includes("You identified"),
    ),
  );
});

test("advanced adjustments and simple answers share one immutable-source annotation and export", () => {
  const input = feedbackInput("transitions");
  const event = input.analysis!.tone.events[0];
  const original = structuredClone(event);
  input.reviews[event.id] = advancedReview({
    eventId: event.id,
    status: "adjusted",
    time: 2.8,
    kind: "candidate-bow-reversal",
  });
  let finding = generatePracticeFeedback(input).findings.find(
    (f) => f.eventId === event.id,
  )!;
  assert.match(finding.observation, /original acoustic candidate at 2.00/);
  assert.match(finding.observation, /2.80 seconds/);
  assert.equal(
    finding.measurements.find((m) => m.label === "Original envelope dip")!
      .value,
    event.dipDb,
  );
  input.reviews[event.id] = simpleReview(
    event,
    input.reviews[event.id],
    "unsure",
    8,
  );
  assert.equal(input.reviews[event.id].time, 2.8);
  input.reviews[event.id] = advancedReview({
    eventId: event.id,
    status: "confirmed",
    time: event.time,
    kind: "other-transient",
  });
  assert.equal(input.reviews[event.id].bowAnswer, "no");
  assert.notEqual(input.reviews[event.id].bowAnswer, "yes");
  finding = generatePracticeFeedback(input).findings.find(
    (f) => f.eventId === event.id,
  )!;
  assert.doesNotMatch(finding.observation, /You identified a bow reversal/);
  const out = feedbackExport(
    { id: input.recordingId, name: "Cello", instrument: "cello" },
    input.analysis!,
    generatePracticeFeedback(input),
    input.reviews,
    input.interval,
    { [finding.id]: "useful" },
    { [finding.id]: 1 },
  );
  const json = JSON.parse(JSON.stringify(out));
  assert.deepEqual(json.algorithmEvents[0], original);
  assert.equal(json.manualReviews[0].kind, "other-transient");
  assert.equal(json.findingRatings[finding.id], "useful");
  assert.equal("file" in json.recording, false);
  assert.deepEqual(event, original);
});

test("pitch feedback gates vibrato-like motion, glissandi, note changes and weak harmonic evidence", () => {
  const input = feedbackInput("pitch");
  const offset = generatePracticeFeedback(input).findings[0];
  assert.match(offset.observation, /nearest equal-tempered reference/);
  assert.ok(offset.uncertainty.some((u) => u.includes("intended inflection")));
  input.analysis!.pitch.frames.forEach((f, i) => {
    f.cents = 30 * Math.sin(i * 0.6);
  });
  assert.equal(generatePracticeFeedback(input).findings.length, 0);
  input.analysis!.pitch.frames.forEach((f, i) => {
    f.note = i % 2 ? "D3" : "A3";
    f.cents = 20;
  });
  assert.equal(generatePracticeFeedback(input).findings.length, 0);
  input.analysis!.pitch.frames.forEach((f) => {
    f.note = "D3";
    f.diagnostics!.margin = 0.01;
  });
  assert.equal(generatePracticeFeedback(input).findings.length, 0);
});

test("same-note comparisons reject different registers and overlapping passages", () => {
  const input = feedbackInput("dynamics");
  input.analysis!.tone.events = [];
  input.interval = { start: 0.2, end: 3.8 };
  input.comparison = { start: 0.5, end: 3 };
  assert.equal(generatePracticeFeedback(input).findings.length, 0);
  input.interval = { start: 4.2, end: 7.8 };
  input.comparison = { start: 0.2, end: 3.8 };
  input
    .analysis!.tone.frames.filter((f) => f.time >= 4)
    .forEach((f) => {
      f.note = "A3";
      f.midi = 57;
    });
  assert.equal(generatePracticeFeedback(input).findings.length, 0);
});

test("identical inputs yield deterministic findings; bounded output has no fabricated grades or diagnoses", () => {
  const input = feedbackInput();
  const first = generatePracticeFeedback(input);
  assert.deepEqual(first, generatePracticeFeedback(structuredClone(input)));
  assert.ok(first.findings.length <= 3);
  assert.ok(
    first.findings.every(
      (f) =>
        f.measurements.length &&
        f.references.length &&
        f.uncertainty.length &&
        f.priorityReason,
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(first.findings),
    /your bow pressure|wrong bow technique|quality is|tone score|you played the wrong note/i,
  );
});

test("articulation compares measured same-register transitions and keeps confirmations separate", () => {
  const input = feedbackInput("articulation");
  const event = input.analysis!.tone.events[0];
  input.reviews[event.id] = simpleReview(event, undefined, "yes", 8);
  const finding = generatePracticeFeedback(input).findings.find(
    (f) => f.title === "Compare two acoustic transitions",
  )!;
  assert.ok(finding);
  assert.equal(
    finding.measurements.find((m) => m.label === "Difference in dip depth")!
      .value,
    2,
  );
  assert.match(finding.observation, /identified 1/);
  assert.ok(finding.references.some((r) => r.module === "review"));
  input
    .analysis!.tone.frames.filter((f) => f.time > 4)
    .forEach((f) => {
      f.note = "A3";
      f.midi = 57;
    });
  assert.ok(
    !generatePracticeFeedback(input).findings.some(
      (f) => f.title === "Compare two acoustic transitions",
    ),
  );
});
