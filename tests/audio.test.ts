import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTime,
  MAX_FILE_SIZE,
  trackTitle,
  validateAudio,
} from "../src/lib/audio.ts";
test("upload validation accepts browser audio and missing MIME audio extensions", () => {
  assert.equal(
    validateAudio({ name: "scale.wav", type: "audio/wav", size: 100 }),
    null,
  );
  assert.equal(validateAudio({ name: "scale.MP3", type: "", size: 100 }), null);
  assert.equal(
    validateAudio({
      name: "scale.m4a",
      type: "application/octet-stream",
      size: 100,
    }),
    null,
  );
});
test("upload validation rejects empty, oversized, and non-audio files", () => {
  assert.match(
    validateAudio({ name: "scale.wav", type: "audio/wav", size: 0 })!,
    /empty/,
  );
  assert.match(
    validateAudio({
      name: "scale.wav",
      type: "audio/wav",
      size: MAX_FILE_SIZE + 1,
    })!,
    /100 MB/,
  );
  assert.match(
    validateAudio({ name: "notes.pdf", type: "application/pdf", size: 100 })!,
    /not a supported/,
  );
  assert.match(
    validateAudio({ name: "notes.mp3", type: "application/pdf", size: 100 })!,
    /not a supported/,
  );
});
test("time display is stable before metadata and on invalid durations", () => {
  assert.equal(formatTime(125.8), "2:05");
  assert.equal(formatTime(3600), "60:00");
  for (const value of [0, -1, NaN, Infinity])
    assert.equal(formatTime(value), "0:00");
  assert.equal(trackTitle("Bach_prelude-cello.wav"), "Bach prelude cello");
});
