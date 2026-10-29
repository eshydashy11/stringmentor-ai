"use client";

import { ExperimentalPitchControls } from "./experimental-pitch-controls";
import { useState } from "react";
import { Activity, ArrowDown, ArrowUp, Crosshair, X } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStudio } from "./studio-provider";
import { usePracticeAnalysis } from "./practice-analysis-provider";
import {
  CELLO_CONFIG,
  noteName,
  frequencyToPitch,
  type PitchFrame,
} from "@/lib/pitch";
import { formatTime, trackTitle } from "@/lib/audio";

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
        {preciseTime(frame.time)} · No usable pitch ({frame.rejection}) · raw
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
      · periodicity {(frame.clarity * 100).toFixed(0)}%
    </span>
  );
}
function FrameDiagnostics({ frame }: { frame: PitchFrame }) {
  const diagnostic = frame.diagnostics;
  if (!diagnostic) return null;
  const raw = diagnostic.rawFrequency;
  return (
    <details className="pitch-frame-diagnostics">
      <summary>
        Frame diagnostics ·{" "}
        {frame.frequency === null
          ? "withheld / uncertain"
          : diagnostic.corrected
            ? "harmonic correction"
            : "raw estimate retained"}
      </summary>
      <p>{diagnostic.detail}</p>
      <dl className="pitch-diagnostic-values">
        <div>
          <dt>Raw Pitchy estimate</dt>
          <dd>
            {raw
              ? `${raw.toFixed(2)} Hz · ${frequencyToPitch(raw).note}`
              : "None"}{" "}
            · clarity {(diagnostic.rawClarity * 100).toFixed(1)}%
          </dd>
        </div>
        <div>
          <dt>Original rejection rule</dt>
          <dd>
            {diagnostic.rawRejection ?? "Not rejected by the old threshold"}
          </dd>
        </div>
        <div>
          <dt>Tracked estimate</dt>
          <dd>
            {frame.frequency
              ? `${frame.frequency.toFixed(2)} Hz · ${frame.note}`
              : "Uncertain — no note assigned"}
          </dd>
        </div>
        <div>
          <dt>RMS / quiet threshold</dt>
          <dd>
            {frame.rms.toFixed(5)} / {CELLO_CONFIG.minRms}
          </dd>
        </div>
        <div>
          <dt>Decision / score margin</dt>
          <dd>
            {diagnostic.decision} / {diagnostic.margin.toFixed(3)} (minimum{" "}
            {CELLO_CONFIG.minCandidateMargin})
          </dd>
        </div>
      </dl>
      {diagnostic.candidates.length > 0 && (
        <div
          className="pitch-candidate-scroll"
          tabIndex={0}
          role="region"
          aria-label="Competing pitch candidates"
        >
          <table className="pitch-candidates">
            <caption>Candidate evidence · scores are not probabilities</caption>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Spectral support</th>
                <th>Periodicity</th>
                <th>Score</th>
                <th>Harmonics</th>
              </tr>
            </thead>
            <tbody>
              {diagnostic.candidates.map((candidate, i) => (
                <tr key={i}>
                  <td>
                    {candidate.frequency.toFixed(2)} Hz
                    {diagnostic.selectedCandidate === i ? " · selected" : ""}
                  </td>
                  <td>{(candidate.support * 100).toFixed(1)}%</td>
                  <td>{(candidate.periodicity * 100).toFixed(1)}%</td>
                  <td>{candidate.score.toFixed(3)}</td>
                  <td>
                    {candidate.harmonics.join(", ")}
                    {candidate.primitive ? "" : " · common divisor"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        Raw clarity measures one period’s repeatability. Spectral support
        measures the share of retained peak amplitude explained by a harmonic
        family. Neither establishes the intended note. Neighbours contribute at
        most {CELLO_CONFIG.neighbourBonus.toFixed(2)} to a score; they cannot
        fill frames with insufficient acoustic evidence.
      </p>
    </details>
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
export function IntonationAnalysis({
  advanced = false,
}: {
  advanced?: boolean;
}) {
  const shared = usePracticeAnalysis();
  return <AnalysisSession key={shared.revision} advanced={advanced} />;
}
function AnalysisSession({ advanced }: { advanced: boolean }) {
  const { seek, duration: playbackDuration, position } = useStudio();
  const shared = usePracticeAnalysis();
  const {
    recording,
    status,
    error,
    progress,
    busy,
    cancel,
    windowStart,
    setWindowStart,
    highlight,
  } = shared;
  const experimental =
    advanced && shared.pitchMode === "experimental"
      ? shared.result?.experimental
      : undefined;
  const hybrid =
    advanced && shared.pitchMode === "hybrid-tiny"
      ? shared.result?.hybrid
      : undefined;
  const comparison = hybrid ?? experimental;
  const result = comparison?.pitch ?? shared.result?.pitch ?? null;
  const run = () =>
    shared.run(
      !!result,
      advanced && shared.pitchMode !== "standard",
      advanced && shared.pitchMode === "hybrid-tiny",
    );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showRaw, setShowRaw] = useState(advanced);
  const prefix = advanced ? "advanced-" : "";
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
      standardMidi: comparison
        ? (shared.result!.pitch.frames[
            Math.round((frame.time * 22050 - 2048) / 512)
          ]?.midi ?? null)
        : null,
      rawMidi:
        frame.diagnostics?.rawFrequency &&
        frame.diagnostics.rawFrequency >= CELLO_CONFIG.minFrequency &&
        frame.diagnostics.rawFrequency <= CELLO_CONFIG.maxFrequency
          ? frequencyToPitch(frame.diagnostics.rawFrequency).midi
          : null,
      // Do not draw across semitone-reference changes: cents wraps at ±50.
      graphCents:
        index > 0 && frame.note !== visible[index - 1].note
          ? null
          : frame.cents,
    }));
  const visibleMidi = data.flatMap((f) => [
    ...(f.midi === null ? [] : [f.midi]),
    ...(f.standardMidi === null ? [] : [f.standardMidi]),
    ...(showRaw && f.rawMidi !== null ? [f.rawMidi] : []),
  ]);
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
      aria-labelledby={`${prefix}intonation-title`}
    >
      <div className="intonation-heading">
        <div>
          <span className="eyebrow">
            <Activity size={16} /> LOCAL PITCH MEASUREMENTS
          </span>
          <h2 id={`${prefix}intonation-title`}>
            {advanced ? "Pitch diagnostics" : "Explore your intonation"}
          </h2>
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
      {advanced && <ExperimentalPitchControls selectedIndex={selectedIndex} />}
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
              : `${shared.stage ?? "Measuring pitch"}… ${progress}%`}
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
              periodicity of usable frames
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
          {advanced && (
            <details className="pitch-rejections">
              <summary>Rejected-frame breakdown</summary>
              <p>
                Final decisions:{" "}
                {Object.entries(
                  frames.reduce<Record<string, number>>((counts, frame) => {
                    if (frame.rejection)
                      counts[frame.rejection] =
                        (counts[frame.rejection] ?? 0) + 1;
                    return counts;
                  }, {}),
                )
                  .map(([reason, count]) => `${reason}: ${count}`)
                  .join(" · ") || "No frames withheld"}
              </p>
              <p>
                Raw Pitchy rejections before correction:{" "}
                {Object.entries(
                  frames.reduce<Record<string, number>>((counts, frame) => {
                    const reason = frame.diagnostics?.rawRejection;
                    if (reason) counts[reason] = (counts[reason] ?? 0) + 1;
                    return counts;
                  }, {}),
                )
                  .map(([reason, count]) => `${reason}: ${count}`)
                  .join(" · ") || "None"}
              </p>
            </details>
          )}
          {frames.length > 0 && (
            <>
              {advanced && (
                <label className="pitch-raw-toggle">
                  <input
                    type="checkbox"
                    checked={showRaw}
                    onChange={(event) => setShowRaw(event.target.checked)}
                  />
                  Show raw Pitchy estimates (dashed) beside the tracked pitch
                  (teal)
                </label>
              )}
              <div className="pitch-window">
                <label htmlFor={`${prefix}pitch-window`}>
                  Graph window: {preciseTime(windowStart)}–
                  {preciseTime(windowEnd)}
                </label>
                <input
                  id={`${prefix}pitch-window`}
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
                          {highlight?.graph === "pitch" &&
                            highlight.interval.end >= windowStart &&
                            highlight.interval.start <= windowEnd && (
                              <ReferenceArea
                                x1={Math.max(
                                  windowStart,
                                  highlight.interval.start,
                                )}
                                x2={Math.min(windowEnd, highlight.interval.end)}
                                fill="#8dd4be"
                                fillOpacity={0.16}
                              />
                            )}
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
                          {metric === "midi" && comparison && (
                            <Line
                              dataKey="standardMidi"
                              name="Standard reference"
                              stroke="#e5dfca"
                              strokeDasharray="6 3"
                              strokeWidth={1.3}
                              dot={false}
                              connectNulls={false}
                              isAnimationActive={false}
                            />
                          )}
                          {metric === "midi" && showRaw && (
                            <Line
                              dataKey="rawMidi"
                              name="Raw Pitchy estimate"
                              stroke="#b5a2d5"
                              strokeDasharray="4 4"
                              strokeWidth={1}
                              dot={false}
                              connectNulls={false}
                              isAnimationActive={false}
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
              {showRaw && (
                <p>
                  Raw estimates outside the cello range appear in frame
                  diagnostics rather than on the graph.
                </p>
              )}
              <div className="pitch-inspector">
                <label htmlFor={`${prefix}pitch-timestamp`}>
                  Inspect a timestamp{" "}
                  <small>
                    Click either graph to inspect and seek, or use this slider.
                  </small>
                </label>
                <input
                  id={`${prefix}pitch-timestamp`}
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
                {advanced && selected && (
                  <>
                    {hybrid && (
                      <p>
                        Standard reference evidence at this timestamp (the
                        hybrid selection is explained above).
                      </p>
                    )}
                    <FrameDiagnostics
                      frame={
                        hybrid
                          ? shared.result!.pitch.frames[selectedIndex]
                          : selected
                      }
                    />
                  </>
                )}
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
          {advanced && (
            <div className="pitch-observations">
              <h3>Measured observations</h3>
              {hybrid ? (
                <p>
                  Hybrid-specific practice observations are not implemented.
                  Practice Mentor continues to use Standard measurements.
                </p>
              ) : result.observations.length ? (
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
              {!hybrid && (
                <small>
                  Calculated from these measurements using fixed rules; no LLM
                  assessment.
                </small>
              )}
            </div>
          )}
        </>
      )}
      {advanced && (
        <details className="pitch-method">
          <summary>Method and limits</summary>
          <p>
            Pitchy supplies a raw periodicity estimate. A separate Hann-windowed
            spectrum proposes competing harmonic families, including missing
            fundamentals. It favours families supported by distinct harmonic
            numbers over unnecessary subharmonics. Windows remain{" "}
            {CELLO_CONFIG.windowSize} samples (~186 ms), with{" "}
            {CELLO_CONFIG.hopSize}-sample hops (~23 ms), at{" "}
            {CELLO_CONFIG.sampleRate.toLocaleString()} Hz; range{" "}
            {CELLO_CONFIG.minFrequency}–{CELLO_CONFIG.maxFrequency} Hz includes
            C2. Frame times are window centres.
          </p>
          <p>
            Minimum RMS: {CELLO_CONFIG.minRms}. The raw clarity threshold
            remains {CELLO_CONFIG.minClarity * 100}% for comparison. Tracked
            candidates instead require at least{" "}
            {CELLO_CONFIG.minHarmonicSupport * 100}% spectral support,{" "}
            {CELLO_CONFIG.minCandidatePeriodicity * 100}% periodicity, a score
            of {CELLO_CONFIG.minCandidateScore}, and a winning margin of{" "}
            {CELLO_CONFIG.minCandidateMargin}. A single partial also requires
            high periodicity. Up to {CELLO_CONFIG.neighbourFrames} neighbouring
            frames on each side provide bounded support; current-frame frequency
            is never rounded to a note or smoothed. Close competing candidates
            remain uncertain. No expected open-string sequence is built into the
            detector.
          </p>
          <p>
            Silence and low-confidence measurements leave gaps. Octave errors
            can still occur with weak fundamentals. Chords and accompanied music
            are unsuitable. Transitions, vibrato, and musical tuning choices can
            differ from equal temperament; no fingering, bowing, or wrong-note
            diagnosis is made. One supplied open-string recording has been used
            for regression testing. This is not broad real-cello validation, and
            its note labels do not provide precise frequency ground truth.
          </p>
          <p>
            Analysis stays on this device, supports files up to ten minutes and
            100 MB, and is cancelled when you switch recordings or leave this
            page. Results are temporary; original recordings and playlists are
            unchanged.
          </p>
        </details>
      )}
    </section>
  );
}
