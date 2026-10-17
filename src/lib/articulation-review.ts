import type { AcousticEvent, AcousticEventKind, EventReview } from "./tone.ts";

export type BowAnswer = "yes" | "no" | "unsure";
export type ArticulationReview = {
  eventId: string;
  status: EventReview["status"] | "not-bow" | "unsure";
  time: number;
  kind: AcousticEventKind;
  bowAnswer: BowAnswer;
  source: "simple" | "advanced";
};
export function simpleReview(
  event: AcousticEvent,
  previous: ArticulationReview | undefined,
  answer: BowAnswer,
  duration: number,
): ArticulationReview {
  const time = previous?.time ?? event.time;
  if (!Number.isFinite(time) || time < 0 || time > duration)
    throw new Error("Choose a time within this recording.");
  return {
    eventId: event.id,
    time,
    source: "simple",
    bowAnswer: answer,
    status:
      answer === "yes" ? "confirmed" : answer === "no" ? "not-bow" : "unsure",
    kind: answer === "yes" ? "candidate-bow-reversal" : "uncertain",
  };
}
export function advancedReview(review: EventReview): ArticulationReview {
  const accepted =
    review.status === "confirmed" || review.status === "adjusted";
  return {
    ...review,
    source: "advanced",
    bowAnswer:
      accepted && review.kind === "candidate-bow-reversal"
        ? "yes"
        : accepted && review.kind !== "uncertain"
          ? "no"
          : review.status === "rejected" &&
              review.kind === "candidate-bow-reversal"
            ? "no"
            : "unsure",
  };
}
export function isAcceptedReview(review: ArticulationReview) {
  return review.status === "confirmed" || review.status === "adjusted";
}
