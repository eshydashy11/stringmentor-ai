import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  analysePitch,
  CELLO_CONFIG,
  frequencyToPitch,
} from "../src/lib/pitch.ts";
import {
  trackCandidates,
  type PitchCandidate,
  type CandidateFrame,
} from "../src/lib/pitch-candidates.ts";
const rate = CELLO_CONFIG.sampleRate;
function signal(
  seconds: number,
  frequency: (t: number) => number,
  harmonics: number[],
  interferers: [number, number][] = [],
) {
  let phase = 0;
  return Float32Array.from({ length: Math.floor(rate * seconds) }, (_, i) => {
    const t = i / rate;
    phase += (2 * Math.PI * frequency(t)) / rate;
    return (
      0.15 *
      (harmonics.reduce(
        (sum, amplitude, h) =>
          sum + amplitude * Math.sin((h + 1) * phase + h * 0.31),
        0,
      ) +
        interferers.reduce(
          (sum, [hz, amplitude]) =>
            sum + amplitude * Math.sin(2 * Math.PI * hz * t),
          0,
        ))
    );
  });
}
function candidate(frequency: number, score: number): PitchCandidate {
  return {
    frequency,
    score,
    support: 0.9,
    periodicity: 0.95,
    primitive: true,
    harmonics: [1, 2, 3],
  };
}
test("neighbours resolve close choices but cannot force weak frames or override clear note changes", () => {
  const strong: CandidateFrame = {
    quiet: false,
    candidates: [candidate(170, 0.9), candidate(340, 0.65)],
  };
  const close: CandidateFrame = {
    quiet: false,
    candidates: [candidate(170, 0.72), candidate(340, 0.7)],
  };
  assert.equal(trackCandidates([close], CELLO_CONFIG)[0].reason, "ambiguous");
  const resolved = trackCandidates(
    [strong, strong, strong, close, strong, strong, strong],
    CELLO_CONFIG,
  )[3];
  assert.equal(resolved.candidate?.frequency, 170);
  assert.equal(resolved.reason, "neighbours");
  const leap = {
    quiet: false,
    candidates: [candidate(340, 0.9), candidate(170, 0.65)],
  };
  assert.equal(
    trackCandidates(
      [strong, strong, strong, leap, strong, strong, strong],
      CELLO_CONFIG,
    )[3].candidate?.frequency,
    340,
  );
  const unsupportedLeader = {
    quiet: false,
    candidates: [
      { ...candidate(340, 0.95), periodicity: 0.1 },
      candidate(170, 0.7),
    ],
  };
  assert.equal(
    trackCandidates([unsupportedLeader], CELLO_CONFIG)[0].reason,
    "weak-evidence",
    "An ineligible leader is not a close-score ambiguity",
  );
  const weak = { quiet: false, candidates: [candidate(170, 0.5)] };
  assert.equal(
    trackCandidates(
      [strong, strong, strong, weak, strong, strong, strong],
      CELLO_CONFIG,
    )[3].candidate,
    undefined,
  );
  assert.equal(
    trackCandidates(
      [{ quiet: true, candidates: strong.candidates }],
      CELLO_CONFIG,
    )[0].reason,
    "silence",
  );
  assert.equal(
    trackCandidates(
      [
        {
          quiet: false,
          candidates: [
            { ...candidate(800, 0.9), primitive: false, harmonics: [2] },
          ],
        },
      ],
      CELLO_CONFIG,
    )[0].candidate,
    undefined,
  );
});
test("dominant thirds and unrelated interfering tones do not dictate the fundamental", (t) => {
  // Different frequencies from the supplied recording; no open-string sequence.
  const cases = [
    {
      name: "dominant-third",
      hz: 82.4,
      harmonics: [0.02, 0.02, 1, 0.08, 0.1, 0.35, 0.08],
      noise: [],
    },
    {
      name: "competing-periods",
      hz: 164.8,
      harmonics: [0.7, 0.2, 0.6, 0, 0.1, 0, 0, 0.1],
      noise: [[220.1, 0.4]],
    },
    {
      name: "low-frequency-interference",
      hz: 246.9,
      harmonics: [0.8, 1, 0.05, 0, 0.4, 0.5, 0, 0.6],
      noise: [
        [110, 0.22],
        [135, 0.22],
      ],
    },
  ];
  for (const c of cases) {
    const result = analysePitch(
      signal(1.2, () => c.hz, c.harmonics, c.noise as [number, number][]),
    );
    const errors = result.frames
      .filter((f) => f.frequency !== null)
      .map((f) => Math.abs(1200 * Math.log2(f.frequency! / c.hz)));
    assert.ok(result.coverage >= 0.9, `${c.name}: coverage ${result.coverage}`);
    assert.ok(
      Math.max(...errors) < 5,
      `${c.name}: error ${Math.max(...errors)} cents`,
    );
    t.diagnostic(
      `${c.name}: max error ${Math.max(...errors).toFixed(3)} cents; coverage ${(100 * result.coverage).toFixed(1)}%`,
    );
  }
});
test("a genuine brief octave change is retained when its acoustic evidence is clear", () => {
  const result = analysePitch(
    signal(2.4, (t) => (t >= 0.9 && t < 1.3 ? 330 : 165), [1, 0.6, 0.3]),
  );
  const centre = result.frames.filter((f) => f.time > 1.01 && f.time < 1.19);
  assert.ok(centre.length >= 5);
  assert.ok(
    centre.every(
      (f) =>
        f.frequency !== null &&
        Math.abs(1200 * Math.log2(f.frequency / 330)) < 5,
    ),
  );
  for (const frame of result.frames.filter(
    (f) => f.time < 0.75 || f.time > 1.5,
  ))
    assert.ok(
      frame.frequency !== null &&
        Math.abs(1200 * Math.log2(frame.frequency / 165)) < 5,
    );
});
test("glissandi and vibrato remain continuous measured trajectories, without note snapping", (t) => {
  for (const kind of ["glissando", "vibrato"]) {
    const hz = (time: number) =>
      kind === "glissando"
        ? 145 * 2 ** ((time * 160) / 1200)
        : 165 * 2 ** ((30 * Math.sin(2 * Math.PI * 5 * time)) / 1200);
    const result = analysePitch(signal(2.5, hz, [1, 0.6, 0.3]));
    const valid = result.frames.filter((f) => f.frequency !== null);
    const max = Math.max(
      ...valid.map((f) =>
        Math.abs(1200 * Math.log2(f.frequency! / hz(f.time))),
      ),
    );
    assert.ok(result.coverage > 0.9, `${kind} coverage ${result.coverage}`);
    assert.ok(max < (kind === "glissando" ? 10 : 25), `${kind} error ${max}`);
    if (kind === "vibrato") {
      const cents = valid.map((f) => 1200 * Math.log2(f.frequency! / 165));
      assert.ok(
        Math.max(...cents) - Math.min(...cents) > 30,
        "Measured modulation must not be flattened",
      );
    }
    assert.ok(
      valid.some((f) => Math.abs(f.midi! - Math.round(f.midi!)) > 0.05),
    );
    t.diagnostic(
      `${kind}: max centre-frequency difference ${max.toFixed(3)} cents; coverage ${(100 * result.coverage).toFixed(1)}%. Windows temporally average the signal.`,
    );
  }
});
test("actual recording candidate fixtures retain C2, D3 and A3 corrections without using labels in tracking", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/cello-candidates.json", import.meta.url),
      "utf8",
    ),
  ) as {
    cases: {
      name: string;
      frames: CandidateFrame[];
      centre: number;
      expectedNote: string;
    }[];
  };
  for (const example of fixture.cases) {
    const decision = trackCandidates(example.frames, CELLO_CONFIG)[
      example.centre
    ];
    assert.ok(decision.candidate, example.name);
    assert.equal(
      frequencyToPitch(decision.candidate.frequency).note,
      example.expectedNote,
      example.name,
    );
  }
});
