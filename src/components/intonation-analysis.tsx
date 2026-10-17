"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowUp, Crosshair, X } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStudio } from "./studio-provider";
import { analyseRecording } from "@/lib/analyse-recording";
import {
  CELLO_CONFIG,
  noteName,
  type PitchFrame,
  type PitchResult,
} from "@/lib/pitch";
import { formatTime, trackTitle } from "@/lib/audio";
import type { Recording } from "@/lib/storage";

const WINDOW_SECONDS = 20;
function preciseTime(time: number) {
  return `${formatTime(time)}.${String(Math.floor((time % 1) * 100)).padStart(2, "0")}`;
}
function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}
function Measurement({ frame }: { frame: PitchFrame }) {
  if (frame.frequency === null)
    return (
      <span>
        {preciseTime(frame.time)} · No usable pitch ({frame.rejection}) ·
        clarity {(frame.clarity * 100).toFixed(0)}%
      </span>
    );
  return (
    <span>
      {preciseTime(frame.time)} · <strong>{frame.note}</strong> ·{" "}
      {frame.frequency.toFixed(2)} Hz ·{" "}
      <span className={frame.cents! > 0 ? "pitch-sharp" : "pitch-flat"}>
        {signed(frame.cents!)} cents{" "}
        {frame.cents! > 0
          ? "sharp"
          : frame.cents! < 0
            ? "flat"
            : "on reference"}
      </span>{" "}
      · clarity {(frame.clarity * 100).toFixed(0)}%
    </span>
  );
}
function MeasurementTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: PitchFrame }[];
}) {
  const frame = payload?.[0]?.payload;
  return active && frame ? (
    <div className="pitch-tooltip">
      <Measurement frame={frame} />
    </div>
  ) : null;
}
export function IntonationAnalysis() {
  const { current } = useStudio();
  // A new recording owns a new job and results. Unmount cancels the previous job.
  return <AnalysisSession key={current?.id ?? "empty"} recording={current} />;
}
function AnalysisSession({ recording }: { recording: Recording | null }) {
  const { seek, duration: playbackDuration, position } = useStudio();
  const [result, setResult] = useState<PitchResult | null>(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [windowStart, setWindowStart] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const cancel = () => {
      if (active.current && !active.current.signal.aborted) {
        active.current.abort();
        setStatus("cancelled");
      }
    };
    window.addEventListener("pagehide", cancel);
    return () => {
      active.current?.abort();
      window.removeEventListener("pagehide", cancel);
    };
  }, []);
  const busy = status === "decoding" || status === "analysing";
  async function run() {
    if (!recording || busy) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setError("");
    setResult(null);
    setProgress(0);
    setStatus("decoding");
    try {
      const next = await analyseRecording(
        recording.file,
        controller.signal,
        (value) => {
          if (controller.signal.aborted) return;
          setStatus("analysing");
          setProgress(Math.round(value * 100));
        },
      );
      if (controller.signal.aborted) return;
      setResult(next);
      setSelectedIndex(0);
      setWindowStart(0);
      setStatus("complete");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Analysis failed. Please try another recording.",
      );
      setStatus("error");
    } finally {
      if (active.current === controller) active.current = null;
    }
  }
  function cancel() {
    active.current?.abort();
    setStatus("cancelled");
  }
  const frames = result?.frames ?? [];
  const selected = frames[selectedIndex];
  const windowEnd = Math.min(
    result?.duration ?? WINDOW_SECONDS,
    windowStart + WINDOW_SECONDS,
  );
  const data = frames
    .filter((f) => f.time >= windowStart && f.time <= windowEnd)
    .map((frame, index, visible) => ({
      ...frame,
      // Do not draw across semitone-reference changes: cents wraps at ±50.
      graphCents:
        index > 0 && frame.note !== visible[index - 1].note
          ? null
          : frame.cents,
    }));
  const visibleMidi = data.flatMap((f) => (f.midi === null ? [] : [f.midi]));
  const pitchDomain = visibleMidi.length
    ? [
        Math.floor(Math.min(...visibleMidi)) - 1,
        Math.ceil(Math.max(...visibleMidi)) + 1,
      ]
    : [36, 60];
  const inspect = (index: number, alsoSeek = false) => {
    const bounded = Math.max(0, Math.min(frames.length - 1, index));
    const frame = frames[bounded];
    if (!frame) return;
    setSelectedIndex(bounded);
    if (frame.time < windowStart || frame.time > windowEnd)
      setWindowStart(
        Math.min(
          Math.max(0, frame.time - WINDOW_SECONDS / 2),
          Math.max(0, (result?.duration ?? 0) - WINDOW_SECONDS),
        ),
      );
    if (alsoSeek) seek(frame.time);
  };
  const clickTime = (index: string | number | undefined | null) => {
    if (index === undefined || index === null) return;
    const frame = data[Number(index)];
    if (frame)
      inspect(
        Math.round(
          (frame.time * result!.config.sampleRate -
            result!.config.windowSize / 2) /
            result!.config.hopSize,
        ),
        true,
      );
  };
  return (
    <section
      className="panel intonation-panel"
      aria-labelledby="intonation-title"
    >
      <div className="intonation-heading">
        <div>
          <span className="eyebrow">
            <Activity size={16} /> LOCAL PITCH MEASUREMENTS
          </span>
          <h2 id="intonation-title">Explore your intonation</h2>
          <p>
            {recording
              ? trackTitle(recording.name)
              : "Record or load a cello recording in the player to begin."}
          </p>
        </div>
        {busy ? (
          <button className="button secondary" onClick={cancel}>
            <X size={16} />
            Cancel analysis
          </button>
        ) : (
          <button
            className="button primary"
            disabled={!recording || recording.instrument !== "cello"}
            onClick={() => void run()}
          >
            <Activity size={16} />
            {result ? "Analyse again" : "Analyse Intonation"}
          </button>
        )}
      </div>
      <p className="pitch-explanation">
        Single cello notes, measured against the nearest equal-tempered pitch at
        A4 = 440 Hz. Positive cents means sharp; negative means flat. These
        measurements do not establish intended notes or musical correctness.
      </p>
      {recording?.instrument === "violin" && (
        <p className="pitch-notice" role="status">
          This initial analysis is configured for cello. Violin analysis has not
          been validated. Your violin recording remains available for playback.
        </p>
      )}
      {busy && (
        <div className="pitch-progress">
          <p role="status">
            {status === "decoding"
              ? "Decoding audio locally…"
              : `Measuring pitch… ${progress}%`}
          </p>
          <progress
            aria-label="Pitch analysis progress"
            {...(status === "analysing" ? { value: progress } : {})}
            max={100}
          />
        </div>
      )}
      {status === "cancelled" && (
        <p role="status" className="pitch-notice">
          Analysis cancelled. Your recording is unchanged.
        </p>
      )}
      {error && (
        <p role="alert" className="pitch-error">
          {error}
        </p>
      )}
      {result && (
        <>
          <div className="pitch-stats" role="status">
            <span>
              <strong>{Math.round(result.coverage * 100)}%</strong> usable-frame
              coverage
            </span>
            <span>
              <strong>{Math.round(result.meanClarity * 100)}%</strong> mean
              clarity of usable frames
            </span>
            <span>
              {result.usableFrames.toLocaleString()} /{" "}
              {frames.length.toLocaleString()} frames
            </span>
          </div>
          {!result.sufficient && (
            <p className="pitch-notice">
              Not enough reliable pitch data for observations. Try at least a
              few seconds of a clear, solo cello note with less background
              sound. Quiet audio, chords, accompaniment, and unsupported pitch
              ranges can reduce usable data.
            </p>
          )}
          {frames.length > 0 && (
            <>
              <div className="pitch-window">
                <label htmlFor="pitch-window">
                  Graph window: {preciseTime(windowStart)}–
                  {preciseTime(windowEnd)}
                </label>
                <input
                  id="pitch-window"
                  aria-label="Move graph time window"
                  type="range"
                  min={0}
                  max={Math.max(0, result.duration - WINDOW_SECONDS)}
                  step={0.1}
                  value={windowStart}
                  disabled={result.duration <= WINDOW_SECONDS}
                  onChange={(e) => setWindowStart(Number(e.target.value))}
                />
              </div>
              <div className="pitch-chart-grid">
                {(["midi", "graphCents"] as const).map((metric) => (
                  <div className="pitch-chart-panel" key={metric}>
                    <h3>
                      {metric === "midi"
                        ? "Detected pitch trajectory"
                        : "Deviation from nearest semitone"}
                    </h3>
                    <p>
                      {metric === "midi"
                        ? "Note height · inspect for frequency in Hz"
                        : "Cents · + sharp / − flat · gaps at reference changes"}
                    </p>
                    <div
                      className="pitch-chart"
                      role="group"
                      aria-label={
                        metric === "midi"
                          ? "Pitch over time. Use the timestamp inspector below for exact values."
                          : "Cents over time. Use the timestamp inspector below for exact values."
                      }
                    >
                      <ResponsiveContainer
                        width="100%"
                        height={240}
                        minWidth={0}
                      >
                        <LineChart
                          data={data}
                          margin={{ top: 12, right: 14, bottom: 6, left: 0 }}
                          onClick={(state) =>
                            clickTime(state.activeTooltipIndex)
                          }
                          accessibilityLayer
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
                            width={48}
                            domain={metric === "midi" ? pitchDomain : [-50, 50]}
                            tickFormatter={(value) =>
                              metric === "midi"
                                ? noteName(Number(value))
                                : `${Number(value) > 0 ? "+" : ""}${value}`
                            }
                            allowDecimals={false}
                            stroke="#acb9c0"
                            tick={{ fontSize: 11 }}
                          />
                          <Tooltip content={<MeasurementTooltip />} />
                          {metric === "graphCents" && (
                            <ReferenceLine
                              y={0}
                              stroke="#e5dfca"
                              strokeDasharray="4 4"
                            />
                          )}
                          {position >= windowStart && position <= windowEnd && (
                            <ReferenceLine x={position} stroke="#c4b9df" />
                          )}
                          {selected &&
                            selected.time >= windowStart &&
                            selected.time <= windowEnd && (
                              <ReferenceLine
                                x={selected.time}
                                stroke="#8dd4be"
                                strokeDasharray="2 2"
                              />
                            )}
                          <Line
                            dataKey={metric}
                            type="linear"
                            stroke={metric === "midi" ? "#8dd4be" : "#edc49a"}
                            strokeWidth={1.7}
                            dot={false}
                            activeDot={{ r: 4 }}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
              <div className="pitch-inspector">
                <label htmlFor="pitch-timestamp">
                  Inspect a timestamp{" "}
                  <small>
                    Click either graph to inspect and seek, or use this slider.
                  </small>
                </label>
                <input
                  id="pitch-timestamp"
                  aria-label="Inspect pitch measurement timestamp"
                  aria-valuetext={
                    selected
                      ? `${preciseTime(selected.time)}, ${selected.note ?? "no usable pitch"}`
                      : undefined
                  }
                  type="range"
                  min={0}
                  max={Math.max(0, frames.length - 1)}
                  step={1}
                  value={selectedIndex}
                  onChange={(e) => inspect(Number(e.target.value))}
                />
                <div className="pitch-reading">
                  {selected && (
                    <>
                      <span aria-hidden="true">
                        {selected.cents !== null &&
                          (selected.cents > 0 ? (
                            <ArrowUp size={18} />
                          ) : (
                            <ArrowDown size={18} />
                          ))}
                      </span>
                      <Measurement frame={selected} />
                    </>
                  )}
                </div>
                <button
                  className="button secondary"
                  disabled={!selected || !playbackDuration}
                  onClick={() => selected && seek(selected.time)}
                >
                  <Crosshair size={16} />
                  Seek player to timestamp
                </button>
              </div>
            </>
          )}
          <div className="pitch-observations">
            <h3>Measured observations</h3>
            {result.observations.length ? (
              <ul>
                {result.observations.map((observation) => (
                  <li key={observation}>{observation}</li>
                ))}
              </ul>
            ) : (
              <p>
                {result.sufficient
                  ? "No stable above/below-reference pattern or widespread low clarity met the observation thresholds."
                  : "Observations are withheld because usable pitch data is insufficient."}
              </p>
            )}
            <small>
              Calculated from these measurements using fixed rules; no LLM
              assessment.
            </small>
          </div>
        </>
      )}
      <details className="pitch-method">
        <summary>Method and limits</summary>
        <p>
          Pitchy’s monophonic McLeod estimator uses {CELLO_CONFIG.windowSize}
          -sample windows (~186 ms) every {CELLO_CONFIG.hopSize} samples (~23
          ms), at {CELLO_CONFIG.sampleRate.toLocaleString()} Hz. Cello range:{" "}
          {CELLO_CONFIG.minFrequency}–{CELLO_CONFIG.maxFrequency} Hz, including
          C2. Minimum clarity: {CELLO_CONFIG.minClarity * 100}%; minimum RMS:{" "}
          {CELLO_CONFIG.minRms}. Clarity measures periodicity, not the
          probability a note is correct. Frame timestamps mark window centres,
          so note boundaries are approximate.
        </p>
        <p>
          Silence and low-confidence measurements leave gaps. Octave errors can
          still occur with weak fundamentals. Chords and accompanied music are
          unsuitable. Transitions, vibrato, and musical tuning choices can
          differ from equal temperament; no fingering, bowing, or wrong-note
          diagnosis is made. Synthetic tests do not validate accuracy on real
          cello recordings.
        </p>
        <p>
          Analysis stays on this device, supports files up to ten minutes and
          100 MB, and is cancelled when you switch recordings or leave this
          page. Results are temporary; original recordings and playlists are
          unchanged.
        </p>
      </details>
    </section>
  );
}
