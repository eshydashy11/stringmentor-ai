import type { ExperimentalResult } from "./experimental-pitch.ts";
import { analyseToneRecording } from "./analyse-tone-recording.ts";
import type { PitchResult } from "./pitch.ts";
import type { ToneResult } from "./tone.ts";

export type AnalysisBundle = {
  recordingId: string;
  pitch: PitchResult;
  tone: ToneResult;
  experimental?: ExperimentalResult;
};
export type AnalysisStatus =
  "idle" | "decoding" | "analysing" | "complete" | "cancelled" | "error";
export type AnalysisState = {
  status: AnalysisStatus;
  result: AnalysisBundle | null;
  progress: number;
  error: string;
  revision: number;
};
export function validateBundle(
  bundle: AnalysisBundle,
  recordingId: string,
): boolean {
  if (
    bundle.recordingId !== recordingId ||
    !Number.isFinite(bundle.pitch.duration) ||
    !Number.isFinite(bundle.tone.duration) ||
    bundle.pitch.duration <= 0 ||
    Math.abs(bundle.pitch.duration - bundle.tone.duration) > 0.001
  )
    return false;
  const duration = bundle.pitch.duration;
  const ordered = (frames: { time: number }[]) =>
    frames.every(
      (f, i) =>
        Number.isFinite(f.time) &&
        f.time >= 0 &&
        f.time <= duration &&
        (!i || f.time > frames[i - 1].time),
    );
  return (
    (!bundle.experimental ||
      (bundle.experimental.version === "2D.2A.1" &&
        bundle.experimental.pitch.duration === duration &&
        bundle.experimental.pitch.frames.length ===
          bundle.pitch.frames.length &&
        bundle.experimental.decisions.length === bundle.pitch.frames.length &&
        bundle.experimental.pitch.frames.every(
          (f, i) =>
            f.time === bundle.pitch.frames[i].time &&
            (f.frequency === null ||
              (Number.isFinite(f.frequency) &&
                f.frequency > 0 &&
                f.cents !== null &&
                Number.isFinite(f.cents) &&
                f.midi !== null &&
                Number.isFinite(f.midi))),
        ))) &&
    ordered(bundle.pitch.frames) &&
    ordered(bundle.tone.frames) &&
    bundle.pitch.frames.every(
      (f) =>
        f.frequency === null ||
        (Number.isFinite(f.frequency) &&
          f.frequency > 0 &&
          f.cents !== null &&
          Number.isFinite(f.cents) &&
          f.midi !== null &&
          Number.isFinite(f.midi)),
    ) &&
    bundle.tone.frames.every(
      (f) =>
        Number.isFinite(f.rms) &&
        f.rms >= 0 &&
        Number.isFinite(f.dbfs) &&
        [f.centroid, f.flatness, f.flux, f.harmonicSupport].every(
          (v) => v === null || Number.isFinite(v),
        ),
    ) &&
    bundle.tone.events.every(
      (e) => Number.isFinite(e.time) && e.time >= 0 && e.time <= duration,
    )
  );
}
export async function analysePracticeRecording(
  recordingId: string,
  file: Blob,
  signal: AbortSignal,
  progress: (p: number) => void,
  includeExperimental = false,
): Promise<AnalysisBundle> {
  let pitch: PitchResult | null = null;
  let experimental: ExperimentalResult | undefined;
  const tone = await analyseToneRecording(
    file,
    signal,
    progress,
    (result) => {
      pitch = result;
    },
    includeExperimental
      ? {
          onResult: (result) => {
            experimental = result;
          },
        }
      : undefined,
  );
  if (includeExperimental && !experimental)
    throw new Error(
      "Experimental comparison is unavailable. Reload and analyse again.",
    );
  signal.throwIfAborted();
  if (!pitch)
    throw new Error(
      "The shared pitch result is unavailable. Reload the app and analyse again.",
    );
  const bundle = { recordingId, pitch, tone, experimental };
  if (!validateBundle(bundle, recordingId))
    throw new Error(
      "The analysis returned inconsistent measurements. Please analyse again.",
    );
  return bundle;
}

/** One recording, one job, one immutable result. Goal/review changes never rerun DSP. */
export class PracticeAnalysisSession {
  private state: AnalysisState = {
    status: "idle",
    result: null,
    progress: 0,
    error: "",
    revision: 0,
  };
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private job: Promise<void> | null = null;
  readonly recordingId: string;
  private runner: typeof analysePracticeRecording;
  constructor(recordingId: string, runner = analysePracticeRecording) {
    this.recordingId = recordingId;
    this.runner = runner;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: AnalysisState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  run(file: Blob, force = false, includeExperimental = false): Promise<void> {
    if (this.job) return this.job;
    if (
      this.state.result &&
      !force &&
      (!includeExperimental || this.state.result.experimental)
    )
      return Promise.resolve();
    const controller = new AbortController();
    this.controller = controller;
    this.publish({
      status: "decoding",
      result: null,
      error: "",
      progress: 0,
      revision: this.state.revision + 1,
    });
    const task = async () => {
      try {
        const result = await this.runner(
          this.recordingId,
          file,
          controller.signal,
          (progress) => {
            if (!controller.signal.aborted)
              this.publish({
                ...this.state,
                status: "analysing",
                progress: Math.round(progress * 100),
              });
          },
          includeExperimental,
        );
        if (controller.signal.aborted || this.controller !== controller) return;
        if (!validateBundle(result, this.recordingId))
          throw new Error(
            "The analysis result does not belong to this recording or contains invalid measurements.",
          );
        this.publish({
          ...this.state,
          status: "complete",
          result,
          progress: 100,
        });
      } catch (error) {
        if (!controller.signal.aborted)
          this.publish({
            ...this.state,
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : "Analysis failed. Try a shorter recording.",
          });
      } finally {
        if (this.controller === controller) {
          this.controller = null;
          this.job = null;
        }
      }
    };
    this.job = Promise.resolve().then(task);
    return this.job;
  }
  cancel = () => {
    if (!this.controller) return;
    this.controller.abort();
    this.controller = null;
    this.job = null;
    this.publish({ ...this.state, status: "cancelled", result: null });
  };
}
