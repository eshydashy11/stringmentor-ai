import FFT from "fft.js";
import { MAX_ANALYSIS_SECONDS, type PitchFrame } from "./pitch.ts";

/** Fixed, versioned acoustic settings; no recording-specific notes or timings. */
export const TONE_CONFIG = {
  sampleRate: 22050,
  rmsWindow: 1024,
  spectralWindow: 2048,
  hopSize: 256,
  minRms: 0.003,
  minHz: 50,
  maxHz: 8000,
  eventSeparation: 0.25,
} as const;
export const TONE_VERSION = "2B.1";
export type ToneFrame = {
  time: number;
  rms: number;
  dbfs: number;
  active: boolean;
  centroid: number | null;
  flatness: number | null;
  flux: number | null;
  harmonicSupport: number | null;
  periodicity: number | null;
  midi: number | null;
  note: string | null;
  levelSpread: number | null;
  brightnessSpread: number | null;
};
export type AcousticEventKind =
  "candidate-bow-reversal" | "note-change" | "other-transient" | "uncertain";
export type AcousticEvent = {
  id: string;
  time: number;
  kind: AcousticEventKind;
  evidence: string[];
  strength: "multiple cues" | "limited cues";
  dipDb: number;
  stepDb: number;
  peakDb: number;
  flux: number;
  pitchChangeCents: number | null;
};
export type Passage = { start: number; end: number; note: string };
export type ToneResult = {
  version: string;
  duration: number;
  frames: ToneFrame[];
  events: AcousticEvent[];
  passages: Passage[];
  fluxThreshold: number;
  clipping: {
    peak: number;
    nearFullScaleSamples: number;
    sampleCount: number;
    longestRun: number;
  };
};
export const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}
export function deviation(values: number[]) {
  const average = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - average) ** 2)));
}

/** Count decoded channel samples once, before mono mixing. Near-rail is evidence, not proof of clipping. */
export function clippingEvidence(
  channels: Float32Array[],
): ToneResult["clipping"] {
  let peak = 0,
    nearFullScaleSamples = 0,
    sampleCount = 0,
    longestRun = 0;
  for (const channel of channels) {
    let run = 0;
    for (const sample of channel) {
      if (!Number.isFinite(sample))
        throw new Error("The decoded audio contains invalid samples.");
      const magnitude = Math.abs(sample);
      peak = Math.max(peak, magnitude);
      sampleCount++;
      if (magnitude >= 0.999) {
        nearFullScaleSamples++;
        longestRun = Math.max(longestRun, ++run);
      } else run = 0;
    }
  }
  return { peak, nearFullScaleSamples, sampleCount, longestRun };
}

