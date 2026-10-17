import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PracticeAnalysisSession,
  validateBundle,
  type AnalysisBundle,
} from "../src/lib/practice-session.ts";
import { practiceFixture } from "./helpers/practice-fixture.ts";

test("a recording session deduplicates jobs and reuses measured results until explicit reanalysis", async () => {
  let count = 0;
  let finish!: (value: AnalysisBundle) => void;
  const fixture = practiceFixture();
  const session = new PracticeAnalysisSession(fixture.recordingId, async () => {
    count++;
    return await new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = session.run(new Blob(["audio"]));
  const second = session.run(new Blob(["audio"]));
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(count, 1);
  finish(fixture);
  await first;
  assert.equal(session.getSnapshot().result, fixture);
  await session.run(new Blob(["audio"]));
  assert.equal(count, 1);
  const fresh = session.run(new Blob(["audio"]), true);
  await Promise.resolve();
  assert.equal(count, 2);
  finish(fixture);
  await fresh;
  assert.equal(session.getSnapshot().revision, 2);
});

test("cancelled, switched and late results cannot populate another recording session", async () => {
  let finish!: (value: AnalysisBundle) => void;
  let progress!: (p: number) => void;
  const fixture = practiceFixture();
  const oldSession = new PracticeAnalysisSession(
    fixture.recordingId,
    async (_id, _file, _signal, p) => {
      progress = p;
      return await new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  const task = oldSession.run(new Blob(["audio"]));
  await Promise.resolve();
  oldSession.cancel();
  const next = new PracticeAnalysisSession(
    "new-recording",
    async () => fixture,
  );
  await next.run(new Blob(["audio"]));
  assert.equal(next.getSnapshot().status, "error");
  assert.equal(next.getSnapshot().result, null);
  progress(0.9);
  finish(fixture);
  await task;
  assert.equal(oldSession.getSnapshot().status, "cancelled");
  assert.equal(oldSession.getSnapshot().result, null);
});

test("scope validation rejects inconsistent durations and timestamps; short empty analyses remain honest", () => {
  const fixture = practiceFixture();
  assert.equal(validateBundle(fixture, fixture.recordingId), true);
  const corrupt = structuredClone(fixture);
  corrupt.tone.duration = NaN;
  assert.equal(validateBundle(corrupt, fixture.recordingId), false);
  corrupt.tone.duration = 8;
  corrupt.pitch.frames[0].time = 99;
  assert.equal(validateBundle(corrupt, fixture.recordingId), false);
  corrupt.pitch.frames = [];
  corrupt.tone.frames = [];
  assert.equal(validateBundle(corrupt, fixture.recordingId), true);
});

test("shared adapter receives pitch and tone from one worker response and rejects missing context", async () => {
  const { analysePracticeRecording } =
    await import("../src/lib/practice-session.ts");
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldDecoder = Object.getOwnPropertyDescriptor(
    globalThis,
    "OfflineAudioContext",
  );
  const fixture = practiceFixture();
  let workers = 0;
  let terminated = 0;
  let includePitch = true;
  class Decoder {
    async decodeAudioData() {
      return {
        sampleRate: 22050,
        duration: 8,
        length: 176400,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(176400),
      };
    }
  }
  class WorkerAdapter {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    constructor() {
      workers++;
    }
    terminate() {
      terminated++;
    }
    postMessage() {
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            type: "result",
            result: fixture.tone,
            ...(includePitch ? { pitch: fixture.pitch } : {}),
          },
        }),
      );
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
    const bundle = await analysePracticeRecording(
      fixture.recordingId,
      new Blob(["audio"]),
      new AbortController().signal,
      () => {},
    );
    assert.equal(bundle.pitch, fixture.pitch);
    assert.equal(bundle.tone, fixture.tone);
    assert.equal(workers, 1);
    assert.equal(terminated, 1);
    includePitch = false;
    await assert.rejects(
      analysePracticeRecording(
        fixture.recordingId,
        new Blob(["audio"]),
        new AbortController().signal,
        () => {},
      ),
      /shared pitch result/,
    );
    assert.equal(terminated, 2);
  } finally {
    if (oldWorker) Object.defineProperty(globalThis, "Worker", oldWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (oldDecoder)
      Object.defineProperty(globalThis, "OfflineAudioContext", oldDecoder);
    else Reflect.deleteProperty(globalThis, "OfflineAudioContext");
  }
});
