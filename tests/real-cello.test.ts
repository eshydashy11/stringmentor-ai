import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { analysePitch } from "../src/lib/pitch.ts";
const samplePath = process.env.STRINGMENTOR_CELLO_SAMPLE_PATH;

test(
  "original cello M4A regression (set STRINGMENTOR_CELLO_SAMPLE_PATH; requires FFmpeg)",
  { skip: !samplePath },
  (t) => {
    assert.equal(
      createHash("sha256").update(readFileSync(samplePath!)).digest("hex"),
      "6da88d0b66109e476222d85b1334b53b8e183f99d1de44a1bb70c17e556e07fc",
      "These labels apply only to the user's original open-string recording",
    );
    // Explicit arithmetic stereo mean, matching the browser's mono policy for this sample.
    const pcm = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        samplePath!,
        "-af",
        "pan=mono|c0=0.5*c0+0.5*c1",
        "-ar",
        "22050",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const samples = new Float32Array(
      pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
    );
    const result = analysePitch(samples);
    const regions = [
      [1.4, 4.2, "C2", 0.95],
      [4.6, 7.5, "G2", 0.99],
      [7.9, 10.6, "D3", 0.95],
      [11.3, 13.7, "A3", 0.95],
    ] as const;
    for (const [start, end, note, minCoverage] of regions) {
      const frames = result.frames.filter(
        (f) => f.time >= start && f.time <= end,
      );
      const correct = frames.filter((f) => f.note === note).length;
      const wrong = frames.filter(
        (f) => f.note !== null && f.note !== note,
      ).length;
      assert.equal(wrong, 0, `${note}: confident wrong-note assignments`);
      assert.ok(
        correct / frames.length >= minCoverage,
        `${note}: insufficient coverage ${correct}/${frames.length}`,
      );
      t.diagnostic(
        `${note} ${start}–${end}s: ${correct}/${frames.length} expected-note frames (${((100 * correct) / frames.length).toFixed(2)}%); ${wrong} wrong; ${frames.length - correct} withheld. Note identity only, not cents accuracy.`,
      );
    }
    for (const [time, note, low, high] of [
      [3.99, "C2", 66, 67],
      [8.01, "D3", 147, 149],
      [12, "A3", 221, 223],
      [13.14, "A3", 221, 223],
    ] as const) {
      const frame = result.frames.reduce((a, b) =>
        Math.abs(a.time - time) < Math.abs(b.time - time) ? a : b,
      );
      assert.equal(frame.note, note);
      assert.ok(frame.frequency! >= low && frame.frequency! <= high);
      t.diagnostic(
        `${frame.time.toFixed(4)}s: raw ${frame.diagnostics!.rawFrequency?.toFixed(4)} Hz → ${frame.frequency!.toFixed(4)} Hz; ${frame.diagnostics!.detail}`,
      );
    }
    const d = result.frames.filter((f) => f.time >= 7.9 && f.time <= 10.6);
    assert.ok(
      d.filter((f) => f.diagnostics?.rawRejection === "out-of-range").length >=
        50,
      "Reproduce the original D3 subharmonic failure before testing correction",
    );
  },
);
