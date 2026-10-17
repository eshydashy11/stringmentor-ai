import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeRecording, type DecodedAudio } from "../src/lib/decode-audio.ts";
const valid: DecodedAudio = {
  sampleRate: 22050,
  duration: 1,
  length: 22050,
  numberOfChannels: 1,
  getChannelData: () => new Float32Array(22050),
};
test("decode rejects empty, oversized, unreadable and corrupt audio with useful errors", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(decodeRecording(new Blob(), 22050, signal), /empty/);
  await assert.rejects(
    decodeRecording({ size: 101 * 1024 * 1024 } as Blob, 22050, signal),
    /100 MB/,
  );
  await assert.rejects(
    decodeRecording(
      {
        size: 10,
        arrayBuffer: async () => {
          throw new Error("read failed");
        },
      } as unknown as Blob,
      22050,
      signal,
    ),
    /could not be decoded/,
  );
  await assert.rejects(
    decodeRecording(new Blob(["not audio"]), 22050, signal, () => ({
      decodeAudioData: async () => {
        throw new DOMException("bad bytes", "EncodingError");
      },
    })),
    /damaged or use an unsupported codec/,
  );
});
test("decode preserves the original Blob, requests analysis sample rate, and bounds duration", async () => {
  const file = new Blob(["fake decoder input"]);
  const result = await decodeRecording(
    file,
    22050,
    new AbortController().signal,
    (rate) => {
      assert.equal(rate, 22050);
      return {
        decodeAudioData: async (bytes) => {
          assert.equal(bytes.byteLength, file.size);
          return valid;
        },
      };
    },
  );
  assert.equal(result, valid);
  assert.equal(await file.text(), "fake decoder input");
  for (const [duration, pattern] of [
    [0, /no readable/],
    [NaN, /no readable/],
    [601, /ten minutes/],
  ] as const)
    await assert.rejects(
      decodeRecording(file, 22050, new AbortController().signal, () => ({
        decodeAudioData: async () => ({ ...valid, duration }),
      })),
      pattern,
    );
});
test("cancellation before and during decoding suppresses late results", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    decodeRecording(new Blob(["data"]), 22050, controller.signal),
    { name: "AbortError" },
  );
  const during = new AbortController();
  await assert.rejects(
    decodeRecording(new Blob(["data"]), 22050, during.signal, () => ({
      decodeAudioData: async () => {
        during.abort();
        return valid;
      },
    })),
    { name: "AbortError" },
  );
});
