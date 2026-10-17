import type { AnalysisBundle } from "./practice-session.ts";
import type { FeedbackInput, FeedbackOutput } from "./practice-feedback.ts";

export type FeedbackRequest = Omit<FeedbackInput, "analysis">;
export type FeedbackClient = {
  request: (input: FeedbackRequest) => Promise<FeedbackOutput>;
  dispose: () => void;
};
/** Cache measurements in a worker once; later goal/review messages contain no PCM or DSP work. */
export function createFeedbackClient(analysis: AnalysisBundle): FeedbackClient {
  const worker = new Worker(
    new URL("../workers/feedback.worker.ts", import.meta.url),
    { type: "module" },
  );
  let sequence = 0;
  let pending: {
    id: number;
    resolve: (value: FeedbackOutput) => void;
    reject: (error: Error) => void;
  } | null = null;
  let failed = false;
  const fail = (message: string) => {
    failed = true;
    pending?.reject(new Error(message));
    pending = null;
    worker.terminate();
  };
  worker.onerror = () =>
    fail(
      "The feedback worker could not run. Reanalyse or reload the page to try again.",
    );
  worker.onmessageerror = () =>
    fail("The feedback result could not be read. Reanalyse to try again.");
  worker.onmessage = (
    event: MessageEvent<{
      id: number;
      result?: FeedbackOutput;
      error?: string;
    }>,
  ) => {
    if (event.data.id !== pending?.id) return;
    if (event.data.result) pending.resolve(event.data.result);
    else
      pending.reject(
        new Error(event.data.error ?? "Feedback generation failed."),
      );
    pending = null;
  };
  try {
    worker.postMessage({ type: "init", analysis });
  } catch {
    worker.terminate();
    throw new Error(
      "Not enough memory to prepare feedback. Try a shorter recording.",
    );
  }
  return {
    request(input) {
      if (failed)
        return Promise.reject(
          new Error(
            "The feedback worker is unavailable. Reanalyse or reload to try again.",
          ),
        );
      pending?.reject(
        new DOMException("Feedback request replaced", "AbortError"),
      );
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending = { id, resolve, reject };
        try {
          worker.postMessage({ type: "feedback", id, input });
        } catch {
          fail(
            "The feedback request could not be sent. Try a shorter recording.",
          );
        }
      });
    },
    dispose() {
      failed = true;
      pending?.reject(new DOMException("Feedback cancelled", "AbortError"));
      pending = null;
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    },
  };
}
