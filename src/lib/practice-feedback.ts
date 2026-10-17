import type { AnalysisBundle } from "./practice-session.ts";
import type { ArticulationReview } from "./articulation-review.ts";
import {
  deviation,
  mean,
  summariseInterval,
  type IntervalSummary,
} from "./tone.ts";
import type { PitchFrame } from "./pitch.ts";

export const PRACTICE_GOALS = {
  dynamics: "Consistent dynamics",
  transitions: "Smooth bow transitions",
  pitch: "Pitch stability / intonation awareness",
  articulation: "Consistent articulation",
  expression: "Expressive variation",
} as const;
export type PracticeGoal = keyof typeof PRACTICE_GOALS;
export type TimeInterval = { start: number; end: number };
export const FEEDBACK_RULES = {
  minSeconds: 0.7,
  minActiveCoverage: 0.9,
  minPitchCoverage: 0.8,
  minHarmonicSupport: 0.75,
  minPitchMargin: 0.06,
  levelDifferenceDb: 3,
  levelVariationDb: 2,
  brightnessRatio: 1.25,
  dipDb: 3,
  articulationDipDifferenceDb: 2,
  pitchOffsetCents: 8,
  pitchDriftCents: 12,
  maxStablePitchSpreadCents: 35,
  maxFindings: 3,
  priorities: {
    comparison: 85,
    confirmedEvent: 90,
    event: 75,
    drift: 80,
    offset: 70,
    variation: 65,
    contour: 80,
  },
} as const;
export type FeedbackRules = Omit<
  { [K in keyof typeof FEEDBACK_RULES]: number },
  "priorities"
> & { priorities: { [K in keyof typeof FEEDBACK_RULES.priorities]: number } };
export const EXERCISES = {
  level: [
    {
      id: "sustain-compare",
      text: "Record two comfortable sustained open-string notes with the microphone fixed. Aim for a steady sound, then listen for any level difference.",
    },
    {
      id: "phrase-intention",
      text: "Repeat this short passage twice after stating a dynamic intention. Compare the recorded contour with what you meant to shape.",
    },
  ],
  transition: [
    {
      id: "slow-transitions",
      text: "Play a short open-string passage with slow bow changes. Listen around each change and mark which transitions you can hear.",
    },
    {
      id: "transition-pairs",
      text: "Record two versions of the same short passage. Choose one transition in each and compare how continuous the sound feels.",
    },
  ],
  pitch: [
    {
      id: "drone-awareness",
      text: "Choose a comfortable note and listen against a drone tuned to your intended reference. Repeat slowly and compare the sound with the displayed pitch.",
    },
    {
      id: "slow-scale",
      text: "Play a short slow scale with a chosen tuning reference. Pause to listen to sustained notes; distinguish deliberate motion from a settled pitch.",
    },
  ],
  articulation: [
    {
      id: "repeat-notes",
      text: "Repeat a comfortable note at a steady tempo with one stated articulation. Listen back to compare the starts and transitions.",
    },
    {
      id: "articulation-listen",
      text: "Choose two repeated notes, listen without playing, and describe whether their starts sound alike. Then repeat with your chosen intention.",
    },
  ],
  expression: [
    {
      id: "shape-dynamics",
      text: "Record a deliberate crescendo and diminuendo on a comfortable note. Listen to whether the recorded contour follows the shape you intended.",
    },
    {
      id: "phrase-versions",
      text: "Play a short phrase in two deliberately different ways. Compare the level and brightness contours without deciding that uniformity is better.",
    },
  ],
} as const;
export type ExerciseGroup = keyof typeof EXERCISES;
export type EvidenceReference = {
  module: "pitch" | "tone" | "event" | "review";
  interval: TimeInterval;
  eventId?: string;
  detail: string;
};
export type FeedbackFinding = {
  id: string;
  goal: PracticeGoal;
  interval: TimeInterval;
  relatedIntervals: TimeInterval[];
  title: string;
  observation: string;
  relevance: string;
  uncertainty: string[];
  measurements: { label: string; value: number; unit: string }[];
  references: EvidenceReference[];
  priority: number;
  priorityReason: string;
  investigation: ExerciseGroup;
  eventId?: string;
  graph: "pitch" | "tone";
};
export type FeedbackInput = {
  recordingId: string;
  analysis: AnalysisBundle | null;
  goal: PracticeGoal;
  interval: TimeInterval;
  reviews: Record<string, ArticulationReview>;
  comparison?: TimeInterval | null;
  recordingConditions: "unknown" | "consistent";
};
export type FeedbackOutput = {
  goal: PracticeGoal;
  findings: FeedbackFinding[];
  insufficient: string | null;
  nextEvidence: string;
  rules: FeedbackRules;
};
const conditions =
  "Microphone position, room sound, automatic gain control and compression may change these measurements. A numerical difference does not establish audibility or musical relevance.";
