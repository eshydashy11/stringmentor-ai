import { test } from "node:test";
import assert from "node:assert/strict";
import { createFeedbackClient } from "../src/lib/practice-feedback-client.ts";
import { generatePracticeFeedback } from "../src/lib/practice-feedback.ts";
import { practiceFixture, feedbackInput } from "./helpers/practice-fixture.ts";

test("feedback worker caches measurements once, sends small goal changes, ignores stale replies and disposes", async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const instances: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    messages: Record<string, unknown>[] = [];
    terminated = false;
    constructor() {
      instances.push(this);
    }
    postMessage(data: Record<string, unknown>) {
      this.messages.push(data);
    }
    terminate() {
      this.terminated = true;
    }
  }
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: FakeWorker,
  });
  try {
    const analysis = practiceFixture();
    const client = createFeedbackClient(analysis);
    const worker = instances[0];
    const { analysis: _, ...input } = feedbackInput("dynamics", analysis);
    void _;
    const first = client.request(input);
    const rejected = assert.rejects(first, { name: "AbortError" });
    const second = client.request({ ...input, goal: "expression" });
    await rejected;
    assert.equal(worker.messages.filter((m) => m.type === "init").length, 1);
    assert.equal("analysis" in (worker.messages[2].input as object), false);
    worker.onmessage?.({
      data: {
        id: 1,
        result: generatePracticeFeedback(feedbackInput("dynamics", analysis)),
      },
    });
    const expected = generatePracticeFeedback(
      feedbackInput("expression", analysis),
    );
    worker.onmessage?.({ data: { id: 2, result: expected } });
    assert.equal(await second, expected);
    const cancelled = client.request(input);
    const cancellation = assert.rejects(cancelled, { name: "AbortError" });
    client.dispose();
    await cancellation;
    assert.equal(worker.terminated, true);
    assert.equal(worker.onmessage, null);
  } finally {
    if (old) Object.defineProperty(globalThis, "Worker", old);
    else Reflect.deleteProperty(globalThis, "Worker");
  }
});

test("feedback worker errors surface useful messages without invented output", async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const instances: FakeWorker[] = [];
  class FakeWorker {
    onmessage = null;
    onerror: (() => void) | null = null;
    onmessageerror = null;
    constructor() {
      instances.push(this);
    }
    postMessage() {}
    terminate() {}
  }
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: FakeWorker,
  });
  try {
    const analysis = practiceFixture();
    const client = createFeedbackClient(analysis);
    const worker = instances[0];
    const { analysis: _, ...input } = feedbackInput("dynamics", analysis);
    void _;
    const pending = client.request(input);
    const rejection = assert.rejects(pending, /could not run/);
    worker.onerror?.();
    await rejection;
    await assert.rejects(client.request(input), /unavailable/);
    client.dispose();
  } finally {
    if (old) Object.defineProperty(globalThis, "Worker", old);
    else Reflect.deleteProperty(globalThis, "Worker");
  }
});
