import { generatePracticeFeedback } from "../lib/practice-feedback";
import type { FeedbackRequest } from "../lib/practice-feedback-client";
import type { AnalysisBundle } from "../lib/practice-session";

let analysis: AnalysisBundle | null = null;
self.onmessage = (
  event: MessageEvent<
    | { type: "init"; analysis: AnalysisBundle }
    | { type: "feedback"; id: number; input: FeedbackRequest }
  >,
) => {
  const message = event.data;
  if (message.type === "init") {
    analysis = message.analysis;
    return;
  }
  try {
    if (!analysis || analysis.recordingId !== message.input.recordingId)
      throw new Error("Feedback measurements do not belong to this recording.");
    self.postMessage({
      id: message.id,
      result: generatePracticeFeedback({ ...message.input, analysis }),
    });
  } catch (error) {
    self.postMessage({
      id: message.id,
      error:
        error instanceof Error
          ? error.message
          : "Feedback generation failed. Try a shorter interval.",
    });
  }
};