/** The pitch module supplies context only. This module never changes pitch estimates. */
export function analyseTone(
  samples: Float32Array,
  pitch: Pick<
    PitchFrame,
    "time" | "frequency" | "midi" | "note" | "clarity" | "diagnostics"
  >[] = [],
  onProgress: (fraction: number) => void = () => {},
): ToneResult {
  const c = TONE_CONFIG;
  if (!samples.length || samples.length / c.sampleRate > MAX_ANALYSIS_SECONDS)
    throw new Error(
      "Choose non-empty audio of ten minutes or less for tone analysis.",
    );
  const clipping = clippingEvidence([samples]); // Also validates every sample.
  const fft = new FFT(c.spectralWindow);
  const input = new Float64Array(c.spectralWindow);
  const output = fft.createComplexArray();
  const hann = Float64Array.from(
    { length: c.spectralWindow },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (c.spectralWindow - 1)),
  );
  const firstBin = Math.ceil((c.minHz * c.spectralWindow) / c.sampleRate);
  const lastBin = Math.floor((c.maxHz * c.spectralWindow) / c.sampleRate);
  const bins = lastBin - firstBin + 1;
  let previous: Float64Array | null = null;
  let pitchIndex = 0;
  const frames: ToneFrame[] = [];
  const count = Math.max(
    0,
    Math.floor((samples.length - c.spectralWindow) / c.hopSize) + 1,
  );
  for (let index = 0; index < count; index++) {
    const offset = index * c.hopSize;
    const centre = offset + c.spectralWindow / 2;
    const time = centre / c.sampleRate;
    let sum = 0,
      squares = 0;
    for (let j = centre - c.rmsWindow / 2; j < centre + c.rmsWindow / 2; j++) {
      sum += samples[j];
      squares += samples[j] ** 2;
    }
    const rms = Math.sqrt(
      Math.max(0, squares / c.rmsWindow - (sum / c.rmsWindow) ** 2),
    );
    const active = rms >= c.minRms;
    let centroid: number | null = null,
      flatness: number | null = null,
      flux: number | null = null;
    if (active) {
      let dc = 0;
      for (let j = 0; j < c.spectralWindow; j++) dc += samples[offset + j];
      dc /= c.spectralWindow;
      for (let j = 0; j < c.spectralWindow; j++)
        input[j] = (samples[offset + j] - dc) * hann[j];
      fft.realTransform(output, input);
      const magnitudes = new Float64Array(bins);
      let magnitudeSum = 0,
        weighted = 0,
        powerSum = 0,
        logPowerSum = 0;
      for (let k = firstBin; k <= lastBin; k++) {
        const power = output[2 * k] ** 2 + output[2 * k + 1] ** 2;
        const magnitude = Math.sqrt(power);
        magnitudes[k - firstBin] = magnitude;
        magnitudeSum += magnitude;
        weighted += (magnitude * k * c.sampleRate) / c.spectralWindow;
        powerSum += power;
        logPowerSum += Math.log(Math.max(power, 1e-20));
      }
      if (magnitudeSum > 1e-10 && powerSum > 1e-15) {
        centroid = weighted / magnitudeSum;
        flatness = Math.min(
          1,
          Math.exp(logPowerSum / bins) / (powerSum / bins),
        );
        for (let k = 0; k < bins; k++) magnitudes[k] /= magnitudeSum;
        if (previous) {
          flux = 0;
          for (let k = 0; k < bins; k++)
            flux += Math.max(0, magnitudes[k] - previous[k]);
        }
        previous = magnitudes;
      } else previous = null;
    } else previous = null;
    while (
      pitchIndex + 1 < pitch.length &&
      Math.abs(pitch[pitchIndex + 1].time - time) <
        Math.abs(pitch[pitchIndex].time - time)
    )
      pitchIndex++;
    const p = pitch[pitchIndex];
    // Do not extrapolate into the unanalysed ends or fill pitch gaps.
    const aligned =
      active && p?.frequency != null && Math.abs(p.time - time) <= 0.018
        ? p
        : null;
    const selected = aligned?.diagnostics?.selectedCandidate;
    const support =
      selected != null
        ? (aligned!.diagnostics!.candidates[selected]?.support ?? null)
        : null;
    frames.push({
      time,
      rms,
      dbfs: 20 * Math.log10(Math.max(rms, 1e-6)),
      active,
      centroid,
      flatness,
      flux,
      harmonicSupport: support,
      periodicity: aligned?.clarity ?? null,
      midi: aligned?.midi ?? null,
      note: aligned?.note ?? null,
      levelSpread: null,
      brightnessSpread: null,
    });
    if (index % 128 === 0) onProgress((0.75 * index) / Math.max(count, 1));
  }
  const radius = Math.round((0.25 * c.sampleRate) / c.hopSize);
  for (let i = radius; i < frames.length - radius; i++) {
    const window = frames.slice(i - radius, i + radius + 1);
    if (window.every((f) => f.active && f.centroid !== null)) {
      frames[i].levelSpread = deviation(window.map((f) => f.dbfs));
      frames[i].brightnessSpread = deviation(window.map((f) => f.centroid!));
    }
  }
  const { events, fluxThreshold } = detectAcousticEvents(frames);
  onProgress(1);
  return {
    version: TONE_VERSION,
    duration: samples.length / c.sampleRate,
    frames,
    events,
    passages: findPassages(frames),
    fluxThreshold,
    clipping,
  };
}

function pitchContext(frames: ToneFrame[]): number | null {
  const values = frames.flatMap((f) => (f.midi === null ? [] : [f.midi]));
  if (
    values.length < 5 ||
    values.length / frames.length < 0.6 ||
    deviation(values) > 0.35
  )
    return null;
  return median(values);
}

