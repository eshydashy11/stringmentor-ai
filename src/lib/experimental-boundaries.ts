import FFT from "fft.js";
import { CELLO_CONFIG, type PitchResult } from "./pitch.ts";
import { median, type ToneResult } from "./tone.ts";

export type BoundaryProposal = {
  centreSample: number;
  startSample: number;
  endSample: number;
  cues: string[];
  lowFlux: number;
  highFlux: number;
  envelopeChangeDb: number;
  threshold: number;
};
/** Experimental acoustic boundaries, never verified note onsets or bow reversals. */
export function experimentalBoundaries(
  samples: Float32Array,
  standard: PitchResult,
  tone?: ToneResult,
): BoundaryProposal[] {
  const n = 1024,
    hop = 256,
    sr = CELLO_CONFIG.sampleRate;
  const fft = new FFT(n),
    input = new Float64Array(n),
    output = fft.createComplexArray();
  const hann = Float64Array.from(
    { length: n },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)),
  );
  const rows: {
    centreSample: number;
    lowFlux: number;
    highFlux: number;
    db: number;
    active: boolean;
  }[] = [];
  let previous: number[][] | null = null;
  for (let offset = 0; offset + n <= samples.length; offset += hop) {
    let dc = 0,
      energy = 0;
    for (let i = 0; i < n; i++) dc += samples[offset + i];
    dc /= n;
    for (let i = 0; i < n; i++) {
      const v = samples[offset + i] - dc;
      input[i] = v * hann[i];
      energy += v * v;
    }
    const rms = Math.sqrt(energy / n),
      active = rms >= CELLO_CONFIG.minRms;
    fft.realTransform(output, input);
    const bands: number[][] = [[], []];
    for (let k = 3; (k * sr) / n <= 3000; k++)
      bands[(k * sr) / n < 500 ? 0 : 1].push(
        Math.hypot(output[2 * k], output[2 * k + 1]),
      );
    for (const band of bands) {
      const sum = band.reduce((a, b) => a + b, 0);
      for (let k = 0; k < band.length; k++) band[k] /= Math.max(sum, 1e-20);
    }
    const flux = bands.map((band, b) =>
      active && previous
        ? band.reduce((sum, v, k) => sum + Math.max(0, v - previous![b][k]), 0)
        : 0,
    );
    rows.push({
      centreSample: offset + n / 2,
      lowFlux: flux[0],
      highFlux: flux[1],
      db: 20 * Math.log10(Math.max(rms, 1e-6)),
      active,
    });
    previous = active ? bands : null;
  }
  const proposals: BoundaryProposal[] = [];
  for (let i = 2; i < rows.length - 2; i++) {
    const row = rows[i];
    if (!row.active) continue;
    const strength = Math.max(row.lowFlux, row.highFlux);
    const background = rows
      .slice(Math.max(0, i - 12), Math.min(rows.length, i + 13))
      .map((r) => Math.max(r.lowFlux, r.highFlux));
    const mid = median(background),
      mad = median(background.map((f) => Math.abs(f - mid)));
    const threshold = Math.max(0.08, mid + 0.5 * mad);
    const peak =
      strength >= Math.max(rows[i - 1].lowFlux, rows[i - 1].highFlux) &&
      strength > Math.max(rows[i + 1].lowFlux, rows[i + 1].highFlux);
    const envelopeChangeDb = rows[i + 1].db - rows[i - 1].db;
    const cues: string[] = [];
    if (peak && strength >= threshold)
      cues.push("local multiband spectral change");
    if (
      Math.abs(envelopeChangeDb) >= 4 &&
      Math.abs(envelopeChangeDb) >= Math.abs(rows[i].db - rows[i - 2].db) &&
      Math.abs(envelopeChangeDb) > Math.abs(rows[i + 2].db - rows[i].db)
    )
      cues.push("envelope transition");
    if (!cues.length) continue;
    const pi = Math.round((row.centreSample - 2048) / 512);
    const before = standard.frames[pi - 1]?.diagnostics?.candidates[0],
      after = standard.frames[pi + 1]?.diagnostics?.candidates[0];
    if (
      before &&
      after &&
      before.support >= 0.65 &&
      after.support >= 0.65 &&
      Math.abs(1200 * Math.log2(before.frequency / after.frequency)) >= 90
    )
      cues.push("changing harmonic candidate (unverified)");
    const ti = Math.round((row.centreSample - 1024) / 256);
    if ((tone?.frames[ti]?.flux ?? 0) >= (tone?.fluxThreshold ?? Infinity))
      cues.push("Phase 2B spectral flux");
    proposals.push({
      centreSample: row.centreSample,
      startSample: row.centreSample - 256,
      endSample: row.centreSample + 256,
      cues,
      lowFlux: row.lowFlux,
      highFlux: row.highFlux,
      envelopeChangeDb,
      threshold,
    });
  }
  // 35 ms suppression is independent of the sparse 250 ms articulation-event list.
  const kept: BoundaryProposal[] = [];
  for (const p of proposals.sort(
    (a, b) => Math.max(b.lowFlux, b.highFlux) - Math.max(a.lowFlux, a.highFlux),
  ))
    if (
      kept.every((k) => Math.abs(k.centreSample - p.centreSample) >= sr * 0.035)
    )
      kept.push(p);
  return kept.sort((a, b) => a.centreSample - b.centreSample);
}
