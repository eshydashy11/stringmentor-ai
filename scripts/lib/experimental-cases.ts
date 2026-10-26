import { makeSequence, hz, type SignalCase } from "./fast-pitch-audit.ts";

/** Evaluation-only seeds/configurations, frozen before inspecting adaptive results. */
export function heldOutCases(
  seeds = [701, 809, 997, 1237],
  durations = [0.135, 0.085],
): SignalCase[] {
  return seeds.map((seedValue, variant) => {
    let seed = seedValue;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const notes = Array.from({ length: 18 }, (_, i) => ({
      start: i * durations[variant % 2],
      end: (i + 1) * durations[variant % 2],
      frequency: hz(38 + Math.floor(random() * 26) + (random() - 0.5) * 0.2),
    }));
    const samples = new Float32Array(Math.ceil(notes.at(-1)!.end * 22050));
    for (const note of notes) {
      const phase = random() * Math.PI * 2,
        decay = variant >= 2 ? 0.06 : 0;
      for (
        let i = Math.ceil(note.start * 22050);
        i < Math.min(samples.length, Math.ceil((note.end + decay * 3) * 22050));
        i++
      ) {
        const t = i / 22050 - note.start,
          duration = note.end - note.start;
        const envelope =
          Math.min(1, t / 0.006) *
          (t < duration
            ? 1
            : Math.exp(-(t - duration) / Math.max(0.001, decay)));
        let value = 0;
        for (let h = 1; h <= 10; h++)
          value +=
            (h === 1 && variant === 1 ? 0.12 : 1 / h ** 1.35) *
            Math.sin(2 * Math.PI * h * note.frequency * t + phase * h);
        samples[i] += 0.16 * envelope * value;
      }
    }
    return {
      id: `held-out-${seedValue}`,
      samples,
      notes,
      texture:
        variant >= 2
          ? "overlap"
          : variant === 1
            ? "weak-fundamental"
            : "legato",
    };
  });
}
export function extraCases(): SignalCase[] {
  const cases = [36, 43, 50, 57].map((m) =>
    makeSequence(`sustain-${m}`, [m], 1, "clean", 1),
  );
  cases.push(makeSequence("true-octaves", [43, 55, 43, 55], 0.2));
  cases.push(makeSequence("repeated-notes", [50, 50, 50, 50], 0.125));
  for (const motion of ["vibrato", "glissando"]) {
    let phase = 0;
    const samples = Float32Array.from({ length: 44100 }, (_, i) => {
      const t = i / 22050,
        f =
          motion === "vibrato"
            ? hz(50) * 2 ** ((35 * Math.sin(2 * Math.PI * 5 * t)) / 1200)
            : hz(43 + (9 * t) / 2);
      phase += (2 * Math.PI * f) / 22050;
      return (
        0.15 *
        (Math.sin(phase) +
          0.5 * Math.sin(2 * phase) +
          0.3 * Math.sin(3 * phase))
      );
    });
    // Per-sample reference for motion; evaluator samples this at frame centres.
    const notes = Array.from({ length: samples.length }, (_, i) => ({
      start: i / 22050,
      end: (i + 1) / 22050,
      frequency:
        motion === "vibrato"
          ? hz(50) *
            2 ** ((35 * Math.sin((2 * Math.PI * 5 * i) / 22050)) / 1200)
          : hz(43 + (9 * i) / samples.length),
    }));
    cases.push({ id: motion, samples, notes, texture: "continuous-motion" });
  }
  let seed = 4242;
  for (const kind of ["silence", "noise"])
    cases.push({
      id: kind,
      notes: [],
      texture: "unpitched",
      samples: Float32Array.from({ length: 22050 }, () => {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return kind === "silence" ? 0 : (seed / 2 ** 31 - 1) * 0.1;
      }),
    });
  return cases;
}

/** Frozen Phase 2D.2B evaluation set; do not tune parameters after viewing results. */
export function heldOutRecoveryCases(): SignalCase[] {
  return heldOutCases([1601, 1777, 2029, 2411], [0.115, 0.095]);
}
