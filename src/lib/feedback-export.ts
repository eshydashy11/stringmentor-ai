import type { Recording } from "./storage.ts";
import type { ArticulationReview } from "./articulation-review.ts";
import type { AnalysisBundle } from "./practice-session.ts";
import type { FeedbackOutput, TimeInterval } from "./practice-feedback.ts";

export function feedbackExport(
  recording: Pick<Recording, "id" | "name" | "instrument">,
  analysis: AnalysisBundle,
  feedback: FeedbackOutput,
  reviews: Record<string, ArticulationReview>,
  interval: TimeInterval,
  ratings: Record<string, "useful" | "not-useful">,
  investigations: Record<string, number>,
) {
  if (analysis.recordingId !== recording.id)
    throw new Error("Cannot export analysis for a different recording.");
  return {
    schema: "stringmentor-practice-review-v2",
    algorithm: analysis.tone.version,
    recording: {
      id: recording.id,
      name: recording.name,
      instrument: recording.instrument,
      duration: analysis.tone.duration,
    },
    selectedGoal: feedback.goal,
    selectedInterval: interval,
    feedback,
    algorithmEvents: analysis.tone.events,
    manualReviews: Object.values(reviews),
    findingRatings: ratings,
    investigationChoices: investigations,
    note: "Local session annotations, not independent ground truth. No audio included. Responses do not train or automatically improve a model.",
  };
}
