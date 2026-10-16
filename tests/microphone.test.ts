import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMicrophoneSession,
  recordingFile,
  MAX_RECORDING_MS,
  type CaptureState,
} from "../src/lib/microphone.ts";
import { MAX_FILE_SIZE } from "../src/lib/audio.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
class FakeTrack extends EventTarget {
  readyState = "live";
  stops = 0;
  stop() {
    this.stops++;
    this.readyState = "ended";
  }
}
class FakeRecorder {
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  data: Blob = new Blob(["captured audio"], { type: this.mimeType });
  stops = 0;
  start() {
    this.state = "recording";
  }
  stop() {
    this.stops++;
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: this.data } as BlobEvent);
      this.onstop?.();
    });
  }
}
function harness(
  overrides: Partial<Parameters<typeof createMicrophoneSession>[0]> = {},
) {
  const track = new FakeTrack();
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const recorder = new FakeRecorder();
  const files: File[] = [];
  const states: CaptureState[] = [];
  const formats: (string | undefined)[] = [];
  let clock = 0;
  let permissions = 0;
  const session = createMicrophoneSession({
    instrument: "cello",
    getStream: async () => {
      permissions++;
      return stream;
    },
    isTypeSupported: (mime) => mime.startsWith("audio/webm"),
    createRecorder: (_stream, mime) => {
      formats.push(mime);
      return recorder as unknown as MediaRecorder;
    },
    prepareBlob: async (blob) => blob,
    onComplete: async (file) => {
      files.push(file);
    },
    onState: (state) => {
      states.push(state);
    },
    now: () => clock,
    date: () => new Date(2026, 9, 16, 14, 30, 0),
    ...overrides,
  });
  return {
    session,
    track,
    stream,
    recorder,
    files,
    states,
    formats,
    advance: (ms: number) => {
      clock += ms;
    },
    permissions: () => permissions,
  };
}

test("recording starts only explicitly and saves final chunks with date, MIME, and extension", async (t) => {
  const h = harness();
  t.after(h.session.dispose);
  assert.equal(h.permissions(), 0);
  await h.session.start();
  assert.equal(h.permissions(), 1);
  assert.equal(h.states.at(-1)?.phase, "recording");
  h.advance(4200);
  h.session.stop();
  assert.equal(
    h.track.readyState,
    "ended",
    "microphone releases before file processing",
  );
  await flush();
  assert.equal(h.files.length, 1);
  assert.equal(h.files[0].name, "Cello Practice — 16 Oct 2026 — 14.30.00.webm");
  assert.equal(h.files[0].type, "audio/webm;codecs=opus");
  assert.equal(await h.files[0].text(), "captured audio");
  assert.equal(h.states.at(-1)?.elapsedSeconds, 4);
  assert.equal(h.states.at(-1)?.phase, "complete");
});

test("Safari-style MP4 support selects MP4 and produces an M4A violin file", async (t) => {
  const h = harness({
    instrument: "violin",
    isTypeSupported: (mime) => mime === "audio/mp4",
  });
  t.after(h.session.dispose);
  h.recorder.mimeType = "audio/mp4";
  h.recorder.data = new Blob(["AAC audio"], { type: "audio/mp4" });
  await h.session.start();
  h.advance(1000);
  h.session.stop();
  await flush();
  assert.deepEqual(h.formats, ["audio/mp4"]);
  assert.match(h.files[0].name, /^Violin Practice.*\.m4a$/);
  assert.equal(h.files[0].type, "audio/mp4");
});

test("browser-default format uses actual chunk MIME instead of inventing WebM", async (t) => {
  const h = harness({ isTypeSupported: () => false });
  t.after(h.session.dispose);
  h.recorder.mimeType = "";
  h.recorder.data = new Blob(["Ogg audio"], { type: "audio/ogg;codecs=opus" });
  await h.session.start();
  h.advance(1000);
  h.session.stop();
  await flush();
  assert.deepEqual(h.formats, [undefined]);
  assert.match(h.files[0].name, /\.ogg$/);
});

test("permission rejection is useful and does not save a file", async (t) => {
  const h = harness({
    getStream: async () => {
      throw new DOMException("Denied", "NotAllowedError");
    },
  });
  t.after(h.session.dispose);
  await h.session.start();
  assert.equal(h.states.at(-1)?.phase, "error");
  assert.match(h.states.at(-1)!.message, /site settings/);
  assert.equal(h.files.length, 0);
});

