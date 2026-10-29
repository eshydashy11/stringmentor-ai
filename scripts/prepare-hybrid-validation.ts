/** Freeze inputs and labels before evaluating Hybrid Tiny. No label enters production code. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mixToMono } from "../src/lib/pitch.ts";
import { createHash } from "node:crypto";
import { syntheticCases, makeSequence } from "./lib/fast-pitch-audit.ts";
import {
  extraCases,
  heldOutCases,
  heldOutRecoveryCases,
} from "./lib/experimental-cases.ts";
import { HYBRID_POLICY } from "../src/lib/hybrid-pitch.ts";
import type { AlignedCase } from "./crepe/metrics.ts";
const root = "work/hybrid";
mkdirSync(root, { recursive: true });
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const signals = [
  ...syntheticCases(),
  ...extraCases(),
  ...heldOutCases(),
  ...heldOutRecoveryCases(),
  ...[47, 48, 49, 50, 51].map((m) =>
    makeSequence(`crossover-held-${m}`, [m], 0.7, "clean", 1),
  ),
  makeSequence("crossover-fast", [47, 48, 49, 50, 51, 50, 49, 48], 0.1),
  makeSequence("crossover-weak", [48, 49, 50], 0.25, "weak-fundamental"),
  // New seeds fixed before viewing any hybrid predictions; not reused for policy tuning.
  ...heldOutCases([4507, 5701, 6359, 7559], [0.105, 0.075]).map((s) => ({
    ...s,
    id: `hybrid-${s.id}`,
  })),
];
const cases = signals.map((s) => {
  const centres = Array.from(
    { length: Math.max(0, Math.floor((s.samples.length - 4096) / 512) + 1) },
    (_, i) => 2048 + i * 512,
  );
  writeFileSync(`${root}/${s.id}.f32`, Buffer.from(s.samples.buffer));
  const targets = centres.map(
    (c) =>
      s.notes.find((n) => c / 22050 >= n.start && c / 22050 < n.end)
        ?.frequency ?? null,
  );
  return {
    id: s.id,
    group: s.id.startsWith("hybrid-held")
      ? "new-held-out"
      : s.id.startsWith("crossover")
        ? "crossover"
        : "prior-synthetic",
    texture: s.texture,
    duration: s.samples.length / 22050,
    centres,
    times: centres.map((c) => c / 22050),
    targets,
    notes: s.texture === "continuous-motion" ? [] : s.notes,
    pcmSha256: hash(Buffer.from(s.samples.buffer)),
    sourceHash: null,
    rms: [],
    path: `${root}/${s.id}.f32`,
  };
});
// Private PCM from the reproducible CREPE benchmark, hashes verified, same labelled regions.
const manifest = existsSync("work/crepe/run/manifest.json")
  ? JSON.parse(readFileSync("work/crepe/run/manifest.json", "utf8"))
  : { cases: [] };
const privateInputs = [
  [
    "open-strings-v1",
    "STRINGMENTOR_CELLO_SAMPLE_PATH",
    "6da88d0b66109e476222d85b1334b53b8e183f99d1de44a1bb70c17e556e07fc",
  ],
  [
    "open-strings-v2",
    "STRINGMENTOR_CELLO_V2_PATH",
    "480019bc9d5d409167bc5723ff95e32552e835ce601a079b344f0984efd121a6",
  ],
  [
    "bach",
    "STRINGMENTOR_BACH_PATH",
    "109a8bf5d75dc11f3bc80bba170c4d1f27a14ec3999fa30bdcbba478b61c2082",
  ],
];
for (const [id, key, expectedHash] of privateInputs) {
  const source = process.env[key];
  if (!source) continue;
  const sourceHash = hash(readFileSync(source));
  if (sourceHash !== expectedHash)
    throw new Error(`Unexpected original audio hash: ${id}`);
  const bytes = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      source,
      "-ar",
      "22050",
      "-ac",
      "2",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const data = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const channels = [
    new Float32Array(data.length / 2),
    new Float32Array(data.length / 2),
  ];
  channels.forEach((c, k) => {
    for (let i = 0; i < c.length; i++) c[i] = data[i * 2 + k];
  });
  const mono = mixToMono(channels),
    pcm = Buffer.from(mono.buffer);
  const notes =
    id === "open-strings-v1"
      ? [
          { start: 1.4, end: 4.2, frequency: 65.40639132514966 },
          { start: 4.6, end: 7.5, frequency: 97.99885899543733 },
          { start: 7.9, end: 10.6, frequency: 146.8323839587038 },
          { start: 11.3, end: 13.7, frequency: 220 },
        ]
      : [];
  const centres = Array.from(
      { length: Math.max(0, Math.floor((mono.length - 4096) / 512) + 1) },
      (_, i) => 2048 + i * 512,
    ),
    times = centres.map((c) => c / 22050);
  const path = `${root}/${id}.f32`;
  writeFileSync(path, pcm);
  manifest.cases = manifest.cases.filter((c: AlignedCase) => c.id !== id);
  manifest.cases.push({
    id,
    sourceHash,
    pcmSha256: hash(pcm),
    path,
    notes,
    centres,
    times,
    targets: times.map(
      (t) => notes.find((n) => t >= n.start && t < n.end)?.frequency ?? null,
    ),
    duration: mono.length / 22050,
    texture: "real",
    rms: [],
  });
}
for (const id of ["open-strings-v1", "open-strings-v2", "bach"]) {
  const c = manifest.cases.find((v: AlignedCase) => v.id === id);
  if (!c) {
    if (id === "open-strings-v1")
      throw new Error(
        "Mandatory C2 regression is missing. Run benchmark:crepe preparation with the original audio first.",
      );
    continue;
  }
  const path = c.path ?? `work/crepe/run/${c.pcmFile}`,
    bytes = readFileSync(path);
  if (hash(bytes) !== c.pcmSha256) throw new Error(`Corrupt PCM: ${id}`);
  cases.push({
    ...c,
    path,
    group: id === "open-strings-v1" ? "real-labelled" : "real-unlabelled",
  });
}
writeFileSync(
  `${root}/manifest.json`,
  JSON.stringify(
    {
      schema: 1,
      policy: HYBRID_POLICY,
      policySha256: hash(JSON.stringify(HYBRID_POLICY)),
      cases,
      unavailable: [
        "Beethoven audio",
        "physical mobile and Safari devices",
        "independently annotated V2/Bach F0",
      ],
    },
    null,
    2,
  ),
);
console.log(
  `Prepared ${cases.length} cases; new held-out seeds fixed at 4507/5701/6359/7559.`,
);
