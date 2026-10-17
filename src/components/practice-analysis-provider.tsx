"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Recording } from "@/lib/storage";
import { PracticeAnalysisSession } from "@/lib/practice-session";
import {
  generatePracticeFeedback,
  type PracticeGoal,
  type TimeInterval,
  type FeedbackFinding,
  type FeedbackOutput,
} from "@/lib/practice-feedback";
import {
  createFeedbackClient,
  type FeedbackClient,
} from "@/lib/practice-feedback-client";
import { feedbackExport } from "@/lib/feedback-export";
import type { ArticulationReview } from "@/lib/articulation-review";

function useSession(
  recording: Recording | null,
  providedSession?: PracticeAnalysisSession,
  feedbackFactory: typeof createFeedbackClient = createFeedbackClient,
) {
  const [session] = useState(
    () =>
      providedSession ?? new PracticeAnalysisSession(recording?.id ?? "empty"),
  );
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const [goal, setGoal] = useState<PracticeGoal>("dynamics");
  const [interval, setInterval] = useState<TimeInterval>({ start: 0, end: 1 });
  const [comparison, setComparison] = useState<TimeInterval | null>(null);
  const [reviews, setReviews] = useState<Record<string, ArticulationReview>>(
    {},
  );
  const [ratings, setRatings] = useState<
    Record<string, "useful" | "not-useful">
  >({});
  const [investigations, setInvestigations] = useState<Record<string, number>>(
    {},
  );
  const [recordingConditions, setRecordingConditions] = useState<
    "unknown" | "consistent"
  >("unknown");
  const [highlight, setHighlight] = useState<{
    interval: TimeInterval;
    graph: "pitch" | "tone";
    serial: number;
  } | null>(null);
  const [windowStart, setWindowStart] = useState(0);
  useEffect(() => {
    window.addEventListener("pagehide", session.cancel);
    return () => {
      session.cancel();
      window.removeEventListener("pagehide", session.cancel);
    };
  }, [session]);
  const run = async (force = false) => {
    if (!recording || recording.instrument !== "cello") return;
    const before = session.getSnapshot();
    if (before.status === "decoding" || before.status === "analysing") return;
    if (before.result && !force) return;
    setReviews({});
    setRatings({});
    setInvestigations({});
    setComparison(null);
    setHighlight(null);
    setWindowStart(0);
    await session.run(recording.file, force);
    const result = session.getSnapshot().result;
    if (result) setInterval({ start: 0, end: result.tone.duration });
  };
  const request = useMemo(
    () => ({
      recordingId: recording?.id ?? "empty",
      goal,
      interval,
      comparison,
      reviews,
      recordingConditions,
    }),
    [recording?.id, goal, interval, comparison, reviews, recordingConditions],
  );
  const [feedbackEpoch, setFeedbackEpoch] = useState(0);
  const feedbackKey = `${state.revision}:${feedbackEpoch}:${JSON.stringify(request)}`;
  const [response, setResponse] = useState<{
    key: string;
    output: FeedbackOutput | null;
    error: string;
  } | null>(null);
  const feedbackSlot = useRef<{ client: FeedbackClient | null; error: string }>(
    { client: null, error: "" },
  );
  useEffect(() => {
    if (!state.result) return;
    let client: FeedbackClient | null = null;
    try {
      client = feedbackFactory(state.result);
      feedbackSlot.current = { client, error: "" };
    } catch (error) {
      feedbackSlot.current = {
        client: null,
        error:
          error instanceof Error
            ? error.message
            : "Feedback could not start. Reanalyse or try a current browser.",
      };
    }
    const pause = () => client?.dispose();
    const resume = (event: PageTransitionEvent) => {
      if (event.persisted) setFeedbackEpoch((epoch) => epoch + 1);
    };
    window.addEventListener("pagehide", pause);
    window.addEventListener("pageshow", resume);
    return () => {
      client?.dispose();
      feedbackSlot.current = { client: null, error: "" };
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("pageshow", resume);
    };
  }, [state.result, feedbackFactory, feedbackEpoch]);
  useEffect(() => {
    if (!state.result) return;
    let active = true;
    const slot = feedbackSlot.current;
    void Promise.resolve()
      .then(() => {
        if (!slot.client)
          throw new Error(
            slot.error || "Feedback is unavailable. Reanalyse to try again.",
          );
        return slot.client.request(request);
      })
      .then(
        (output) => {
          if (active) setResponse({ key: feedbackKey, output, error: "" });
        },
        (error) => {
          if (active)
            setResponse({
              key: feedbackKey,
              output: null,
              error:
                error instanceof Error
                  ? error.message
                  : "Feedback generation failed.",
            });
        },
      );
    return () => {
      active = false;
    };
  }, [state.result, request, feedbackKey]);
  const feedbackBusy = !!state.result && response?.key !== feedbackKey;
  const feedbackError = response?.key === feedbackKey ? response.error : "";
  const feedback =
    response?.key === feedbackKey && response.output
      ? response.output
      : generatePracticeFeedback({ ...request, analysis: null });
  const focusFinding = (
    finding: FeedbackFinding,
    target = finding.interval,
  ) => {
    setHighlight((previous) => ({
      interval: target,
      graph: finding.graph,
      serial: (previous?.serial ?? 0) + 1,
    }));
    setWindowStart(
      Math.max(
        0,
        Math.min((state.result?.tone.duration ?? 20) - 20, target.start - 1),
      ),
    );
    const section = document.getElementById(`explore-${finding.graph}`);
    section?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
    section?.focus({ preventScroll: true });
  };
  const exportReview = () => {
    if (!recording || !state.result) return;
    const payload = feedbackExport(
      recording,
      state.result,
      feedback,
      reviews,
      interval,
      ratings,
      investigations,
    );
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...payload,
            feedback: feedbackBusy || feedbackError ? null : payload.feedback,
            feedbackStatus: feedbackBusy
              ? "pending"
              : feedbackError || "complete",
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "stringmentor-practice-review.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return {
    ...state,
    recording,
    busy: state.status === "decoding" || state.status === "analysing",
    run,
    cancel: session.cancel,
    goal,
    setGoal,
    interval,
    setInterval,
    comparison,
    setComparison,
    reviews,
    setReviews,
    ratings,
    setRatings,
    investigations,
    setInvestigations,
    recordingConditions,
    setRecordingConditions,
    feedback,
    feedbackBusy,
    feedbackError,
    highlight,
    focusFinding,
    windowStart,
    setWindowStart,
    exportReview,
  };
}
type SharedAnalysis = ReturnType<typeof useSession>;
const Context = createContext<SharedAnalysis | null>(null);
export function PracticeAnalysisProvider({
  recording,
  children,
  session,
  feedbackFactory,
}: {
  recording: Recording | null;
  children: ReactNode;
  session?: PracticeAnalysisSession;
  feedbackFactory?: typeof createFeedbackClient;
}) {
  const value = useSession(recording, session, feedbackFactory);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePracticeAnalysis() {
  const value = useContext(Context);
  if (!value)
    throw new Error(
      "Practice analysis requires its recording-scoped provider.",
    );
  return value;
}