const intent =
  "Your selected goal is an analytical objective. The original performer’s intention is unknown, especially in uploaded recordings.";
export function validInterval(interval: TimeInterval, duration: number) {
  return (
    Number.isFinite(interval.start) &&
    Number.isFinite(interval.end) &&
    interval.start >= 0 &&
    interval.end <= duration &&
    interval.end > interval.start
  );
}
/** Binary slicing avoids repeated full-recording scans when comparing many passages. */
export function framesIn<T extends { time: number }>(
  frames: T[],
  interval: TimeInterval,
): T[] {
  const bound = (time: number, inclusive: boolean) => {
    let low = 0,
      high = frames.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (frames[mid].time < time || (inclusive && frames[mid].time === time))
        low = mid + 1;
      else high = mid;
    }
    return low;
  };
  return frames.slice(bound(interval.start, false), bound(interval.end, true));
}
function pitchEvidence(frame: PitchFrame, rules: FeedbackRules) {
  if (
    frame.frequency === null ||
    frame.cents === null ||
    frame.midi === null ||
    !Number.isFinite(frame.cents) ||
    !Number.isFinite(frame.midi)
  )
    return false;
  const d = frame.diagnostics;
  const candidate =
    d?.selectedCandidate != null ? d.candidates[d.selectedCandidate] : null;
  return (
    !!candidate &&
    candidate.support >= rules.minHarmonicSupport &&
    d!.margin >= rules.minPitchMargin
  );
}
export function generatePracticeFeedback(
  input: FeedbackInput,
  rules: FeedbackRules = FEEDBACK_RULES,
): FeedbackOutput {
  const output: FeedbackOutput = {
    goal: input.goal,
    findings: [],
    insufficient:
      "Not enough reliable information to provide feedback for this goal.",
    nextEvidence:
      "Select at least a second of clear solo cello, or compare two passages of the same note. Keep the microphone and recording settings consistent.",
    rules,
  };
  const bundle = input.analysis;
  if (
    !bundle ||
    bundle.recordingId !== input.recordingId ||
    !validInterval(input.interval, bundle.pitch.duration) ||
    !validInterval(input.interval, bundle.tone.duration)
  )
    return output;
  const { tone, pitch } = bundle;
  const all: FeedbackFinding[] = [];
  const recordingConditions =
    input.recordingConditions === "consistent"
      ? "You reported consistent recording conditions; this has not been independently verified."
      : "Recording conditions are unverified; listen before attributing differences to playing.";
  const add = (rule: string, finding: Omit<FeedbackFinding, "id" | "goal">) => {
    if (
      ![finding.interval, ...finding.relatedIntervals].every((interval) =>
        validInterval(interval, tone.duration),
      )
    )
      return;
    if (finding.measurements.some((m) => !Number.isFinite(m.value))) return;
    all.push({
      ...finding,
      id: `${input.recordingId}:${input.goal}:${rule}:${finding.interval.start.toFixed(4)}:${finding.interval.end.toFixed(4)}`,
      goal: input.goal,
    });
  };
  const summaryFor = (interval: TimeInterval): IntervalSummary =>
    summariseInterval(
      framesIn(tone.frames, interval),
      interval.start,
      interval.end,
    );
  const sufficient = (s: IntervalSummary) =>
    s.end - s.start >= rules.minSeconds &&
    s.note !== null &&
    s.activeCoverage >= rules.minActiveCoverage &&
    s.pitchCoverage >= rules.minPitchCoverage &&
    s.harmonicSupport !== null &&
    s.harmonicSupport >= rules.minHarmonicSupport;
  const current = summaryFor(input.interval);
  const passages = tone.passages
    .filter(
      (p) => p.end >= input.interval.start && p.start <= input.interval.end,
    )
    .map((p) =>
      summaryFor({
        start: Math.max(p.start, input.interval.start),
        end: Math.min(p.end, input.interval.end),
      }),
    )
    .filter(sufficient);
  if (
    sufficient(current) &&
    !passages.some(
      (s) =>
        Math.abs(s.start - current.start) < 0.1 &&
        Math.abs(s.end - current.end) < 0.1,
    )
  )
    passages.unshift(current);
  const comparison =
    input.comparison && validInterval(input.comparison, tone.duration)
      ? summaryFor(input.comparison)
      : null;
  const pairs: [IntervalSummary, IntervalSummary][] = [];
  if (
    comparison &&
    sufficient(current) &&
    sufficient(comparison) &&
    current.note === comparison.note &&
    (current.start >= comparison.end || comparison.start >= current.end)
  )
    pairs.push([comparison, current]);
  if (!pairs.length) {
    const previous = new Map<string, IntervalSummary>();
    for (const s of [...passages].sort(
      (a, b) => a.start - b.start || a.end - b.end,
    )) {
      const before = previous.get(s.note!);
      if (before && s.start >= before.end) pairs.push([before, s]);
      previous.set(s.note!, s);
    }
  }
  if (["dynamics", "expression", "articulation"].includes(input.goal)) {
    for (const [before, after] of pairs) {
      if (
        before.meanDbfs === null ||
        after.meanDbfs === null ||
        before.centroidHz === null ||
        after.centroidHz === null ||
        before.centroidHz <= 0
      )
        continue;
      const level = after.meanDbfs - before.meanDbfs,
        brightness = after.centroidHz / before.centroidHz;
      const expressive = input.goal === "expression";
      if (
        Math.abs(level) < rules.levelDifferenceDb &&
        !(
          expressive &&
          Math.max(brightness, 1 / brightness) >= rules.brightnessRatio
        )
      )
        continue;
      add("same-note", {
        title: expressive
          ? "Two colours of the same note"
          : "Listen to two passages of the same note",
        interval: { start: after.start, end: after.end },
        relatedIntervals: [{ start: before.start, end: before.end }],
        observation: `The later detected ${after.note} passage has an average recorded level ${Math.abs(level).toFixed(1)} dB ${level < 0 ? "lower" : "higher"} than the earlier one. Its measured brightness is ${Math.abs((brightness - 1) * 100).toFixed(0)}% ${brightness < 1 ? "lower" : "higher"}.`,
        relevance: expressive
          ? "This contrast may be part of a musical shape. Listen to how the two versions relate to your chosen expression."
          : input.goal === "articulation"
            ? "Comparable notes can help you listen for consistent starts and sound profiles; these whole-passage averages do not isolate attacks."
            : "If you want similar dynamics, compare whether this recorded contrast is audible and whether it matches your intention.",
        uncertainty: [
          conditions,
          recordingConditions,
          intent,
          "Passages are selected by detected pitch, not verified score notes or strokes. No perceptibility threshold has been validated.",
        ],
        measurements: [
          {
            label: "Earlier recorded level",
            value: before.meanDbfs,
            unit: "dBFS",
          },
          {
            label: "Later recorded level",
            value: after.meanDbfs,
            unit: "dBFS",
          },
          { label: "Level difference", value: level, unit: "dB" },
          {
            label: "Earlier level variation",
            value: before.levelStdDb!,
            unit: "dB SD",
          },
          {
            label: "Later level variation",
            value: after.levelStdDb!,
            unit: "dB SD",
          },
          { label: "Earlier centroid", value: before.centroidHz, unit: "Hz" },
          { label: "Later centroid", value: after.centroidHz, unit: "Hz" },
        ],
        references: [before, after].map((s) => ({
          module: "tone",
          interval: { start: s.start, end: s.end },
          detail:
            "Same-note, active-frame energy averages and magnitude-weighted centroid; coverage and harmonic evidence pass the feedback gates.",
        })),
        priority: rules.priorities.comparison,
        priorityReason:
          "Same-note comparison exceeds the configured level contrast or expressive brightness threshold.",
        investigation: expressive
          ? "expression"
          : input.goal === "articulation"
            ? "articulation"
            : "level",
        graph: "tone",
      });
    }
    for (const s of passages) {
      const expressive = input.goal === "expression";
      const trend = s.trendDb;
      if (
        trend !== null &&
        Math.abs(trend) >= rules.levelDifferenceDb &&
        input.goal !== "articulation"
      ) {
        add("contour", {
          title: expressive
            ? "A changing dynamic shape"
            : "A sustained note changes level",
          interval: { start: s.start, end: s.end },
          relatedIntervals: [],
          observation: `During this detected ${s.note} passage, the final third averages ${Math.abs(trend).toFixed(1)} dB ${trend < 0 ? "below" : "above"} the first third.`,
          relevance: expressive
            ? "A changing level can contribute to phrasing. Listen to whether the shape serves the expression you want to explore."
            : "For a steady-dynamics investigation, this gives you a specific passage to compare by ear. A level change is not automatically a problem.",
          uncertainty: [
            conditions,
            intent,
            "The same-note selection can include deliberate phrasing. Recorded level does not directly measure bow control.",
          ],
          measurements: [
            { label: "Final minus first third", value: trend, unit: "dB" },
            { label: "Level variation", value: s.levelStdDb!, unit: "dB SD" },
          ],
          references: [
            {
              module: "tone",
              interval: { start: s.start, end: s.end },
              detail:
                "Stable same-note interval; arithmetic means of active-frame dBFS in its first and final thirds.",
            },
          ],
          priority: rules.priorities.contour,
          priorityReason:
            "A sufficiently covered sustained note exceeds the conservative level-trend threshold.",
          investigation: expressive ? "expression" : "level",
          graph: "tone",
        });
      } else if (
        input.goal === "dynamics" &&
        s.levelStdDb !== null &&
        s.levelStdDb >= rules.levelVariationDb
      ) {
        add("level-variation", {
          title: "Listen within this sustained note",
          interval: { start: s.start, end: s.end },
          relatedIntervals: [],
          observation: `Recorded level varies within this detected ${s.note} passage.`,
          relevance:
            "For consistent dynamics, listen to where the level changes. Some changes may be normal articulation or intended phrasing.",
          uncertainty: [conditions, intent],
          measurements: [
            {
              label: "Recorded level variation",
              value: s.levelStdDb,
              unit: "dB SD",
            },
            {
              label: "Brightness variation",
              value: s.centroidStdHz!,
              unit: "Hz SD",
            },
          ],
          references: [
            {
              module: "tone",
              interval: { start: s.start, end: s.end },
              detail:
                "Population standard deviation across active frames of a stable detected note.",
            },
          ],
          priority: rules.priorities.variation,
          priorityReason:
            "Sustained level variation exceeds the configured investigation threshold.",
          investigation: "level",
          graph: "tone",
        });
      }
    }
  }
  if (input.goal === "articulation") {
    const eligible = tone.events
      .filter(
        (event) =>
          event.time >= input.interval.start &&
          event.time <= input.interval.end &&
          event.dipDb >= rules.dipDb &&
          event.flux >= tone.fluxThreshold &&
          event.pitchChangeCents !== null &&
          Math.abs(event.pitchChangeCents) <= 35,
      )
      .flatMap((event) => {
        const flanks = [
          ...framesIn(tone.frames, {
            start: event.time - 0.38,
            end: event.time - 0.12,
          }),
          ...framesIn(tone.frames, {
            start: event.time + 0.12,
            end: event.time + 0.38,
          }),
        ];
        const usable = flanks.filter(
          (frame) =>
            frame.active &&
            frame.note !== null &&
            frame.harmonicSupport !== null &&
            frame.harmonicSupport >= rules.minHarmonicSupport,
        );
        const note = usable[0]?.note;
        return note &&
          usable.length >= 10 &&
          usable.length / flanks.length >= rules.minPitchCoverage &&
          usable.filter((frame) => frame.note === note).length /
            usable.length >=
            0.9
          ? [{ event, note }]
          : [];
      });
    for (let i = 1; i < eligible.length; i++) {
      const before = eligible[i - 1],
        after = eligible[i];
      if (
        before.note !== after.note ||
        Math.abs(after.event.dipDb - before.event.dipDb) <
          rules.articulationDipDifferenceDb
      )
        continue;
      const interval = (time: number) => ({
        start: Math.max(0, time - 0.3),
        end: Math.min(tone.duration, time + 0.3),
      });
      const confirmations = [before, after].filter(
        ({ event }) => input.reviews[event.id]?.bowAnswer === "yes",
      ).length;
      add(`articulation-pair-${before.event.id}-${after.event.id}`, {
        title: "Compare two acoustic transitions",
        interval: interval(after.event.time),
        relatedIntervals: [interval(before.event.time)],
        observation: `Two sound-level dips with detected ${after.note} on their surrounding flanks measure ${before.event.dipDb.toFixed(1)} dB and ${after.event.dipDb.toFixed(1)} dB. You identified ${confirmations} of these suggestions as bow reversals.`,
        relevance:
          "For consistent articulation, listen to whether the two transitions sound alike and whether any contrast matches your intended phrasing.",
        uncertainty: [
          conditions,
          "These are acoustic proposals, not verified note attacks or stroke boundaries. Same-pitch flanks do not establish pitch inside a transition. Manual identifications are separate from the original measurements; adjusted annotations do not relocate measured dips.",
        ],
        measurements: [
          {
            label: "Earlier original dip",
            value: before.event.dipDb,
            unit: "dB",
          },
          { label: "Later original dip", value: after.event.dipDb, unit: "dB" },
          {
            label: "Difference in dip depth",
            value: after.event.dipDb - before.event.dipDb,
            unit: "dB",
          },
        ],
        references: [before, after].flatMap(({ event }) => [
          {
            module: "event" as const,
            eventId: event.id,
            interval: interval(event.time),
            detail:
              "Original acoustic dip; same-note flanks with adequate pitch and harmonic coverage.",
          },
          ...(input.reviews[event.id]
            ? [
                {
                  module: "review" as const,
                  eventId: event.id,
                  interval: interval(input.reviews[event.id].time),
                  detail: `Musician annotation: ${input.reviews[event.id].bowAnswer}.`,
                },
              ]
            : []),
        ]),
        priority: rules.priorities.comparison + 2,
        priorityReason:
          "Two same-register acoustic transitions differ beyond the configured dip-depth comparison threshold.",
        investigation: "articulation",
        graph: "tone",
      });
    }
  }
  if (["transitions", "articulation", "dynamics"].includes(input.goal)) {
    for (const event of tone.events) {
      const review = input.reviews[event.id];
      const time = review?.time ?? event.time;
      if (
        time < input.interval.start ||
        time > input.interval.end ||
        !Number.isFinite(event.dipDb) ||
        event.dipDb < rules.dipDb ||
        event.pitchChangeCents === null ||
        Math.abs(event.pitchChangeCents) > 35 ||
        event.flux < tone.fluxThreshold
      )
        continue;
      const interval = {
        start: Math.max(input.interval.start, Math.min(event.time, time) - 0.3),
        end: Math.min(input.interval.end, Math.max(event.time, time) + 0.3),
      };
      const measured = {
        start: Math.max(0, event.time - 0.22),
        end: Math.min(tone.duration, event.time + 0.22),
      };
      // An adjusted annotation is not a new acoustic measurement at the adjusted time.
      const shifted = Math.abs(time - event.time) > 0.08;
      const confirmed = review?.bowAnswer === "yes";
      const rejected =
        review?.bowAnswer === "no" || review?.status === "rejected";
      const observation = confirmed
        ? `You identified a bow reversal at ${time.toFixed(2)} seconds. ${shifted ? `At the original acoustic candidate at ${event.time.toFixed(2)} seconds` : "Around the original candidate"}, recorded level dips by ${event.dipDb.toFixed(1)} dB while detected pitch before and after stays approximately stable.`
        : `The recorded sound briefly becomes quieter at ${event.time.toFixed(2)} seconds while detected pitch before and after stays approximately stable.${rejected ? " You did not identify this suggestion as a bow reversal." : " This could correspond to a bow transition; its cause is uncertain."}`;
      add(`event-${event.id}`, {
        title: confirmed
          ? "Your identified bow transition"
          : rejected
            ? "A level dip you reviewed"
            : "Possible bow transition",
        interval,
        relatedIntervals: shifted ? [measured] : [],
        eventId: event.id,
        observation,
        relevance:
          input.goal === "articulation"
            ? "Compare this transition with how you want repeated notes to begin and connect."
            : input.goal === "dynamics"
              ? "A brief articulation dip differs from a whole-passage dynamic contrast. Listen before deciding whether it matters."
              : "For smooth transitions, listen to continuity around this point. A detectable dip is not a technique diagnosis.",
        uncertainty: [
          "Pitch continuity compares flanks, not every sample inside the transition. Noise, gain changes and articulation can produce similar evidence; smooth reversals can be missed.",
          "Your answer is a session annotation, not independent acoustic proof or evidence of good or bad technique.",
          ...(shifted
            ? [
                "The timestamp was adjusted; the displayed dip and spectral evidence remain tied to the original candidate, not the adjusted timestamp.",
              ]
            : []),
        ],
        measurements: [
          { label: "Original envelope dip", value: event.dipDb, unit: "dB" },
          { label: "Original spectral flux", value: event.flux, unit: "0–1" },
          {
            label: "Original flank pitch difference",
            value: event.pitchChangeCents,
            unit: "cents",
          },
        ],
        references: [
          {
            module: "event",
            eventId: event.id,
            interval: measured,
            detail:
              "Original immutable acoustic proposal: envelope dip, spectral flux and before/after pitch context.",
          },
          ...(review
            ? [
                {
                  module: "review" as const,
                  eventId: event.id,
                  interval: {
                    start: Math.max(0, time - 0.01),
                    end: Math.min(tone.duration, time + 0.01),
                  },
                  detail: `Musician response: ${review.bowAnswer}; ${review.status}; source ${review.source}.`,
                },
              ]
            : []),
        ],
        priority:
          (confirmed
            ? rules.priorities.confirmedEvent
            : rules.priorities.event) -
          (rejected ? 20 : 0) -
          (input.goal === "dynamics" ? 15 : 0),
        priorityReason:
          "A dip, spectral change and same-pitch flanks agree; a musician identification raises relevance, not acoustic certainty.",
        investigation:
          input.goal === "articulation"
            ? "articulation"
            : input.goal === "dynamics"
              ? "level"
              : "transition",
        graph: "tone",
      });
    }
  }
  if (input.goal === "pitch") {
    const selected = framesIn(pitch.frames, input.interval);
    const reliable = selected.filter((f) => pitchEvidence(f, rules));
    const rejected = selected.length - reliable.length;
    output.nextEvidence = selected.length
      ? `${rejected} of ${selected.length} selected pitch frames lack the feedback engine’s required pitch or harmonic evidence. No eligible sustained offset or drift crossed this goal’s thresholds; small deviations are not labelled mistakes. Try another clear sustained interval, and inspect rejection reasons in Advanced Diagnostics.`
      : output.nextEvidence;
    let region: PitchFrame[] = [];
    const finish = () => {
      if (!region.length) return;
      const interval = { start: region[0].time, end: region.at(-1)!.time };
      const cents = region.map((f) => f.cents!);
      const spread = Math.max(...cents) - Math.min(...cents);
      const third = Math.max(1, Math.floor(cents.length / 3));
      const drift = mean(cents.slice(-third)) - mean(cents.slice(0, third));
      const offset = mean(cents);
      const coverage =
        region.length / Math.max(1, framesIn(pitch.frames, interval).length);
      const qualifies =
        interval.end - interval.start >= rules.minSeconds &&
        coverage >= rules.minPitchCoverage &&
        spread <= rules.maxStablePitchSpreadCents;
      const drifting = Math.abs(drift) >= rules.pitchDriftCents;
      if (qualifies && (drifting || Math.abs(offset) >= rules.pitchOffsetCents))
        add(drifting ? "pitch-drift" : "pitch-offset", {
          title: drifting
            ? "A sustained pitch moves"
            : "Listen against your chosen tuning reference",
          interval,
          relatedIntervals: [],
          observation: drifting
            ? `Across this sustained detected ${region[0].note}, the later pitch averages ${Math.abs(drift).toFixed(1)} cents ${drift < 0 ? "lower" : "higher"} than the earlier pitch.`
            : `This sustained detected ${region[0].note} averages ${Math.abs(offset).toFixed(1)} cents ${offset < 0 ? "below" : "above"} its nearest equal-tempered reference at A4 = 440 Hz.`,
          relevance:
            "Use this passage for listening and tuning awareness against a reference you choose. The app does not know the intended note or tuning system.",
          uncertainty: [
            "No score or verified target is supplied: this cannot establish a wrong note. Instrument tuning, intended inflection, vibrato and glissando are possible explanations, not diagnosed causes.",
            "Only contiguous reliable same-note frames with limited spread are described. Wider motion and note transitions are not graded; overlapping 186 ms windows average rapid variation.",
          ],
          measurements: [
            {
              label: "Mean tracked frequency",
              value: mean(region.map((f) => f.frequency!)),
              unit: "Hz",
            },
            { label: "Mean reference offset", value: offset, unit: "cents" },
            { label: "Last minus first third", value: drift, unit: "cents" },
            { label: "Pitch spread", value: spread, unit: "cents" },
            {
              label: "Pitch standard deviation",
              value: deviation(cents),
              unit: "cents",
            },
          ],
          references: [
            {
              module: "pitch",
              interval,
              detail:
                "Tracked F0; same nearest semitone, required harmonic support and candidate margin; no raw-octave substitutions by the feedback layer.",
            },
          ],
          priority: drifting ? rules.priorities.drift : rules.priorities.offset,
          priorityReason: drifting
            ? "Reliable sustained-note drift exceeds the configured cents threshold."
            : "Reliable sustained-note reference offset exceeds the configured cents threshold.",
          investigation: "pitch",
          graph: "pitch",
        });
      region = [];
    };
    for (const frame of selected) {
      if (
        !pitchEvidence(frame, rules) ||
        (region.length &&
          (frame.note !== region[0].note ||
            frame.time - region.at(-1)!.time >
              (pitch.config.hopSize / pitch.config.sampleRate) * 1.5))
      )
        finish();
      if (pitchEvidence(frame, rules)) region.push(frame);
    }
    finish();
  }
  // Avoid filling the main view with multiple descriptions of the same passage.
  for (const finding of all.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.interval.start - b.interval.start ||
      a.id.localeCompare(b.id),
  )) {
    if (
      output.findings.some((other) => {
        const overlap =
          Math.min(other.interval.end, finding.interval.end) -
          Math.max(other.interval.start, finding.interval.start);
        return (
          overlap >
          0.6 *
            Math.min(
              other.interval.end - other.interval.start,
              finding.interval.end - finding.interval.start,
            )
        );
      })
    )
      continue;
    output.findings.push(finding);
    if (output.findings.length >= rules.maxFindings) break;
  }
  if (output.findings.length) output.insufficient = null;
  else if (input.goal !== "pitch")
    output.nextEvidence =
      "No eligible contrast or transition crossed this goal’s conservative thresholds. This is not a grade: try another interval or compare two clear passages of the same note. Smooth bow changes may have no detectable event.";
  return output;
}
