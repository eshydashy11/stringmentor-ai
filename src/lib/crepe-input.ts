/** CREPE's official 360-bin local-average decoder (MIT; public/models/NOTICE). */
export type NeuralEstimate = {
  frequency: number | null;
  confidence: number;
  peaks: { frequency: number; activation: number }[];
};
export function decodeCrepe(activation: Float32Array): NeuralEstimate {
  // WASM SIMD sigmoid can undershoot zero by one float32 rounding step
  // (observed -5.96e-8). Clamp numerical roundoff only; fail on invalid tensors.
  if (
    activation.length !== 360 ||
    activation.some((x) => !Number.isFinite(x) || x < -1e-6 || x > 1 + 1e-6)
  )
    throw new Error("CREPE returned invalid activations.");
  activation = activation.map((x) => Math.max(0, Math.min(1, x)));
  const hz = (bin: number) =>
    10 * 2 ** ((bin * 20 + 1997.3794084376191) / 1200);
  let best = 0;
  for (let i = 1; i < 360; i++) if (activation[i] > activation[best]) best = i;
  let sum = 0,
    cents = 0;
  for (let i = Math.max(0, best - 4); i <= Math.min(359, best + 4); i++) {
    sum += activation[i];
    cents += activation[i] * (i * 20 + 1997.3794084376191);
  }
  const peaks = Array.from(activation, (a, i) => ({
    frequency: hz(i),
    activation: a,
    i,
  }))
    .filter(
      ({ activation: a, i }) =>
        a > 0 &&
        a >= (activation[i - 1] ?? -1) &&
        a > (activation[i + 1] ?? -1),
    )
    .sort((a, b) => b.activation - a.activation)
    .slice(0, 3)
    .map(({ frequency, activation }) => ({ frequency, activation }));
  return {
    frequency: sum ? 10 * 2 ** (cents / sum / 1200) : null,
    confidence: activation[best],
    peaks,
  };
}

/** Fixed 64-tap Blackman-windowed sinc, 7.2 kHz cutoff, 320 rational phases.
 * Offline resampling only: no pitch or label information enters this operation.
 * Unlike the Python benchmark this is not resampy's Kaiser-best filter.
 */
export function resampleForCrepe(input: Float32Array): Float32Array {
  if (input.some((v) => !Number.isFinite(v)))
    throw new Error("Invalid audio samples for CREPE.");
  const phases = Array.from({ length: 320 }, (_, phase) => {
    const coefficients = new Float64Array(64);
    let sum = 0;
    for (let k = 0; k < 64; k++) {
      const x = k - 31 - phase / 320;
      const z = ((2 * 7200) / 22050) * x;
      const sinc = z === 0 ? 1 : Math.sin(Math.PI * z) / (Math.PI * z);
      const window =
        0.42 +
        0.5 * Math.cos((Math.PI * x) / 32) +
        0.08 * Math.cos((2 * Math.PI * x) / 32);
      coefficients[k] = sinc * window;
      sum += coefficients[k];
    }
    return coefficients.map((v) => v / sum);
  });
  const output = new Float32Array(Math.floor((input.length * 16000) / 22050));
  for (let j = 0; j < output.length; j++) {
    const numerator = j * 441,
      base = Math.floor(numerator / 320),
      weights = phases[numerator % 320];
    let value = 0;
    for (let k = 0; k < 64; k++)
      value += (input[base + k - 31] ?? 0) * weights[k];
    if (!Number.isFinite(value))
      throw new Error("Invalid audio samples for CREPE.");
    output[j] = value;
  }
  return output;
}
export function crepeWindow(
  audio: Float32Array,
  centre22050: number,
): Float32Array {
  const centre = Math.round((centre22050 * 16000) / 22050);
  if (centre < 512 || centre + 512 > audio.length)
    throw new Error("CREPE timestamp is outside the decoded audio.");
  const frame = audio.slice(centre - 512, centre + 512);
  let mean = 0,
    variance = 0;
  for (const x of frame) mean += x;
  mean /= 1024;
  for (let i = 0; i < 1024; i++) {
    frame[i] -= mean;
    variance += frame[i] ** 2;
  }
  const std = Math.max(1e-8, Math.sqrt(variance / 1024));
  for (let i = 0; i < 1024; i++) frame[i] /= std;
  return frame;
}
