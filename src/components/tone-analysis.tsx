"use client";

import { useMemo, useState } from "react";
import { Download, Waves, X } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStudio } from "./studio-provider";
import { usePracticeAnalysis } from "./practice-analysis-provider";
import {
  advancedReview,
  isAcceptedReview,
  type ArticulationReview,
} from "@/lib/articulation-review";
import {
  intervalObservations,
  reviewEvent,
  summariseInterval,
  type AcousticEvent,
  type AcousticEventKind,
  type EventReview,
  type IntervalSummary,
  type ToneFrame,
} from "@/lib/tone";
import { formatTime, trackTitle } from "@/lib/audio";

const WINDOW = 20;
const PAGE_SIZE = 8;
const eventNames: Record<AcousticEventKind, string> = {
  "candidate-bow-reversal": "Candidate bow reversal",
  "note-change": "Note change",
  "other-transient": "Other acoustic transient",
  uncertain: "Uncertain event",
};
function timeLabel(time: number) {
  return `${formatTime(time)}.${Math.floor((time % 1) * 100)
    .toString()
    .padStart(2, "0")}`;
}
function value(value: number | null, unit: string, digits = 1) {
  return value === null ? "Unavailable" : `${value.toFixed(digits)} ${unit}`;
}

function ToneTooltip({
  active,
  payload,
  advanced = false,
}: {
  advanced?: boolean;
  active?: boolean;
  payload?: readonly { payload?: ToneFrame }[];
}) {
  const frame = payload?.[0]?.payload;
  return active && frame ? (
    <div className="pitch-tooltip">
      <strong>{timeLabel(frame.time)}</strong> ·{" "}
      {frame.note ?? "Pitch uncertain"}
      <br />
      {value(frame.dbfs, "dBFS")} · {value(frame.centroid, "Hz centroid")}
      {advanced && (
        <>
          <br />
          Flatness {value(frame.flatness, "", 3)} · flux{" "}
          {value(frame.flux, "", 3)}
        </>
      )}
    </div>
  ) : null;
}

