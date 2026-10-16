import { test } from "node:test";
import assert from "node:assert/strict";
import fixWebmDuration from "fix-webm-duration";

test("WebM repair writes duration metadata while preserving audio MIME for seeking", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
  // Node has Blob but no FileReader. Supply only the browser read operation used
  // by the repair library; exercise its real EBML parser on a minimal Info segment.
  class BlobReader {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  }
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    value: BlobReader,
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "FileReader", previous);
    else Reflect.deleteProperty(globalThis, "FileReader");
  });
  const ebml = new Uint8Array([
    0x18,
    0x53,
    0x80,
    0x67,
    0x8c, // Segment
    0x15,
    0x49,
    0xa9,
    0x66,
    0x87, // Info
    0x2a,
    0xd7,
    0xb1,
    0x83,
    0x0f,
    0x42,
    0x40, // TimecodeScale = 1 ms
  ]);
  const source = new Blob([ebml], { type: "audio/webm;codecs=opus" });
  const fixed = await fixWebmDuration(source, 5250, { logger: false });
  const bytes = Buffer.from(await fixed.arrayBuffer());
  const durationOffset = bytes.indexOf(Buffer.from([0x44, 0x89, 0x88]));
  assert.ok(durationOffset >= 0, "Duration element must be added");
  assert.equal(bytes.readDoubleBE(durationOffset + 3), 5250);
  assert.equal(fixed.type, source.type);
});
