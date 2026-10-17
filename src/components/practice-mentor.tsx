"use client";
import {
  Download,
  Headphones,
  Lightbulb,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { usePracticeAnalysis } from "./practice-analysis-provider";
import { useStudio } from "./studio-provider";
import {
  EXERCISES,
  FEEDBACK_RULES,
  PRACTICE_GOALS,
  type FeedbackFinding,
  type PracticeGoal,
  type TimeInterval,
} from "@/lib/practice-feedback";
import { simpleReview, type BowAnswer } from "@/lib/articulation-review";
import { formatTime, trackTitle } from "@/lib/audio";

function timestamp(time: number) {
  return `${formatTime(time)}.${Math.floor((time % 1) * 100)
    .toString()
    .padStart(2, "0")}`;
}
function FindingCard({ finding }: { finding: FeedbackFinding }) {
  const shared = usePracticeAnalysis();
  const studio = useStudio();
  const event = finding.eventId
    ? shared.result?.tone.events.find((event) => event.id === finding.eventId)
    : undefined;
  const review = event ? shared.reviews[event.id] : undefined;
  const exercises = EXERCISES[finding.investigation];
  const exerciseIndex =
    (shared.investigations[finding.id] ?? 0) % exercises.length;
  const exercise = exercises[exerciseIndex];
  const rating = shared.ratings[finding.id];
  const listen = (interval: TimeInterval) => {
    studio.seek(interval.start);
    if (!studio.playing) void studio.toggle();
  };
  const answer = (answer: BowAnswer) => {
    if (!event || !shared.result) return;
    shared.setReviews((previous) => ({
      ...previous,
      [event.id]: simpleReview(
        event,
        previous[event.id],
        answer,
        shared.result!.tone.duration,
      ),
    }));
  };
  return (
    <article className="mentor-finding" aria-labelledby={`${finding.id}-title`}>
      <div className="mentor-finding-title">
        <span className="feature-icon">
          <Lightbulb size={19} />
        </span>
        <div>
          <h3 id={`${finding.id}-title`}>{finding.title}</h3>
          <small>
            {timestamp(finding.interval.start)}–
            {timestamp(finding.interval.end)} ·{" "}
            {review?.bowAnswer === "yes"
              ? "Musician identified; acoustic cause unverified"
              : "Measured evidence · interpretation uncertain"}
          </small>
        </div>
      </div>
      <h4>What we noticed</h4>
      <p>{finding.observation}</p>
      <h4>Why it might matter</h4>
      <p>{finding.relevance}</p>
      <h4>Try this</h4>
      <p>{exercise.text}</p>
      <div className="tone-actions">
        <button
          className="button secondary"
          disabled={!studio.duration}
          onClick={() => listen(finding.interval)}
        >
          <Headphones size={16} />
          Listen here · {timestamp(finding.interval.start)}
        </button>
        {finding.relatedIntervals.map((interval, i) => (
          <button
            className="button secondary"
            disabled={!studio.duration}
            key={i}
            onClick={() => listen(interval)}
          >
            Listen to comparison · {timestamp(interval.start)}
          </button>
        ))}
        <button
          className="button secondary"
          onClick={() => shared.focusFinding(finding)}
        >
          Highlight on graph
        </button>
        <button
          className="button secondary"
          onClick={() =>
            shared.setInvestigations((previous) => ({
              ...previous,
              [finding.id]: (exerciseIndex + 1) % exercises.length,
            }))
          }
        >
          Another supported investigation
        </button>
      </div>
      {event && (
        <fieldset className="mentor-review">
          <legend>Did this correspond to a bow change?</legend>
          <p>
            Listen around the original suggestion at {timestamp(event.time)}.
            Your answer records your interpretation; it does not train a model.
          </p>
          <div className="tone-actions">
            {(["yes", "no", "unsure"] as const).map((option) => (
              <button
                className="button secondary"
                aria-pressed={review?.bowAnswer === option}
                key={option}
                onClick={() => answer(option)}
              >
                {option === "yes" ? "Yes" : option === "no" ? "No" : "Not sure"}
              </button>
            ))}
          </div>
          <small role="status">
            {review
              ? `Your answer: ${review.bowAnswer === "unsure" ? "not sure" : review.bowAnswer}. Shared with Advanced Diagnostics.`
              : "Unreviewed — a bow reversal remains a hypothesis."}
          </small>
        </fieldset>
      )}
      <details className="mentor-evidence">
        <summary>View evidence</summary>
        <dl className="pitch-diagnostic-values">
          {finding.measurements.map((m) => (
            <div key={m.label}>
              <dt>{m.label}</dt>
              <dd>
                {m.value.toFixed(m.unit === "0–1" ? 3 : 2)} {m.unit}
              </dd>
            </div>
          ))}
        </dl>
        <h4>Uncertainty & limitations</h4>
        <ul>
          {finding.uncertainty.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <p>
          <strong>Why selected:</strong> {finding.priorityReason} Rule priority{" "}
          {finding.priority} is an ordering value, not a quality or confidence
          score.
        </p>
        <ul>
          {finding.references.map((ref, i) => (
            <li key={i}>
              {ref.module} · {timestamp(ref.interval.start)}–
              {timestamp(ref.interval.end)}
              {ref.eventId ? ` · ${ref.eventId}` : ""}: {ref.detail}
            </li>
          ))}
        </ul>
      </details>
      <div className="mentor-usefulness">
        <span>Was this finding useful?</span>
        <button
          className="button secondary"
          aria-pressed={rating === "useful"}
          onClick={() =>
            shared.setRatings((previous) => ({
              ...previous,
              [finding.id]: "useful",
            }))
          }
        >
          Useful
        </button>
        <button
          className="button secondary"
          aria-pressed={rating === "not-useful"}
          onClick={() =>
            shared.setRatings((previous) => ({
              ...previous,
              [finding.id]: "not-useful",
            }))
          }
        >
          Not useful
        </button>
      </div>
    </article>
  );
}

export function PracticeMentor() {
  const shared = usePracticeAnalysis();
  const duration = shared.result?.tone.duration ?? 0;
  return (
    <section className="panel mentor-panel" aria-labelledby="mentor-title">
      <div className="intonation-heading">
        <div>
          <span className="eyebrow">01 · YOUR PRACTICE MENTOR</span>
          <h2 id="mentor-title">What would you like to explore?</h2>
          <p>
            {shared.recording
              ? trackTitle(shared.recording.name)
              : "Choose or record audio in the player below, then explore a practice goal."}
          </p>
        </div>
        {shared.busy ? (
          <button className="button secondary" onClick={shared.cancel}>
            <X size={16} />
            Cancel analysis
          </button>
        ) : (
          <button
            className="button primary"
            disabled={
              !shared.recording || shared.recording.instrument !== "cello"
            }
            onClick={() => void shared.run(!!shared.result)}
          >
            <SlidersHorizontal size={16} />
            {shared.result ? "Reanalyse recording" : "Analyse for my goal"}
          </button>
        )}
      </div>
      <div className="mentor-controls">
        <label>
          My practice goal
          <select
            value={shared.goal}
            onChange={(e) => shared.setGoal(e.target.value as PracticeGoal)}
          >
            {Object.entries(PRACTICE_GOALS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p>
          Choose what you want to investigate. This does not establish the
          original performer’s intention. Changing goals reuses the measured
          audio.
        </p>
      </div>
      {shared.recording?.instrument === "violin" && (
        <p className="pitch-notice">
          This first mentor uses cello measurements. Violin playback and
          recording remain available, but feedback is not validated for violin.
        </p>
      )}
      {shared.busy && (
        <div className="pitch-progress">
          <p role="status">
            {shared.status === "decoding"
              ? "Decoding locally…"
              : `Measuring your recording locally… ${shared.progress}%`}
          </p>
          <progress
            aria-label="Shared practice analysis progress"
            max={100}
            {...(shared.status === "analysing"
              ? { value: shared.progress }
              : {})}
          />
        </div>
      )}
      {shared.error && (
        <p role="alert" className="pitch-error">
          {shared.error}
        </p>
      )}
      {shared.status === "cancelled" && (
        <p role="status" className="pitch-notice">
          Analysis cancelled. Your original recording is unchanged.
        </p>
      )}
      {!shared.result && !shared.busy && (
        <p className="mentor-empty">
          Your observations will appear here after analysis. No quality grades,
          invented results or external AI service.
        </p>
      )}
      {shared.result && (
        <>
          <div className="tone-actions mentor-interval">
            <label>
              Start (seconds)
              <input
                type="number"
                min={0}
                max={shared.interval.end - 0.01}
                step={0.01}
                value={Number(shared.interval.start.toFixed(3))}
                onChange={(e) => {
                  const n = e.target.valueAsNumber;
                  if (Number.isFinite(n))
                    shared.setInterval({
                      ...shared.interval,
                      start: Math.max(
                        0,
                        Math.min(shared.interval.end - 0.01, n),
                      ),
                    });
                }}
              />
            </label>
            <label>
              End (seconds)
              <input
                type="number"
                min={shared.interval.start + 0.01}
                max={duration}
                step={0.01}
                value={Number(shared.interval.end.toFixed(3))}
                onChange={(e) => {
                  const n = e.target.valueAsNumber;
                  if (Number.isFinite(n))
                    shared.setInterval({
                      ...shared.interval,
                      end: Math.min(
                        duration,
                        Math.max(shared.interval.start + 0.01, n),
                      ),
                    });
                }}
              />
            </label>
            <button
              className="button secondary"
              onClick={() => shared.setInterval({ start: 0, end: duration })}
            >
              Whole recording
            </button>
            <button className="button secondary" onClick={shared.exportReview}>
              <Download size={16} />
              Export feedback & reviews
            </button>
          </div>
          <label className="pitch-raw-toggle">
            <input
              type="checkbox"
              checked={shared.recordingConditions === "consistent"}
              onChange={(e) =>
                shared.setRecordingConditions(
                  e.target.checked ? "consistent" : "unknown",
                )
              }
            />
            I believe the microphone position and recording settings stayed
            consistent.
          </label>
          <p className="mentor-session-note">
            Goals, useful/not-useful responses and event reviews are
            session-only. Export before leaving, switching recordings or
            reanalysing. Responses do not automatically improve a model.
          </p>
          <p className="sr-only" role="status">
            {PRACTICE_GOALS[shared.goal]}: {shared.feedback.findings.length}{" "}
            supported findings.
          </p>
          {shared.feedbackBusy && (
            <p role="status">Preparing supported observations for this goal…</p>
          )}
          {shared.feedbackError && (
            <p role="alert" className="pitch-error">
              {shared.feedbackError}
            </p>
          )}
          {!shared.feedbackBusy &&
            !shared.feedbackError &&
            shared.feedback.insufficient && (
              <div className="pitch-notice">
                <strong>{shared.feedback.insufficient}</strong>
                <p>{shared.feedback.nextEvidence}</p>
              </div>
            )}
          <div className="mentor-findings">
            {shared.feedback.findings.map((finding) => (
              <FindingCard key={finding.id} finding={finding} />
            ))}
          </div>
        </>
      )}
      <p className="mentor-footer">
        A practice-support tool alongside your own listening and instrumental
        teaching. Measured differences are not automatically audible, musically
        relevant, or mistakes.
      </p>
    </section>
  );
}

export function FeedbackDiagnostics() {
  const shared = usePracticeAnalysis();
  return (
    <details className="pitch-method">
      <summary>Feedback rules, evidence gates & session state</summary>
      <p>
        Deterministic rules select at most three findings. Priorities rank
        relevance to your selected goal; they are not quality grades or
        probabilities. Each finding includes its original measurement
        references. Same-note comparisons require comparable detected register
        and adequate signal coverage. No score or verified target note is
        assumed.
      </p>
      <pre className="mentor-rules">
        {JSON.stringify(FEEDBACK_RULES, null, 2)}
      </pre>
      <p>
        Selected goal: {PRACTICE_GOALS[shared.goal]}. Recording conditions:{" "}
        {shared.recordingConditions}. {Object.keys(shared.reviews).length} event
        reviews; {Object.keys(shared.ratings).length} usefulness responses.
        Rules and investigations are not adapted or trained from these
        responses.
      </p>
      <button
        className="button secondary"
        disabled={!shared.result}
        onClick={shared.exportReview}
      >
        Export feedback and annotations JSON
      </button>
    </details>
  );
}
