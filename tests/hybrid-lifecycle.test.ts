import { test } from "node:test";
import assert from "node:assert/strict";
import { analysePracticeRecording } from "../src/lib/practice-session.ts";
import { practiceFixture } from "./helpers/practice-fixture.ts";
import { experimentalFixture } from "./helpers/experimental-fixture.ts";

test("two-minute Hybrid limit is checked before starting a worker and never lowers the Standard limit", async () => {
  const descriptors = ["Worker", "OfflineAudioContext"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  let workers = 0;
  const fixture = practiceFixture();
  class WorkerAdapter {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    constructor() {
      workers++;
    }
    terminate() {}
    postMessage() {
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            type: "result",
            result: fixture.tone,
            pitch: fixture.pitch,
            experimental: experimentalFixture(fixture),
          },
        }),
      );
    }
  }
  class Decoder {
    async decodeAudioData() {
      return {
        duration: 121,
        length: 121 * 22050,
        sampleRate: 22050,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(121 * 22050),
      };
    }
  }
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: WorkerAdapter,
  });
  Object.defineProperty(globalThis, "OfflineAudioContext", {
    configurable: true,
    value: Decoder,
  });
  try {
    await assert.rejects(
      analysePracticeRecording(
        fixture.recordingId,
        new Blob(["audio"]),
        new AbortController().signal,
        () => {},
        true,
        true,
      ),
      /two minutes/,
    );
    assert.equal(workers, 0);
    await analysePracticeRecording(
      fixture.recordingId,
      new Blob(["audio"]),
      new AbortController().signal,
      () => {},
    );
    assert.equal(workers, 1);
    // A shorter hybrid request must not be falsely completed by a worker lacking the model result.
    Decoder.prototype.decodeAudioData = async () => ({
      duration: 8,
      length: 8 * 22050,
      sampleRate: 22050,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(8 * 22050),
    });
    await assert.rejects(
      analysePracticeRecording(
        fixture.recordingId,
        new Blob(["audio"]),
        new AbortController().signal,
        () => {},
        true,
        true,
      ),
      /did not return a result/,
    );
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