test("permission granted after cancellation releases every track without recording", async () => {
  let grant!: (stream: MediaStream) => void;
  const h = harness({
    getStream: () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  });
  const pending = h.session.start();
  h.session.dispose();
  grant(h.stream);
  await pending;
  assert.equal(h.track.stops, 1);
  assert.equal(h.recorder.state, "inactive");
  assert.equal(h.files.length, 0);
  assert.equal(h.states.length, 1, "no updates after disposal");
});

test("disposing during a take stops recorder and device, discarding late chunks", async () => {
  const h = harness();
  await h.session.start();
  h.session.dispose();
  await flush();
  assert.equal(h.track.stops, 1);
  assert.equal(h.recorder.stops, 1);
  assert.equal(h.files.length, 0);
});

test("failed recorder construction releases microphone", async (t) => {
  const h = harness({
    createRecorder: () => {
      throw new DOMException("Unsupported", "NotSupportedError");
    },
  });
  t.after(h.session.dispose);
  await h.session.start();
  assert.equal(h.track.stops, 1);
  assert.match(h.states.at(-1)!.message, /supported audio format/);
});

test("five-minute deadline automatically stops and saves exactly once", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const h = harness();
  t.after(h.session.dispose);
  await h.session.start();
  h.advance(MAX_RECORDING_MS);
  t.mock.timers.tick(MAX_RECORDING_MS);
  await flush();
  assert.equal(h.recorder.stops, 1);
  assert.equal(h.track.stops, 1);
  assert.equal(h.files.length, 1);
  assert.match(h.states.at(-1)!.message, /Five-minute limit/);
  assert.equal(h.states.at(-1)?.elapsedSeconds, 300);
});

test("empty and oversized captures do not enter the library", async (t) => {
  for (const size of [0, MAX_FILE_SIZE + 1]) {
    const h = harness();
    t.after(h.session.dispose);
    h.recorder.data = { size, type: "audio/webm" } as Blob;
    await h.session.start();
    h.session.stop();
    await flush();
    assert.equal(h.files.length, 0);
    assert.equal(h.states.at(-1)?.phase, "error");
    assert.match(h.states.at(-1)!.message, size ? /100 MB/ : /No audio/);
    assert.equal(h.track.readyState, "ended");
  }
});

test("native errors release the device and ignore subsequent stop events", async (t) => {
  const h = harness();
  t.after(h.session.dispose);
  await h.session.start();
  h.recorder.onerror?.();
  await flush();
  assert.equal(h.track.stops, 1);
  assert.equal(h.files.length, 0);
  assert.equal(h.states.at(-1)?.phase, "error");
});

test("microphone disconnect finalizes already captured audio", async (t) => {
  const h = harness();
  t.after(h.session.dispose);
  await h.session.start();
  h.advance(2000);
  h.track.dispatchEvent(new Event("ended"));
  await flush();
  assert.equal(h.files.length, 1);
  assert.match(h.states.at(-1)!.message, /disconnected/);
});

test("dispose while preparing audio prevents a later save", async () => {
  let finish!: (blob: Blob) => void;
  const h = harness({
    prepareBlob: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await h.session.start();
  h.session.stop();
  await flush();
  h.session.dispose();
  finish(new Blob(["audio"], { type: "audio/webm" }));
  await flush();
  assert.equal(h.files.length, 0);
  assert.equal(h.track.readyState, "ended");
});

test("storage/processing failures surface useful errors after device release", async (t) => {
  const h = harness({
    onComplete: async () => {
      throw new Error(
        "Browser storage is full. Try removing an old recording.",
      );
    },
  });
  t.after(h.session.dispose);
  await h.session.start();
  h.session.stop();
  await flush();
  assert.equal(h.states.at(-1)?.phase, "error");
  assert.match(h.states.at(-1)!.message, /storage is full/);
  assert.equal(h.track.readyState, "ended");
});

test("file creation rejects unknown MIME types and retains the existing 100 MB validation", () => {
  assert.throws(
    () =>
      recordingFile(
        new Blob(["bad"], { type: "video/mp4" }),
        "cello",
        new Date(),
      ),
    /unsupported audio format/,
  );
});
