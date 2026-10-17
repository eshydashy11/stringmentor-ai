import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseToneRecording } from "../src/lib/analyse-tone-recording.ts";
import { analyseTone } from "../src/lib/tone.ts";

test("tone analysis transfers copied audio, reports results, and terminates its worker", async () => {
  const source = new Float32Array(22050).fill(0.1);
  let terminated = false;
  let hasMessageHandler = () => true;
  const result = analyseTone(source);
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    constructor() {
      hasMessageHandler = () => this.onmessage !== null;
    }
    terminate() {
      terminated = true;
    }
    postMessage(data: { channels: Float32Array[] }, transfer: ArrayBuffer[]) {
      assert.notEqual(data.channels[0], source);
      assert.deepEqual(data.channels[0], source);
      assert.equal(transfer[0], data.channels[0].buffer);
      queueMicrotask(() => {
        this.onmessage?.({ data: { type: "progress", progress: 0.5 } });
        this.onmessage?.({ data: { type: "result", result } });
      });
    }
  }
  class Decoder {
    async decodeAudioData() {
      return {
        duration: 1,
        sampleRate: 22050,
        length: source.length,
        numberOfChannels: 1,
        getChannelData: () => source,
      };
    }
  }
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldDecoder = Object.getOwnPropertyDescriptor(
    globalThis,
    "OfflineAudioContext",
  );
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: FakeWorker,
  });
  Object.defineProperty(globalThis, "OfflineAudioContext", {
    configurable: true,
    value: Decoder,
  });
  try {
    const progress: number[] = [];
    assert.equal(
      await analyseToneRecording(
        new Blob(["audio"]),
        new AbortController().signal,
        (p) => progress.push(p),
      ),
      result,
    );
    assert.deepEqual(progress, [0.5]);
    assert.equal(terminated, true);
    assert.equal(hasMessageHandler(), false);
    assert.equal(source.length, 22050);
  } finally {
    if (oldWorker) Object.defineProperty(globalThis, "Worker", oldWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (oldDecoder)
      Object.defineProperty(globalThis, "OfflineAudioContext", oldDecoder);
    else Reflect.deleteProperty(globalThis, "OfflineAudioContext");
  }
});

test("tone cancellation and worker errors release processing resources", async () => {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldDecoder = Object.getOwnPropertyDescriptor(
    globalThis,
    "OfflineAudioContext",
  );
  try {
    for (const mode of [
      "cancel",
      "error",
      "message-error",
      "processing-error",
    ] as const) {
      const controller = new AbortController();
      let terminated = false;
      class FakeWorker {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: (() => void) | null = null;
        onmessageerror: (() => void) | null = null;
        terminate() {
          terminated = true;
        }
        postMessage() {
          queueMicrotask(() => {
            if (mode === "cancel") controller.abort();
            else if (mode === "error") this.onerror?.();
            else if (mode === "message-error") this.onmessageerror?.();
            else
              this.onmessage?.({
                data: {
                  type: "error",
                  message: "The decoded audio contains invalid samples.",
                },
              });
          });
        }
      }
      class Decoder {
        async decodeAudioData() {
          return {
            duration: 1,
            sampleRate: 22050,
            length: 22050,
            numberOfChannels: 1,
            getChannelData: () => new Float32Array(22050),
          };
        }
      }
      Object.defineProperty(globalThis, "Worker", {
        configurable: true,
        value: FakeWorker,
      });
      Object.defineProperty(globalThis, "OfflineAudioContext", {
        configurable: true,
        value: Decoder,
      });
      await assert.rejects(
        analyseToneRecording(new Blob(["audio"]), controller.signal, () => {}),
        mode === "cancel"
          ? { name: "AbortError" }
          : /could not|invalid samples/,
      );
      assert.equal(terminated, true);
    }
  } finally {
    if (oldWorker) Object.defineProperty(globalThis, "Worker", oldWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (oldDecoder)
      Object.defineProperty(globalThis, "OfflineAudioContext", oldDecoder);
    else Reflect.deleteProperty(globalThis, "OfflineAudioContext");
  }
});

test("tone analysis handles unsupported browsers, worker startup failure, and transfer allocation failure", async () => {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldDecoder = Object.getOwnPropertyDescriptor(
    globalThis,
    "OfflineAudioContext",
  );
  try {
    Reflect.deleteProperty(globalThis, "Worker");
    await assert.rejects(
      analyseToneRecording(
        new Blob(["audio"]),
        new AbortController().signal,
        () => {},
      ),
      /unavailable in this browser/,
    );
    class Decoder {
      async decodeAudioData() {
        return {
          duration: 1,
          length: 22050,
          sampleRate: 22050,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array(22050),
        };
      }
    }
    Object.defineProperty(globalThis, "OfflineAudioContext", {
      configurable: true,
      value: Decoder,
    });
    class BrokenWorker {
      constructor() {
        throw new Error("Blocked worker");
      }
    }
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: BrokenWorker,
    });
    await assert.rejects(
      analyseToneRecording(
        new Blob(["audio"]),
        new AbortController().signal,
        () => {},
      ),
      /worker could not start/,
    );
    let terminated = false;
    class TransferFailureWorker {
      onmessage = null;
      onerror = null;
      onmessageerror = null;
      terminate() {
        terminated = true;
      }
      postMessage() {
        throw new Error("Allocation failed");
      }
    }
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: TransferFailureWorker,
    });
    await assert.rejects(
      analyseToneRecording(
        new Blob(["audio"]),
        new AbortController().signal,
        () => {},
      ),
      /Not enough memory/,
    );
    assert.equal(terminated, true);
  } finally {
    if (oldWorker) Object.defineProperty(globalThis, "Worker", oldWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (oldDecoder)
      Object.defineProperty(globalThis, "OfflineAudioContext", oldDecoder);
    else Reflect.deleteProperty(globalThis, "OfflineAudioContext");
  }
});
