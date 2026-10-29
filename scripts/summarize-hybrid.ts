import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  scoreAligned,
  transitionResponse,
  type AlignedCase,
} from "./crepe/metrics.ts";
import {
  HYBRID_POLICY,
  type HybridDecision,
  type HybridResult,
} from "../src/lib/hybrid-pitch.ts";
const root = "work/hybrid";
const manifestBytes = readFileSync(`${root}/manifest.json`);
const manifest = JSON.parse(manifestBytes.toString()) as {
  policySha256: string;
  cases: AlignedCase[];
  unavailable: string[];
};
type Row = {
  id: string;
  standard: (number | null)[];
  experimental: (number | null)[];
  hybrid: (number | null)[];
  decisions: HybridDecision[];
  stats: HybridResult["stats"];
  timing: HybridResult["timing"];
  wallMs: number;
  standardMs: number;
  experimentalAdditionalMs: number;
};
const corpus = JSON.parse(
  readFileSync(`${root}/browser-corpus.json`, "utf8"),
) as {
  completed: boolean;
  buildId: string;
  sourceHashes: Record<string, string>;
  manifestSha256: string;
  policySha256: string;
  environment: unknown;
  parity: unknown;
  cases: Row[];
};
const ui = JSON.parse(readFileSync(`${root}/browser-ui.json`, "utf8"));
assert.equal(corpus.completed, true);
for (const [path, expected] of Object.entries(corpus.sourceHashes))
  assert.equal(
    createHash("sha256").update(readFileSync(path)).digest("hex"),
    expected,
    `Source changed since browser validation: ${path}`,
  );
const preservation = JSON.parse(
  readFileSync(`${root}/preservation.json`, "utf8"),
);
assert.equal(preservation.status, "passed");
assert.equal(ui.status, "passed");
assert.equal(
  corpus.manifestSha256,
  createHash("sha256").update(manifestBytes).digest("hex"),
);
assert.equal(
  corpus.policySha256,
  createHash("sha256").update(JSON.stringify(HYBRID_POLICY)).digest("hex"),
);
assert.equal(corpus.cases.length, manifest.cases.length);
const methods = ["standard", "experimental", "hybrid"] as const;
const newRecovery = (row: Row, c: AlignedCase) => {
  let correct = 0,
    wrong = 0,
    unlabelled = 0,
    neuralCorrect = 0,
    neuralWrong = 0;
  row.hybrid.forEach((f, i) => {
    if (row.standard[i] !== null || f === null) return;
    const target = c.targets[i];
    if (target === null) {
      unlabelled++;
      return;
    }
    if (Math.abs(1200 * Math.log2(f / target)) <= 50) {
      correct++;
      if (row.decisions[i].source === "crepe-tiny") neuralCorrect++;
    } else {
      wrong++;
      if (row.decisions[i].source === "crepe-tiny") neuralWrong++;
    }
  });
  return { correct, wrong, unlabelled, neuralCorrect, neuralWrong };
};
const results = corpus.cases.map((row) => {
  const c = manifest.cases.find((c) => c.id === row.id)!;
  assert.ok(c);
  assert.equal(row.hybrid.length, c.targets.length);
  row.standard.forEach((f, i) => {
    if (f !== null)
      assert.equal(row.hybrid[i], f, `${c.id} protected Standard ${i}`);
  });
  return {
    id: c.id,
    group: c.group,
    texture: c.texture,
    duration: c.duration,
    pcmSha256: c.pcmSha256,
    sourceHash: c.sourceHash,
    frames: c.targets.length,
    methods: Object.fromEntries(
      methods.map((m) => [
        m,
        {
          usable: row[m].filter((f) => f !== null).length,
          labelled: c.targets.some((t) => t !== null)
            ? scoreAligned(row[m], c.targets)
            : null,
          transitions:
            c.notes.length && c.group !== "real-labelled"
              ? transitionResponse(c.times, row[m], c.notes)
              : null,
        },
      ]),
    ),
    newlyAccepted: newRecovery(row, c),
    stats: row.stats,
    timing: row.timing,
    wallMs: row.wallMs,
    reasons: row.decisions
      .filter((d) => d.frequency === null)
      .reduce<Record<string, number>>((counts, d) => {
        for (const reason of d.failed)
          counts[reason] = (counts[reason] ?? 0) + 1;
        return counts;
      }, {}),
  };
});
const aggregate = (group: string) => {
  const selected = corpus.cases.filter((row) => {
    const c = manifest.cases.find((c) => c.id === row.id)!;
    return c.group === group;
  });
  return Object.fromEntries(
    methods.map((m) => [
      m,
      scoreAligned(
        selected.flatMap((row) => row[m]),
        selected.flatMap(
          (row) => manifest.cases.find((c) => c.id === row.id)!.targets,
        ),
      ),
    ]),
  );
};
const v1 = corpus.cases.find((c) => c.id === "open-strings-v1")!,
  v1labels = manifest.cases.find((c) => c.id === v1.id)!;