function Summary({
  summary,
  label,
}: {
  summary: IntervalSummary;
  label: string;
}) {
  return (
    <div className="tone-summary">
      <h4>
        {label}: {timeLabel(summary.start)}–{timeLabel(summary.end)}
      </h4>
      <p>
        {summary.note
          ? `Stable detected ${summary.note}`
          : "Mixed / uncertain pitch"}{" "}
        · {(summary.pitchCoverage * 100).toFixed(0)}% pitch coverage ·{" "}
        {(summary.activeCoverage * 100).toFixed(0)}% above level floor
      </p>
      <dl className="pitch-diagnostic-values">
        <div>
          <dt>Energy-averaged level</dt>
          <dd>{value(summary.meanDbfs, "dBFS")}</dd>
        </div>
        <div>
          <dt>Level standard deviation</dt>
          <dd>{value(summary.levelStdDb, "dB", 2)}</dd>
        </div>
        <div>
          <dt>Mean brightness / spread</dt>
          <dd>
            {value(summary.centroidHz, "Hz", 0)} /{" "}
            {value(summary.centroidStdHz, "Hz SD", 0)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function EventEditor({
  event,
  review,
  duration,
  seek,
  save,
  reset,
}: {
  event: AcousticEvent;
  review?: ArticulationReview;
  duration: number;
  seek: (time: number) => void;
  save: (review: ArticulationReview) => void;
  reset: () => void;
}) {
  const [time, setTime] = useState(
    String(review?.time ?? Number(event.time.toFixed(3))),
  );
  const [kind, setKind] = useState<AcousticEventKind>(
    review?.kind ?? event.kind,
  );
  const [error, setError] = useState("");
  const update = (status: EventReview["status"]) => {
    try {
      if (status === "adjusted" && !time.trim())
        throw new Error("Enter a time in seconds.");
      save(
        advancedReview(
          reviewEvent(
            event,
            status,
            status === "adjusted" ? Number(time) : event.time,
            status === "adjusted" ? kind : event.kind,
            duration,
          ),
        ),
      );
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Review could not be saved.",
      );
    }
  };
  return (
    <li className="tone-event">
      <div className="tone-event-heading">
        <button
          className="button secondary"
          onClick={() => seek(event.time)}
          aria-label={`Seek to proposed event at ${timeLabel(event.time)}`}
        >
          {timeLabel(event.time)}
        </button>
        <div>
          <strong>{eventNames[event.kind]}</strong>
          <small>{event.strength} · uncalibrated evidence</small>
        </div>
        <span className="outline-badge">
          {review
            ? `Your review: ${review.status} · bow change: ${review.bowAnswer}`
            : "Unreviewed"}
        </span>
      </div>
      <ul>
        {event.evidence.map((evidence) => (
          <li key={evidence}>{evidence}</li>
        ))}
      </ul>
      <div className="tone-actions">
        <button
          className="button secondary"
          onClick={() => update("confirmed")}
        >
          Confirm suggestion
        </button>
        <button className="button secondary" onClick={() => update("rejected")}>
          Reject
        </button>
        {review && (
          <button className="button secondary" onClick={reset}>
            Clear review
          </button>
        )}
      </div>
      <details>
        <summary>Adjust timestamp or interpretation</summary>
        <div className="tone-actions">
          <label>
            Time (seconds)
            <input
              type="number"
              min={0}
              max={duration}
              step={0.01}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <label>
            Your interpretation
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AcousticEventKind)}
            >
              {Object.entries(eventNames).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            onClick={() => update("adjusted")}
          >
            Save adjustment
          </button>
          {review?.status === "adjusted" && (
            <button
              className="button secondary"
              onClick={() => seek(review.time)}
            >
              Listen at {timeLabel(review.time)}
            </button>
          )}
        </div>
      </details>
      {error && (
        <p className="pitch-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function ToneAnalysis({ advanced = false }: { advanced?: boolean }) {
  const shared = usePracticeAnalysis();
  return <ToneSession key={shared.revision} advanced={advanced} />;
}
function ToneSession({ advanced }: { advanced: boolean }) {
  const { seek, position, duration: playbackDuration } = useStudio();
  const shared = usePracticeAnalysis();
  const {
    recording,
    status,
    progress,
    error,
    busy,
    interval,
    setInterval,
    reviews,
    setReviews,
    windowStart,
    setWindowStart,
    exportReview,
  } = shared;
  const result = shared.result?.tone ?? null;
  const run = () => shared.run(!!result);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [page, setPage] = useState(0);
  const prefix = advanced ? "advanced-" : "";
  const comparison = useMemo(
    () =>
      result && shared.comparison
        ? summariseInterval(
            result.frames,
            shared.comparison.start,
            shared.comparison.end,
          )
        : null,
    [result, shared.comparison],
  );
  const setComparison = (summary: IntervalSummary | null) =>
    shared.setComparison(
      summary ? { start: summary.start, end: summary.end } : null,
    );
  const windowEnd = Math.min(result?.duration ?? WINDOW, windowStart + WINDOW);
  const data = useMemo(
    () =>
      result?.frames.filter(
        (f) => f.time >= windowStart && f.time <= windowEnd,
      ) ?? [],
    [result, windowStart, windowEnd],
  );
  const summary = useMemo(
    () =>
      result
        ? summariseInterval(result.frames, interval.start, interval.end)
        : null,
    [result, interval],
  );
  const observations = useMemo(
    () =>
      result && summary ? intervalObservations(summary, result.events) : [],
    [result, summary],
  );
  const selected = result?.frames[selectedIndex];
  const inspect = (index: number, alsoSeek = false) => {
    if (!result) return;
    const bounded = Math.max(0, Math.min(result.frames.length - 1, index));
    const frame = result.frames[bounded];
    if (!frame) return;
    setSelectedIndex(bounded);
    if (frame.time < windowStart || frame.time > windowEnd)
      setWindowStart(
        Math.max(
          0,
          Math.min(result.duration - WINDOW, frame.time - WINDOW / 2),
        ),
      );
    if (alsoSeek && playbackDuration > 0) seek(frame.time);
  };
  const choosePassage = (index: string) => {
    const passage = result?.passages[Number(index)];
    if (!passage) return;
    setInterval({ start: passage.start, end: passage.end });
    setWindowStart(
      Math.max(0, Math.min(result!.duration - WINDOW, passage.start - 1)),
    );
  };
  const charts = [
    {
      title: "Dynamic contour",
      explanation: "RMS level · dBFS, not sound pressure or perceived loudness",
      keys: ["dbfs"],
      names: ["Level (dBFS)"],
      domain: ["auto", "auto"] as [string, string],
    },
    {
      title: "Spectral brightness",
      explanation: "Magnitude-weighted centroid · Hz · 50–8,000 Hz band",
      keys: ["centroid"],
      names: ["Centroid (Hz)"],
      domain: [0, "auto"] as [number, string],
    },
    {
      title: "Noise-related & change indicators",
      explanation:
        "Flatness, flux and pitch harmonic support · 0–1 · none is a quality score",
      keys: ["flatness", "flux", "harmonicSupport"],
      names: ["Flatness", "Flux", "Harmonic support"],
      domain: [0, 1] as [number, number],
    },
    {
      title: "Level stability over time",
      explanation:
        "Standard deviation in a centred 0.5 s window · dB · gaps below floor",
      keys: ["levelSpread"],
      names: ["Level standard deviation (dB)"],
      domain: [0, "auto"] as [number, string],
    },
  ];
  return (
    <section
      className="panel intonation-panel tone-panel"
      id={`${prefix}tone-analysis`}
      aria-labelledby={`${prefix}tone-title`}
    >
      <div className="intonation-heading">
        <div>
          <span className="eyebrow">
            <Waves size={16} /> LOCAL ACOUSTIC MEASUREMENTS
          </span>
          <h2 id={`${prefix}tone-title`}>
            {advanced
              ? "Tone & articulation diagnostics"
              : "Explore your tone & articulation"}
          </h2>
          <p>
            {recording
              ? trackTitle(recording.name)
              : "Record or load cello audio to begin."}
          </p>
        </div>
        {busy ? (
          <button
            className="button secondary"
            onClick={() => {
              shared.cancel();
            }}
          >
            <X size={16} />
            Cancel tone analysis
          </button>
        ) : (
          <button
            className="button primary"
            disabled={!recording || recording.instrument !== "cello"}
            onClick={() => void run()}
          >
            <Waves size={16} />
            {result ? "Analyse Tone again" : "Analyse Tone"}
          </button>
        )}
      </div>
      <p className="pitch-explanation">
        Measured sound features and exploratory articulation candidates. These
        cannot measure bow direction, pressure, speed or location. A smooth bow
        reversal may leave no detectable event.
      </p>
      {!result && !busy && (
        <p className="pitch-notice">
          No tone measurements yet. Analyse a recording to see calculated
          results. Choose a practice goal above to explore supported
          observations.
        </p>
      )}
      {recording?.instrument === "violin" && (
        <p className="pitch-notice">
          Tone and articulation analysis is currently validated only with cello
          development material. Violin playback and storage remain available.
        </p>
      )}
      {busy && (
        <div className="pitch-progress">
          <p role="status">
            {status === "decoding"
              ? "Decoding audio locally…"
              : `Measuring pitch context and acoustic features… ${progress}%`}
          </p>
          <progress
            aria-label="Tone analysis progress"
            max={100}
            {...(status === "analysing" ? { value: progress } : {})}
          />
        </div>
      )}
      {status === "cancelled" && (
        <p role="status" className="pitch-notice">
          Tone analysis cancelled. Your recording is unchanged.
        </p>
      )}
      {error && (
        <p role="alert" className="pitch-error">
          {error}
        </p>
      )}
      {result && (
        <>
          {advanced && (
            <div className="pitch-stats" role="status">
              <span>
                <strong>{result.events.length}</strong> acoustic candidates, not
                a stroke count
              </span>
              <span>
                {result.frames.length.toLocaleString()} measured frames
              </span>
              <span>{Object.values(reviews).length} manually reviewed</span>
            </div>
          )}
          {result.frames.length === 0 ||
          !result.frames.some((f) => f.active) ? (
            <p className="pitch-notice">
              Insufficient sound above the −50.5 dBFS analysis floor. No tone or
              bow conclusions can be drawn.
            </p>
          ) : null}
          {advanced && (
            <p className="pitch-notice">
              Decoded peak: {result.clipping.peak.toFixed(4)} full scale.{" "}
              {result.clipping.nearFullScaleSamples.toLocaleString()}{" "}
              near-full-scale channel samples; longest run{" "}
              {result.clipping.longestRun}.{" "}
              {result.clipping.longestRun >= 3
                ? "Possible digital clipping: consecutive samples reach the digital rail. Check the original waveform and recording gain."
                : "No sustained near-rail run detected. This does not rule out earlier clipping or limiting."}
            </p>
          )}
          {result.frames.length > 0 && (
            <>
              <div className="pitch-window">
                <label htmlFor={`${prefix}tone-window`}>
                  Graph window: {timeLabel(windowStart)}–{timeLabel(windowEnd)}
                </label>
                <input
                  id={`${prefix}tone-window`}
                  type="range"
                  min={0}
                  max={Math.max(0, result.duration - WINDOW)}
                  step={0.1}
                  disabled={result.duration <= WINDOW}
                  value={windowStart}
                  onChange={(e) => setWindowStart(Number(e.target.value))}
                />
              </div>
              <p className="tone-legend">
                Teal: primary measurement · peach: flux · purple: harmonic
                support / playhead. Dashed event markers are algorithm
                suggestions; solid teal markers are your accepted or adjusted
                boundaries. Shading marks your selected interval.
              </p>
              <div className="pitch-chart-grid">
                {charts.map(
                  (chart, chartIndex) =>
                    (advanced ? chartIndex === 2 : chartIndex !== 2) && (
                      <div className="pitch-chart-panel" key={chart.title}>
                        <h3>{chart.title}</h3>
                        <p>{chart.explanation}</p>
                        <div
                          className="pitch-chart"
                          role="group"
                          aria-label={`${chart.title}. Exact values are available in the timestamp inspector.`}
                        >
                          <ResponsiveContainer
                            width="100%"
                            height={230}
                            minWidth={0}
                          >
                            <LineChart
                              data={data}
                              accessibilityLayer
                              margin={{
                                top: 12,
                                right: 14,
                                bottom: 6,
                                left: 0,
                              }}
                              onClick={(state) => {
                                const frame =
                                  state.activeTooltipIndex != null
                                    ? data[Number(state.activeTooltipIndex)]
                                    : null;
                                if (frame)
                                  inspect(
                                    Math.round(
                                      (frame.time * 22050 - 1024) / 256,
                                    ),
                                    true,
                                  );
                              }}
                            >
                              <CartesianGrid
                                stroke="#30434c"
                                strokeDasharray="3 4"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="time"
                                type="number"
                                domain={[windowStart, windowEnd]}
                                tickFormatter={formatTime}
                                stroke="#acb9c0"
                                tick={{ fontSize: 11 }}
                                minTickGap={30}
                              />
                              <YAxis
                                width={52}
                                domain={chart.domain}
                                stroke="#acb9c0"
                                tick={{ fontSize: 11 }}
                                tickFormatter={(n: number) =>
                                  Math.abs(n) >= 1000
                                    ? `${(n / 1000).toFixed(1)}k`
                                    : `${Number(n.toFixed(2))}`
                                }
                              />
                              <Tooltip
                                content={<ToneTooltip advanced={advanced} />}
                              />
                              {shared.highlight?.graph === "tone" &&
                                shared.highlight.interval.end >= windowStart &&
                                shared.highlight.interval.start <=
                                  windowEnd && (
                                  <ReferenceArea
                                    x1={Math.max(
                                      windowStart,
                                      shared.highlight.interval.start,
                                    )}
                                    x2={Math.min(
                                      windowEnd,
                                      shared.highlight.interval.end,
                                    )}
                                    fill="#edc49a"
                                    fillOpacity={0.16}
                                  />
                                )}
                              {interval.end >= windowStart &&
                                interval.start <= windowEnd && (
                                  <ReferenceArea
                                    x1={Math.max(interval.start, windowStart)}
                                    x2={Math.min(interval.end, windowEnd)}
                                    fill="#8dd4be"
                                    fillOpacity={0.06}
                                  />
                                )}
                              {chartIndex === 0 &&
                                result.events
                                  .filter(
                                    (e) =>
                                      e.time >= windowStart &&
                                      e.time <= windowEnd,
                                  )
                                  .map((e) => (
                                    <ReferenceLine
                                      key={e.id}
                                      x={e.time}
                                      stroke={
                                        reviews[e.id]?.status === "rejected"
                                          ? "#657078"
                                          : "#edc49a"
                                      }
                                      strokeDasharray="2 4"
                                    />
                                  ))}
                              {chartIndex === 0 &&
                                Object.values(reviews)
                                  .filter(
                                    (r) =>
                                      isAcceptedReview(r) &&
                                      r.time >= windowStart &&
                                      r.time <= windowEnd,
                                  )
                                  .map((r) => (
                                    <ReferenceLine
                                      key={`manual-${r.eventId}`}
                                      x={r.time}
                                      stroke="#8dd4be"
                                    />
                                  ))}
                              {position >= windowStart &&
                                position <= windowEnd && (
                                  <ReferenceLine
                                    x={position}
                                    stroke="#c4b9df"
                                  />
                                )}
                              {chart.keys.map((key, i) => (
                                <Line
                                  key={key}
                                  dataKey={key}
                                  name={chart.names[i]}
                                  stroke={["#8dd4be", "#edc49a", "#b5a2d5"][i]}
                                  dot={false}
                                  connectNulls={false}
                                  isAnimationActive={false}
                                  strokeWidth={1.5}
                                />
                              ))}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ),
                )}
              </div>
              {selected && (
                <div className="pitch-inspector">
                  <label htmlFor={`${prefix}tone-inspector`}>
                    Inspect timestamp · {timeLabel(selected.time)}
                  </label>
                  <input
                    id={`${prefix}tone-inspector`}
                    type="range"
                    min={0}
                    max={result.frames.length - 1}
                    step={1}
                    value={selectedIndex}
                    onChange={(e) => inspect(Number(e.target.value))}
                  />
                  <div className="pitch-reading">
                    <span>
                      {selected.note ?? "Pitch uncertain"} ·{" "}
                      {value(selected.rms, "RMS", 5)} ·{" "}
                      {value(selected.dbfs, "dBFS")} ·{" "}
                      {value(selected.centroid, "Hz centroid", 0)}{" "}
                      {advanced && (
                        <>
                          {" "}
                          · flatness {value(selected.flatness, "", 3)} · flux{" "}
                          {value(selected.flux, "", 3)} · harmonic support{" "}
                          {value(selected.harmonicSupport, "", 3)} · periodicity{" "}
                          {value(selected.periodicity, "", 3)}
                        </>
                      )}{" "}
                      · brightness SD{" "}
                      {value(selected.brightnessSpread, "Hz", 0)}
                      {!selected.active ? " · below analysis floor" : ""}
                    </span>
                    <button
                      className="button secondary"
                      disabled={!playbackDuration}
                      onClick={() => seek(selected.time)}
                    >
                      Seek to timestamp
                    </button>
                  </div>
                </div>
              )}
              {!advanced && (
                <div className="tone-interval">
                  <h3>Select & compare passages</h3>
                  <p>
                    Select a detected sustained note or enter interval times.
                    Summaries exclude frames below the level floor; coverage is
                    shown. Compare the same note with unchanged microphone and
                    recording settings.
                  </p>
                  <div className="tone-actions">
                    <label>
                      Detected sustained passage
                      <select
                        value=""
                        onChange={(e) => choosePassage(e.target.value)}
                      >
                        <option value="">Choose a passage…</option>
                        {result.passages.map((p, i) => (
                          <option value={i} key={i}>
                            {p.note} · {timeLabel(p.start)}–{timeLabel(p.end)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Start (seconds)
                      <input
                        type="number"
                        min={0}
                        max={interval.end - 0.01}
                        step={0.01}
                        value={Number(interval.start.toFixed(3))}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n))
                            setInterval({
                              ...interval,
                              start: Math.max(
                                0,
                                Math.min(interval.end - 0.01, n),
                              ),
                            });
                        }}
                      />
                    </label>
                    <label>
                      End (seconds)
                      <input
                        type="number"
                        min={interval.start + 0.01}
                        max={result.duration}
                        step={0.01}
                        value={Number(interval.end.toFixed(3))}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n))
                            setInterval({
                              ...interval,
                              end: Math.min(
                                result.duration,
                                Math.max(interval.start + 0.01, n),
                              ),
                            });
                        }}
                      />
                    </label>
                    <button
                      className="button secondary"
                      disabled={!playbackDuration}
                      onClick={() => seek(interval.start)}
                    >
                      Listen from start
                    </button>
                  </div>
                  {summary && (
                    <>
                      <Summary summary={summary} label="Current selection" />
                      <div className="tone-actions">
                        <button
                          className="button secondary"
                          disabled={!summary.note}
                          onClick={() => setComparison(summary)}
                        >
                          Keep as comparison
                        </button>
                        {comparison && (
                          <button
                            className="button secondary"
                            onClick={() => setComparison(null)}
                          >
                            Clear comparison
                          </button>
                        )}
                      </div>
                      {comparison && (
                        <>
                          <Summary
                            summary={comparison}
                            label="Kept comparison"
                          />
                          <p className="pitch-notice">
                            {summary.note &&
                            summary.note === comparison.note &&
                            summary.meanDbfs !== null &&
                            comparison.meanDbfs !== null &&
                            summary.centroidHz !== null &&
                            comparison.centroidHz !== null
                              ? `Both selections contain stable detected ${summary.note}. Current minus kept: ${(summary.meanDbfs - comparison.meanDbfs).toFixed(2)} dB recorded level; ${(summary.centroidHz - comparison.centroidHz).toFixed(0)} Hz brightness. Differences describe acoustics, not better or worse technique.`
                              : "Choose another stable passage of the same detected note for a meaningful same-note comparison."}
                          </p>
                        </>
                      )}
                    </>
                  )}
                  <div className="pitch-observations">
                    <h3>Measured observations for this interval</h3>
                    {observations.length ? (
                      <ul>
                        {observations.map((text) => (
                          <li key={text}>{text}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        No observation meets the evidence thresholds in this
                        selection.
                      </p>
                    )}
                    <p>
                      Practice investigation: listen to two passages of the same
                      note with a fixed microphone position. Explore whether a
                      measured change is audible. Room sound, gain changes and
                      playing changes are possible explanations, not diagnoses.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
          {advanced && (
            <div className="tone-review">
              <div className="intonation-heading">
                <div>
                  <h3>Review articulation candidates</h3>
                  <p>
                    Confirm only what you can hear or independently identify. An
                    acoustic event does not establish a bow reversal. Reviews
                    stay separate and last for this analysis only; export before
                    switching recordings, reanalysing or leaving.
                  </p>
                </div>
                <button className="button secondary" onClick={exportReview}>
                  <Download size={16} />
                  Export review JSON
                </button>
              </div>
              <p>
                {Object.entries(eventNames)
                  .map(
                    ([kind, label]) =>
                      `${label}: ${result.events.filter((e) => e.kind === kind).length}`,
                  )
                  .join(" · ")}
              </p>
              {result.events.length ? (
                <>
                  <ol className="tone-events" start={page * PAGE_SIZE + 1}>
                    {result.events
                      .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                      .map((event) => (
                        <EventEditor
                          key={`${event.id}-${reviews[event.id]?.status}-${reviews[event.id]?.time}-${reviews[event.id]?.kind}`}
                          event={event}
                          review={reviews[event.id]}
                          duration={result.duration}
                          seek={seek}
                          save={(review) =>
                            setReviews((previous) => ({
                              ...previous,
                              [event.id]: review,
                            }))
                          }
                          reset={() =>
                            setReviews((previous) => {
                              const next = { ...previous };
                              delete next[event.id];
                              return next;
                            })
                          }
                        />
                      ))}
                  </ol>
                  <div className="tone-actions">
                    <button
                      className="button secondary"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous candidates
                    </button>
                    <span role="status">
                      Page {page + 1} of{" "}
                      {Math.ceil(result.events.length / PAGE_SIZE)}
                    </span>
                    <button
                      className="button secondary"
                      disabled={(page + 1) * PAGE_SIZE >= result.events.length}
                      onClick={() => setPage(page + 1)}
                    >
                      Next candidates
                    </button>
                  </div>
                </>
              ) : (
                <p className="pitch-notice">
                  No candidate met the acoustic evidence thresholds. This does
                  not mean no bow reversals occurred.
                </p>
              )}
            </div>
          )}
        </>
      )}
      {advanced && (
        <details className="pitch-method">
          <summary>Tone analysis method, units & limits</summary>
          <p>
            Local processing only. One shared worker reuses the unchanged
            harmonic-aware pitch estimator for both graphs and mentor context.
            Tone windows are 46.4 ms for DC-removed RMS and 92.9 ms for the
            Hann-windowed spectrum, every 11.6 ms at 22,050 Hz. Timestamps mark
            window centres; windows overlap and are not independent. Audio under
            −50.5 dBFS has no spectral or event interpretation. Full-scale RMS
            is 0 dBFS (a peak-full-scale sine is about −3 dBFS); the graph
            floors silence at −120 dBFS.
          </p>
          <p>
            Brightness is the magnitude-weighted centroid from 50–8,000 Hz.
            Flatness is geometric/arithmetical mean spectral power in that band:
            noise-like sound often has higher values, but it is not a noise
            percentage. Flux measures positive changes between magnitude spectra
            normalised to sum to one. Harmonic support is the pitch estimator’s
            explained peak-amplitude share below 3 kHz, available only with a
            usable pitch. These indicators are not HNR, SNR, or a good/bad tone
            score.
          </p>
          <p>
            Candidate events combine local energy dips, steps or peaks, spectral
            flux and structural changes. Before/after pitch context
            distinguishes possible note changes from same-pitch dips; missing
            pitch alone never generates an event. Evidence strengths are
            uncalibrated rules. Candidate bow reversals remain hypotheses;
            smooth reversals may be missed, and taps, noise, articulation and
            gain changes may look similar. Events less than 250 ms apart may
            merge.
          </p>
          <p>
            Clipping checks count decoded channel samples with magnitude at
            least 0.999 before mono mixing. Consecutive near-rail samples
            suggest possible digital clipping, but AAC decoding and resampling
            can create overshoots or conceal clipped peaks. Earlier distortion
            or limiting may be invisible.
          </p>
          <p>
            Microphone distance and direction, room reflections, background
            noise, automatic gain control, compression and register affect every
            comparison. Relative dBFS is not calibrated sound intensity or
            perceived loudness. Measurements do not establish bow technique.
            Single cello notes are the development scope; chords, accompaniment
            and other instruments are unvalidated. Ten-minute / 100 MB limits
            apply, and large decoded files may exceed browser memory. Original
            recordings and stored playlists are unchanged.
          </p>
        </details>
      )}
    </section>
  );
}