/** Offline multi-cue proposals. Evidence strengths are rules, never calibrated probabilities. */
export function detectAcousticEvents(frames: ToneFrame[]) {
  const fluxes = frames.flatMap((f) => (f.flux === null ? [] : [f.flux]));
  const centreFlux = median(fluxes);
  const fluxThreshold = Math.max(
    0.08,
    centreFlux + 4 * median(fluxes.map((v) => Math.abs(v - centreFlux))),
  );
  const hop = TONE_CONFIG.hopSize / TONE_CONFIG.sampleRate;
  const width = Math.round(0.22 / hop),
    gap = Math.round(0.07 / hop);
  const proposals: (AcousticEvent & { rank: number })[] = [];
  for (let i = width; i < frames.length - width; i++) {
    const f = frames[i];
    const left = frames.slice(i - width, i - gap),
      right = frames.slice(i + gap + 1, i + width + 1);
    // Require sound on both sides. Do not call recording onset/offset a stroke reversal.
    if (
      left.filter((v) => v.active).length / left.length < 0.8 ||
      right.filter((v) => v.active).length / right.length < 0.8
    )
      continue;
    const before = median(left.map((v) => v.dbfs)),
      after = median(right.map((v) => v.dbfs));
    const dip = Math.max(0, Math.min(before, after) - f.dbfs);
    const peak = Math.max(0, f.dbfs - Math.max(before, after));
    const step = after - before;
    const local = frames.slice(i - gap, i + gap + 1);
    const flux = Math.max(...local.map((v) => v.flux ?? 0));
    const brightnessBefore = median(
      left.flatMap((v) => (v.centroid === null ? [] : [v.centroid])),
    );
    const brightnessAfter = median(
      right.flatMap((v) => (v.centroid === null ? [] : [v.centroid])),
    );
    const brightnessChange =
      brightnessBefore > 0 && brightnessAfter > 0
        ? Math.abs(Math.log2(brightnessAfter / brightnessBefore))
        : 0;
    const flatnessChange = Math.abs(
      median(right.map((v) => v.flatness ?? 0)) -
        median(left.map((v) => v.flatness ?? 0)),
    );
    const energyCue = dip >= 3 || Math.abs(step) >= 4 || peak >= 5;
    const spectralCue = flux >= fluxThreshold;
    const structureCue = brightnessChange >= 0.25 || flatnessChange >= 0.08;
    if (
      !(energyCue && spectralCue) &&
      !(spectralCue && structureCue) &&
      dip < 6 &&
      Math.abs(step) < 8 &&
      peak < 8
    )
      continue;
    const beforePitch = pitchContext(
      frames.slice(
        Math.max(0, i - Math.round(0.38 / hop)),
        i - Math.round(0.12 / hop),
      ),
    );
    const afterPitch = pitchContext(
      frames.slice(
        i + Math.round(0.12 / hop),
        Math.min(frames.length, i + Math.round(0.38 / hop)),
      ),
    );
    const change =
      beforePitch !== null && afterPitch !== null
        ? (afterPitch - beforePitch) * 100
        : null;
    const samePitch = change !== null && Math.abs(change) <= 35;
    const kind: AcousticEventKind =
      change !== null && Math.abs(change) >= 75
        ? "note-change"
        : samePitch && dip >= 3 && spectralCue
          ? "candidate-bow-reversal"
          : spectralCue &&
              (peak >= 5 || flatnessChange >= 0.08 || (structureCue && dip < 3))
            ? "other-transient"
            : "uncertain";
    const evidence: string[] = [];
    if (dip >= 3)
      evidence.push(`Envelope dip ${dip.toFixed(1)} dB relative to both sides`);
    if (Math.abs(step) >= 4)
      evidence.push(`Level step ${step > 0 ? "+" : ""}${step.toFixed(1)} dB`);
    if (peak >= 5) evidence.push(`Short level peak ${peak.toFixed(1)} dB`);
    if (spectralCue)
      evidence.push(
        `Spectral flux ${flux.toFixed(3)} ≥ adaptive threshold ${fluxThreshold.toFixed(3)}`,
      );
    if (structureCue)
      evidence.push(
        `Brightness change ${(brightnessChange * 100).toFixed(0)}% of an octave; flatness change ${flatnessChange.toFixed(3)}`,
      );
    evidence.push(
      change === null
        ? "Pitch context unavailable or unstable; no continuity claim"
        : `Pitch before/after differs by ${change.toFixed(0)} cents`,
    );
    proposals.push({
      id: "",
      time: f.time,
      kind,
      evidence,
      strength: energyCue && spectralCue ? "multiple cues" : "limited cues",
      dipDb: dip,
      stepDb: step,
      peakDb: peak,
      flux,
      pitchChangeCents: change,
      rank:
        Math.max(dip / 3, Math.abs(step) / 4, peak / 5) +
        flux / fluxThreshold +
        (kind === "note-change" ? 1 : 0),
    });
  }
  // Non-maximum suppression chooses the strongest timestamp; never imposes a stroke count.
  const selected: typeof proposals = [];
  for (const event of proposals.sort((a, b) => b.rank - a.rank))
    if (
      !selected.some(
        (other) =>
          Math.abs(other.time - event.time) < TONE_CONFIG.eventSeparation,
      )
    )
      selected.push(event);
  const events = selected
    .sort((a, b) => a.time - b.time)
    .map((proposal, i) => {
      const { rank, ...event } = proposal;
      void rank;
      return { ...event, id: `event-${i + 1}` };
    });
  return { events, fluxThreshold };
}

function findPassages(frames: ToneFrame[]): Passage[] {
  const passages: Passage[] = [];
  let region: ToneFrame[] = [];
  const finish = () => {
    if (region.length && region.at(-1)!.time - region[0].time >= 0.65)
      passages.push({
        start: region[0].time,
        end: region.at(-1)!.time,
        note: region[0].note!,
      });
    region = [];
  };
  for (const frame of frames) {
    if (
      frame.note === null ||
      frame.note !== region[0]?.note ||
      (region.length && Math.abs(frame.midi! - region[0].midi!) > 0.5)
    )
      finish();
    if (frame.note !== null) region.push(frame);
  }
  finish();
  return passages;
}