const real = scoreAligned(v1.hybrid, v1labels.targets);
assert.equal(
  real.wrong,
  0,
  "Mandatory open-string regression must not add wrong notes",
);
assert.ok(real.correct >= 452);
const realRegions = v1labels.notes.map((n) => ({
  start: n.start,
  end: n.end,
  target: n.frequency,
  ...Object.fromEntries(
    methods.map((m) => [
      m,
      scoreAligned(
        v1[m],
        v1labels.times.map((t) =>
          t >= n.start && t < n.end ? n.frequency : null,
        ),
      ),
    ]),
  ),
}));
assert.equal(
  results.reduce((s, r) => s + r.newlyAccepted.wrong, 0),
  0,
  "Newly accepted labelled errors block release",
);
const newSet = results.filter((r) => r.group === "new-held-out");
assert.equal(
  newSet.reduce((s, r) => s + r.newlyAccepted.wrong, 0),
  0,
  "New held-out set introduced wrong accepted estimates; block release",
);
assert.equal(results.find((r) => r.id === "silence")!.methods.hybrid.usable, 0);
assert.equal(results.find((r) => r.id === "noise")!.methods.hybrid.usable, 0);
const output = {
  version: 1,
  createdAt: new Date().toISOString(),
  policy: HYBRID_POLICY,
  policySha256: corpus.policySha256,
  protocol: {
    correctToleranceCents: 50,
    standardWindow: 4096,
    hop: 512,
    sampleRate: 22050,
    crepeRate: 16000,
    crepeWindow: 1024,
    backend: "Production browser worker / ONNX WASM SIMD one thread",
    resampler: "64-tap Blackman sinc 7.2kHz cutoff; same JS path as production",
    newHeldOutSeeds: [4507, 5701, 6359, 7559],
    accuracyWarning:
      "Nominal V1 sustained-region labels validate note identity, not cent-accurate F0; V2/Bach have no independent F0 labels.",
  },
  model: {
    sha256: "ca2c743a77f1ca69b80f2e5ed43b14fbd5b3121ad9e0556497d487f07a1d33eb",
    bytes: 1963212,
    runtime: "onnxruntime-web 1.22.0",
  },
  buildId: corpus.buildId,
  sourceHashes: corpus.sourceHashes,
  preservation,
  environment: corpus.environment,
  activationParity: corpus.parity,
  ui,
  aggregate: Object.fromEntries(
    ["prior-synthetic", "crossover", "new-held-out", "real-labelled"].map(
      (g) => [g, aggregate(g)],
    ),
  ),
  realRegions,
  cases: results,
  unavailable: manifest.unavailable,
  limitations: [
    "All accepted Standard estimates are retained, including its known errors.",
    "Synthetic oscillators and a single real labelled recording do not establish musical generalisation.",
    "Shared-host wall timings include fresh worker model initialisation; no phone speed claim.",
    "Full remains offline; no Full hybrid mode was exposed.",
  ],
};
mkdirSync("docs/data/hybrid-crepe", { recursive: true });
writeFileSync(
  "docs/data/hybrid-crepe/results.json",
  JSON.stringify(output, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      aggregate: output.aggregate,
      realRegions,
      newlyAccepted: results.map((r) => ({ id: r.id, ...r.newlyAccepted })),
    },
    null,
    2,
  ),
);
