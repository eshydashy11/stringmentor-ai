import {
  CELLO_CONFIG,
  frequencyToPitch,
  type PitchFrame,
} from "../../src/lib/pitch.ts";
import type { ToneFrame, AcousticEvent } from "../../src/lib/tone.ts";
import type { AnalysisBundle } from "../../src/lib/practice-session.ts";
import type {
  FeedbackInput,
  PracticeGoal,
} from "../../src/lib/practice-feedback.ts";

export function practiceFixture(
  levelDifference = 6,
  cents = 15,
): AnalysisBundle {
  const pitchFrames: PitchFrame[] = [];
  const toneFrames: ToneFrame[] = [];
  for (let i = 0; i < 340; i++) {
    const time = (2048 + i * 512) / 22050;
    const frequency = 146.832 * 2 ** (cents / 1200);
    const p = frequencyToPitch(frequency);
    pitchFrames.push({
      time,
      frequency,
      midi: p.midi,
      note: p.note,
      cents: p.cents,
      clarity: 0.98,
      rms: 0.1,
      diagnostics: {
        rawFrequency: frequency,
        rawClarity: 0.98,
        candidates: [
          {
            frequency,
            support: 0.95,
            periodicity: 0.98,
            score: 0.9,
            primitive: true,
            harmonics: [1, 2, 3],
          },
        ],
        decision: "spectral",
        margin: 0.2,
        corrected: false,
        selectedCandidate: 0,
        detail: "Synthetic fixture with explicit measurements",
      },
    });
  }
  for (let i = 0; i < 680; i++) {
    const time = (1024 + i * 256) / 22050;
    const dbfs = -30 + (time >= 4 ? levelDifference : 0);
    const p = frequencyToPitch(146.832 * 2 ** (cents / 1200));
    toneFrames.push({
      time,
      rms: 10 ** (dbfs / 20),
      dbfs,
      active: true,
      centroid: time >= 4 ? 750 : 500,
      flatness: 0.001,
      flux: 0.01,
      harmonicSupport: 0.95,
      periodicity: 0.98,
      midi: p.midi,
      note: p.note,
      levelSpread: 0,
      brightnessSpread: 0,
    });
  }
  const events: AcousticEvent[] = [2, 6].map((time, i) => ({
    id: `event-${i + 1}`,
    time,
    kind: "candidate-bow-reversal",
    evidence: ["Synthetic labelled evidence"],
    strength: "multiple cues",
    dipDb: 3.5 + i * 2,
    stepDb: 0,
    peakDb: 0,
    flux: 0.2,
    pitchChangeCents: 1,
  }));
  return {
    recordingId: "fixture-recording",
    pitch: {
      frames: pitchFrames,
      duration: 8,
      config: { ...CELLO_CONFIG },
      usableFrames: pitchFrames.length,
      coverage: 1,
      meanClarity: 0.98,
      sufficient: true,
      observations: [],
    },
    tone: {
      version: "2B.1",
      duration: 8,
      frames: toneFrames,
      events,
      passages: [
        { start: 0.2, end: 3.8, note: "D3" },
        { start: 4.2, end: 7.8, note: "D3" },
      ],
      fluxThreshold: 0.08,
      clipping: {
        peak: 0.2,
        nearFullScaleSamples: 0,
        sampleCount: 176400,
        longestRun: 0,
      },
    },
  };
}
export function feedbackInput(
  goal: PracticeGoal = "dynamics",
  analysis = practiceFixture(),
): FeedbackInput {
  return {
    recordingId: analysis.recordingId,
    analysis,
    goal,
    interval: { start: 0, end: 8 },
    reviews: {},
    recordingConditions: "unknown",
  };
}