export type IntervalSummary = {
  start: number;
  end: number;
  count: number;
  activeCoverage: number;
  pitchCoverage: number;
  note: string | null;
  meanDbfs: number | null;
  levelStdDb: number | null;
  centroidHz: number | null;
  centroidStdHz: number | null;
  flatness: number | null;
  harmonicSupport: number | null;
  trendDb: number | null;
};
export function summariseInterval(
  frames: ToneFrame[],
  start: number,
  end: number,
): IntervalSummary {
  const selected = frames.filter((f) => f.time >= start && f.time <= end);
  const active = selected.filter((f) => f.active);
  const pitched = active.filter((f) => f.note !== null);
  const notes = new Map<string, number>();
  for (const f of pitched) notes.set(f.note!, (notes.get(f.note!) ?? 0) + 1);
  const dominant = [...notes.entries()].sort((a, b) => b[1] - a[1])[0];
  const stable =
    selected.length > 0 &&
    end - start >= 0.5 &&
    active.length / selected.length >= 0.9 &&
    pitched.length / selected.length >= 0.8 &&
    dominant &&
    dominant[1] / pitched.length >= 0.9 &&
    deviation(pitched.map((f) => f.midi!)) <= 0.35;
  const brightness = active.flatMap((f) =>
    f.centroid === null ? [] : [f.centroid],
  );
  const harmonic = active.flatMap((f) =>
    f.harmonicSupport === null ? [] : [f.harmonicSupport],
  );
  const third = (end - start) / 3;
  const first = active.filter((f) => f.time < start + third),
    last = active.filter((f) => f.time > end - third);
  return {
    start,
    end,
    count: selected.length,
    activeCoverage: selected.length ? active.length / selected.length : 0,
    pitchCoverage: selected.length ? pitched.length / selected.length : 0,
    note: stable ? dominant[0] : null,
    meanDbfs: active.length
      ? 20 * Math.log10(Math.sqrt(mean(active.map((f) => f.rms ** 2))))
      : null,
    levelStdDb: active.length ? deviation(active.map((f) => f.dbfs)) : null,
    centroidHz: brightness.length ? mean(brightness) : null,
    centroidStdHz: brightness.length ? deviation(brightness) : null,
    flatness: active.length ? mean(active.map((f) => f.flatness ?? 0)) : null,
    harmonicSupport: harmonic.length ? mean(harmonic) : null,
    trendDb:
      stable && first.length >= 5 && last.length >= 5
        ? mean(last.map((f) => f.dbfs)) - mean(first.map((f) => f.dbfs))
        : null,
  };
}

export function intervalObservations(
  summary: IntervalSummary,
  events: AcousticEvent[],
): string[] {
  const observations: string[] = [];
  if (!summary.count || summary.activeCoverage < 0.5)
    return [
      "Too little sound above the analysis floor in this interval for tone observations.",
    ];
  if (
    summary.note &&
    summary.trendDb !== null &&
    Math.abs(summary.trendDb) >= 3
  )
    observations.push(
      `Sound energy ${summary.trendDb < 0 ? "decreases" : "increases"} during this sustained ${summary.note} passage: the final third averages ${Math.abs(summary.trendDb).toFixed(1)} dB ${summary.trendDb < 0 ? "below" : "above"} the first third. This is recorded level, not calibrated loudness.`,
    );
  if (summary.note && summary.levelStdDb !== null)
    observations.push(
      `Within this sustained ${summary.note} interval, recorded level has a standard deviation of ${summary.levelStdDb.toFixed(2)} dB. This is variation, not a tone-quality grade.`,
    );
  for (const event of events
    .filter((e) => e.time >= summary.start && e.time <= summary.end)
    .slice(0, 4))
    observations.push(
      `Acoustic transition proposed at ${event.time.toFixed(2)} s (${event.kind.replaceAll("-", " ")}). ${event.evidence[0]}. Listen and review; the physical cause is unknown.`,
    );
  if (!summary.note)
    observations.push(
      "This selection does not meet the stable, single-note criteria. Its acoustic averages may mix notes, gaps or uncertain pitch.",
    );
  return observations;
}

export type EventReview = {
  eventId: string;
  status: "confirmed" | "rejected" | "adjusted";
  time: number;
  kind: AcousticEventKind;
};
export function reviewEvent(
  event: AcousticEvent,
  status: EventReview["status"],
  time: number,
  kind: AcousticEventKind,
  duration: number,
): EventReview {
  if (!Number.isFinite(time) || time < 0 || time > duration)
    throw new Error("Choose a boundary time within this recording.");
  return { eventId: event.id, status, time, kind };
}
