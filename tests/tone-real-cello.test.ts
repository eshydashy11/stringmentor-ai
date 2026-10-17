import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { analysePitch, mixToMono } from "../src/lib/pitch.ts";
import { generatePracticeFeedback } from "../src/lib/practice-feedback.ts";
import {
  analyseTone,
  clippingEvidence,
  summariseInterval,
} from "../src/lib/tone.ts";

const samplePath = process.env.STRINGMENTOR_CELLO_V2_PATH;
test(
  "V2 private cello development regression (set STRINGMENTOR_CELLO_V2_PATH; requires FFmpeg)",
  { skip: !samplePath },
  (t) => {
    assert.equal(
      createHash("sha256").update(readFileSync(samplePath!)).digest("hex"),
      "480019bc9d5d409167bc5723ff95e32552e835ce601a079b344f0984efd121a6",
      "These development observations apply only to the supplied V2 recording",
    );
    const bytes = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        samplePath!,
        "-ar",
        "22050",
        "-ac",
        "2",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const interleaved = new Float32Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const channels = [
      new Float32Array(interleaved.length / 2),
      new Float32Array(interleaved.length / 2),
    ];
    for (let i = 0; i < channels[0].length; i++) {
      channels[0][i] = interleaved[i * 2];
      channels[1][i] = interleaved[i * 2 + 1];
    }
    const samples = mixToMono(channels);
    const pitch = analysePitch(samples);
    const result = analyseTone(samples, pitch.frames);
    result.clipping = clippingEvidence(channels);
    assert.ok(result.duration > 36 && result.duration < 37);
    assert.equal(result.frames.length, 3155);
    assert.ok(
      result.frames.every(
        (f) =>
          Number.isFinite(f.dbfs) &&
          (f.flatness === null || (f.flatness >= 0 && f.flatness <= 1)),
      ),
    );
    // Snapshot of algorithm behaviour, NOT verified stroke labels or accuracy claims.
    assert.equal(result.events.length, 36);
    assert.equal(
      result.events.filter((e) => e.kind === "candidate-bow-reversal").length,
      1,
    );
    assert.equal(
      result.events.filter((e) => e.kind === "note-change").length,
      4,
    );
    assert.equal(result.clipping.nearFullScaleSamples, 0);
    // Real measurements exist even though no sustained offset/drift reaches the gates.
    const feedback = generatePracticeFeedback({
      recordingId: "private-v2",
      analysis: { recordingId: "private-v2", pitch, tone: result },
      goal: "pitch",
      interval: { start: 0, end: result.duration },
      reviews: {},
      recordingConditions: "unknown",
    });
    assert.equal(feedback.pitchAssessment!.status, "no-qualifying-pattern");
    assert.equal(feedback.insufficient, null);
    assert.equal(feedback.findings.length, 0);
    assert.equal(feedback.pitchAssessment!.regions.length, 24);
    assert.ok(
      Math.abs(feedback.pitchAssessment!.sustainedSeconds - 22.0822) < 0.001,
    );
    const counts = result.events.reduce<Record<string, number>>((all, e) => {
      all[e.kind] = (all[e.kind] ?? 0) + 1;
      return all;
    }, {});
    t.diagnostic(
      JSON.stringify({
        duration: result.duration,
        counts,
        fluxThreshold: result.fluxThreshold,
        clipping: result.clipping,
        summary: summariseInterval(result.frames, 0, result.duration),
        events: result.events.map(({ time, kind }) => ({
          time: Number(time.toFixed(3)),
          kind,
        })),
        note: "32 performed strokes are count-only context. No independently timestamped labels: real precision, recall, false positives and misses are unknown.",
      }),
    );
  },
);
