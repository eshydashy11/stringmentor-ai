# Phase 2E — Guarded Hybrid CREPE Tiny

Date: 29 October 2026. Policy version: **2E.1**. Status: **validated for opt-in Advanced Diagnostics on the tested desktop Chromium build**, not a replacement for Standard or Practice Mentor. [Numerical results](data/hybrid-crepe/results.json).

## Release decision and scope

The website now has a functional **Hybrid Tiny — guarded CREPE comparison** option in Advanced Diagnostics. It loads the verified model, analyses the loaded recording locally in the existing worker, reports progress, displays the selected trajectory with a Standard overlay, supports cancellation and timestamp seeking, and exports per-frame evidence. Standard remains the default. Practice Mentor, Explore, tone analysis, recording, playlists, settings and storage retain their existing paths. There is no audio upload to a server or AI service.

This is a deliberately conservative release: all accepted Standard estimates are protected. That protects validated low strings, but **also preserves known Standard mistakes**. On the prior synthetic suite, Hybrid has four more correct measurements than Experimental but **12 more wrong measurements**, inherited from Standard where Experimental withholds or changes an estimate. Hybrid is not uniformly more accurate than Experimental. The small incremental Tiny recovery does not justify a production-default or Mentor change.

Full is **not exposed as a browser button**. The verified Full model remains in the [offline benchmark workflow](crepe-benchmark.md), including its existing browser CPU feasibility measurements. Its approximately 89 MB FP32 model and large measured compute/memory cost are not required by this release. No new Full hybrid, WebGPU, Safari, or physical-phone result is claimed.

## Policy and scientific constraints

`src/lib/hybrid-pitch.ts` is the standalone selection module. Its version and complete configurable policy are exported with results. No note labels, expected strings, score, previous hybrid output, or recording identity enter selection.

1. Keep an accepted Standard frequency unchanged at every register. Record any neural disagreement and harmonic relation separately; neural activation cannot overwrite it.
2. Where Standard withholds, retain an existing Experimental recovery only when CREPE has no eligible estimate or agrees within 35 cents. An eligible CREPE estimate uses finite, in-range 55–1000 Hz output and activation at least 0.50. Disputed recovery remains withheld.
3. A new Tiny recovery must have frequency at least 131 Hz, activation at least 0.80, and a matching **current 2048-sample** primitive spectral candidate within 35 cents. Candidate gates: support ≥0.75, periodicity ≥0.75, score ≥0.65, raw margin ≥0.04 and at least six cycles. Between 131 and 147 Hz, activation ≥0.85 and spectral support ≥0.80 are required. These are provisional engineering gates, not learned or calibrated accuracy probabilities.
4. Search the retained 4096/2048/1024 acoustic candidates for competing primitive harmonic families. Integer ratios 2–6 within 45 cents, support ≥0.55, periodicity ≥0.50, score ≥0.50 and at least two supported partials veto a new neural recovery. This checks lower fundamentals even when CREPE predicts high: a confident ~196 Hz candidate cannot bypass supported ~65 Hz evidence merely by being above a crossover. The candidate list is finite, so absence of a veto does not prove absence of interference.
5. Require raw neural corroboration on both sides within two 512-sample hops (±46.4 ms), within 60 cents, with activation ≥0.80 and audible amplitude. Do not cross existing supported segment barriers. Withhold in boundary uncertainty intervals. These neighbours are not recovered outputs, and neither they nor the spectral/model evidence are statistically independent: they share overlapping audio.
6. Never average conflicting pitches, interpolate gaps, quantise to notes or constrain to the nearest previous pitch. Standard vibrato/glissando/leap measurements stay unchanged. Fast transitions can remain missing when bounded corroboration is unavailable. Acoustic boundaries remain proposals, not confirmed onsets or bow reversals.

Outputs include selected frequency/null, source (`standard`, `experimental`, `crepe-tiny`), neural candidate/activation peaks, acoustic support, failed gates, harmonic alternatives, recovery/disagreement flags, version, model identity and timing. “Harmonic guards” count retained acoustic or withheld disputed estimates; they are **not independently verified corrections**. The website has no independent recording labels and therefore shows coverage, not correct/wrong counts.

### Crossover findings

The controls include held B2/C3/C♯3/D3/D♯3, 100 ms chromatic changes and weak-fundamental C3–D3 sequences. Hybrid and Experimental both produce 202 correct / 0 wrong / 31 withheld across 233 labelled frames, versus Standard's 183 / 0 / 50. Tiny adds no additional accepted frame in this region. Therefore the tests **do not establish 131–147 Hz as a reliable neural boundary**. C3 is approximately 130.81 Hz, just below the configured lower recovery gate; existing acoustic estimates still apply there. No crossover tuning was performed from the held-out results.

## Browser implementation

- Reuse the existing single decode at 22050 Hz and existing mono policy. Standard, tone, Experimental and Tiny share that audio. The existing 100 MB file limit is unchanged. Hybrid initially limits clips to **120 seconds**; Standard's ten-minute limit remains.
- Run Tiny on the same dedicated worker after Standard/tone/Experimental. ONNX Runtime Web **1.22.0**, WASM SIMD, one thread; no SharedArrayBuffer/isolation headers or GPU requirement. The model/runtime load only after explicit Hybrid analysis. Non-quiet frames are inferred once each, including accepted Standard frames so disagreements can be inspected. Switching completed modes does not decode or infer again.
- Use the verified FP32 Tiny ONNX export: **1,963,212 bytes**, SHA-256 `ca2c743a77f1ca69b80f2e5ed43b14fbd5b3121ad9e0556497d487f07a1d33eb`. The build and every cached/downloaded model read enforce this hash. MIT notices, upstream identities and export provenance are in `public/models/`. Prior verification matched all 38 weight tensors exactly against official CREPE and tested original TensorFlow reference activations. Browser validation additionally compares all 360 activations for eight frozen synthetic frames against the verified export.
- Host model and approximately 11 MB WASM runtime **on this site**, without third-party model fallback. Versioned paths have immutable HTTP caching. The verified model also uses Cache Storage; private-mode/quota/cache failures permit a verified network load. Corrupt cached bytes are discarded, and an invalid download produces an error.
- Resample locally using a fixed 64-tap Blackman-windowed sinc, 7.2 kHz cutoff, 320 rational phases. This is **not** the previous Python benchmark's resampy Kaiser-best filter; this report measures the actual JavaScript path. Keep the Standard centre grid, rounding each neural centre to 16 kHz (≤31.25 μs alignment error). Use 1024 samples, population standard-deviation normalisation and the official ±4-bin weighted-cent decoder. No Viterbi or learned temporal prior.
- An actual browser run exposed WASM sigmoid roundoff of −5.96×10⁻⁸ in otherwise finite activations. Clamp only excursions within 10⁻⁶ of [0,1]; reject larger excursions/NaNs/infinities. A focused regression covers this numerical issue. It does not relax pitch confidence gates.
- Progress covers acoustic analysis, verified model loading, resampling, neural frame counts and arbitration. A 30-second model network timeout and 90-second no-progress watchdog provide actionable failure states. Cancellation, recording switches, page disposal and errors terminate the worker; normal completion releases tensors/session. An incomplete hybrid is never presented as a completed comparison.

## Validation protocol and results

All methods use identical mono PCM and labelled centres. Correct means absolute pitch error ≤50 cents; wrong is an accepted estimate outside tolerance; withheld means no estimate. Octave errors are a subset of wrong estimates within 50 cents of any nonzero whole octave. Nominal real open-string labels validate **note identity**, not independent instantaneous cents accuracy. No real-cello causal harmonic/bow explanation is inferred from a neural activation.

In overlap controls the label is the currently excited oscillator; decaying earlier oscillators remain real competing sound sources. A wrong estimate against that target does not prove there was only one acoustically valid fundamental.

The corpus contains **44 cases**: 30 prior synthetic cases (including silence/noise), seven crossover cases, four new held-out sequences and three real recordings. New evaluation seeds 4507/5701/6359/7559 and durations 105/75 ms were fixed before evaluation; the policy was not tuned after viewing them. These are independent synthesis draws, not independent real cellists. Original standard/experimental source and thresholds were not changed. The production worker, actual ONNX model, JavaScript resampler, decoder and arbitration produced every hybrid result below.

Cells are **correct / wrong / withheld**.

| Evaluation | Standard | Experimental | Hybrid Tiny |
|---|---:|---:|---:|
| Prior synthetic suite | 1433 / 122 / 609 | 1527 / 110 / 527 | 1531 / 122 / 511 |
| Crossover controls | 183 / 0 / 50 | 202 / 0 / 31 | 202 / 0 / 31 |
| New held-out sequences | 22 / 20 / 208 | 35 / 20 / 195 | 35 / 20 / 195 |
| Real V1 sustained regions | 452 / 0 / 12 | 452 / 0 / 12 | 452 / 0 / 12 |

Across all labelled cases, Hybrid newly accepts **130 correct / 0 wrong** relative to Standard. Only **4 correct / 0 wrong** are new Tiny selections: three in the 80 ms arpeggio and one in the prior resonance-overlap seed 2029. The other gains use the existing Experimental recovery path. No new Tiny frame passes on the new held-out set; its 13 additional correct frames come from Experimental. Preserve this distinction when assessing the value of neural inference.

Prior-suite octave errors: Standard **80**, Experimental **70**, Hybrid **80**. New held-out octave errors: **12** for each method. Hybrid retains baseline wrong estimates by policy. The JSON includes per-case cents median/p95 (all accepted and correct-only), transition response/miss counts, source counts and overlapping rejection reasons. Transition timing is first correct grid response to known synthesis changes, not bow detection or live latency; repeated same-note onsets are excluded.

### Mandatory real low-register regression

| V1 label | Labelled sustained interval | Hybrid correct | Wrong | Withheld |
|---|---|---:|---:|---:|
| C2 | 1.4–4.2 s | 116 | 0 | 4 |
| G2 | 4.6–7.5 s | 124 | 0 | 0 |
| D3 | 7.9–10.6 s | 112 | 0 | 4 |
| A3 | 11.3–13.7 s | 100 | 0 | 4 |

Standard and Experimental have the same per-region counts. C2 harmonic-interference handling, G2 identity, D3 usable coverage and A3 octave handling are preserved. All originally accepted Standard values remain numerically unchanged. The preceding standalone CREPE benchmark's C2 failures are not used as accepted hybrid values. C2 gaps remain unresolved; no C2-to-G3 false recovery is introduced.

### Exploratory coverage and measured runtime

These whole-file accepted counts **are not note-accuracy results**. V2 and Bach have no independent per-frame F0 labels. Beethoven audio was unavailable and was not analysed. The same FFmpeg-derived PCM hashes are used as the earlier benchmark.

| Recording | Grid frames | Standard usable | Experimental usable | Hybrid usable | Worker wall (s) | Tiny preprocessing/inference (s) |
|---|---:|---:|---:|---:|---:|---:|
| open-strings-v1 | 596 | 506 | 506 | 506 | 53.58 | 45.38 |
| open-strings-v2 | 1574 | 1301 | 1313 | 1314 | 30.55 | 23.82 |
| bach | 919 | 214 | 220 | 222 | 14.91 | 9.35 |

The direct website M4A upload (browser decoder) completed in **20.56 s** excluding decoding, including **2.32 s** model/runtime initialisation and **13.81 s** neural preprocessing/inference. Browser M4A decoding yields 595 centres versus FFmpeg's 596 because of codec trim/duration differences; those two runs are kept separate. The C2 labelled interval still contains 120 centres and preserves 116 accepted / 0 wrong / 4 withheld.

Timing is single-pass desktop Chromium on a shared Linux host. Fresh workers initialise the model each job; Cache Storage avoids model re-download but is not a persistent inference session. The first corpus overlapped some validation tasks; the final run is recorded in JSON. These are not controlled timing confidence intervals, live-streaming performance, phone speed, battery/thermal measurements or precise native memory profiles. The previous isolated feasibility benchmark documents model/runtime memory costs; do not equate JavaScript heap with total WASM/process memory. Physical mobile, Safari, WebGPU and two-minute stress behaviour remain unvalidated. The UI warns that processing can take longer than playback.

## Browser and regression checks

The reproducible production UI test exercises Standard default/no model download, original M4A upload, one decode per analysis, actual model loading/inference, progress, graphs and Standard overlay, timestamp/player seeking, playback, source diagnostics/export, completed-result reuse, a 390 px viewport, verified cache reuse with model network blocked, cancellation, SHA-256 rejection of a corrupt model, failed cold downloads, Standard recovery after hybrid failure, and recording-library persistence. It records network requests and asserts only same-origin GETs—no audio upload. A separate browser check uses Chromium's **synthetic microphone device**, then verifies saved take playback, playlist membership, instrument metadata and settings across refresh. It does not certify a physical microphone or phone.

TypeScript, ESLint, all 103 automated tests (including private V1/V2 tests), focused hybrid/lifecycle tests and the production build pass. Required guards include the real V1 zero-wrong regression, no new wrong held-out acceptances, preservation of every accepted Standard frame, zero silence/noise acceptances, aligned outputs, policy/source hashes and model activation parity. All comparisons and UI results must be complete before summarisation can generate release results.

## Reproduce and preview

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run start
```

Open http://localhost:3000/practice. For local development, `npm run dev` prepares the same model/runtime assets. In restricted CI, `NEXT_TELEMETRY_DISABLED=1` avoids Next.js trying to write telemetry preferences outside the workspace.

With Chromium installed (`CHROMIUM_PATH` can override `/usr/bin/chromium`), run in another terminal:

```sh
export STRINGMENTOR_CELLO_SAMPLE_PATH="/path/to/Cello Open Strings sample.m4a"
export STRINGMENTOR_CELLO_V2_PATH="/path/to/Cello Open Strings Sample V2.m4a"
export STRINGMENTOR_BACH_PATH="/path/to/Yo-yo Ma Prelude Bach Recording.m4a"
npm run test:hybrid:browser
npm run benchmark:hybrid
```

The browser tests create an isolated disposable profile. No existing user library is modified. `STRINGMENTOR_BASE_URL` overrides the localhost URL. FFmpeg decodes the private corpus when the environment paths are supplied; known original file hashes are checked. A prior ignored `work/crepe/run/manifest.json` can supply verified PCM instead. The original V1 recording is mandatory, not silently skipped. Synthetic cases and frozen activation references are in the repository; no private audio/model cache is committed. Python is unnecessary for this browser validation. Run the documented offline CREPE workflow only to repeat upstream weight/export provenance verification or the optional Full benchmark.

`test:hybrid:browser` records UI and preservation results; `benchmark:hybrid` prepares/fixes inputs, runs the built production worker and writes `docs/data/hybrid-crepe/results.json` only after release assertions pass. The numerical results record build ID, source/policy hashes, input hashes, environment, model identity and all cases. Changing rules requires a new untouched evaluation set; do not tune against the four new seeds and keep calling them held out.

## Deployment and next steps

The verified Git author identity is configured **locally** for this repository. Validated changes are intended for main so the existing Vercel integration can deploy them. This environment's outbound proxy denies direct requests to `stringmentor-ai.vercel.app` (CONNECT 403); local production-browser validation is complete, but a live-domain browser run cannot be claimed here. GitHub's Vercel deployment status is checked separately after push and reported in the delivery message.

After deployment: load a short cello take, open Advanced Diagnostics, select Hybrid Tiny and analyse. Confirm the progress stages, teal hybrid/ivory Standard trajectories, timestamp seeking, source/rejection details, cancellation and retry. Refresh, reload from Recordings and confirm Standard is again selected. Practice Mentor must continue to use Standard.

Next validation should obtain independently labelled fingered real-cello performances, including transition-region notes, rapid attacks, overlapping resonance and true octave leaps; test current Safari and physical low/mid-range phones; measure end-to-end CPU/native memory and sustained thermal behaviour. Tiny adds too few accepted frames in this corpus to justify broader algorithm changes yet. Keep the conservative diagnostic option, measure its real-world benefit, and investigate segment-conflict resolution separately before considering Mentor or default-mode integration.

## Per-case counts

Final column is newly accepted **correct/wrong versus Standard**, not all changes versus Experimental. Real unlabelled coverage is explicitly marked.

| Case | Standard C/W/withheld | Experimental | Hybrid Tiny | New C/W |
|---|---:|---:|---:|---:|
| low-0.5-clean | 151/6/8 | 153/4/8 | 153/6/6 | 2/0 |
| low-0.125-clean | 20/6/10 | 23/4/9 | 23/6/7 | 3/0 |
| low-0.08-clean | 0/1/19 | 0/1/19 | 0/1/19 | 0/0 |
| arpeggio-0.5-clean | 312/0/25 | 314/0/23 | 314/0/23 | 2/0 |
| arpeggio-0.125-clean | 56/0/23 | 60/0/19 | 60/0/19 | 4/0 |
| arpeggio-0.08-clean | 0/0/48 | 9/0/39 | 12/0/36 | 12/0 |
| arpeggio-0.125-resonance | 28/18/33 | 28/18/33 | 28/18/33 | 0/0 |
| arpeggio-0.125-attack-noise | 55/0/24 | 59/0/20 | 59/0/20 | 4/0 |
| arpeggio-0.125-weak-fundamental | 49/11/19 | 55/8/16 | 55/11/13 | 6/0 |
| chromatic-0.125-clean | 48/0/31 | 53/0/26 | 53/0/26 | 5/0 |
| sustained-C2-minus12c | 79/0/0 | 79/0/0 | 79/0/0 | 0/0 |
| sustained-A3-plus12c | 79/0/0 | 79/0/0 | 79/0/0 | 0/0 |
| sustain-36 | 36/0/0 | 36/0/0 | 36/0/0 | 0/0 |
| sustain-43 | 36/0/0 | 36/0/0 | 36/0/0 | 0/0 |
| sustain-50 | 36/0/0 | 36/0/0 | 36/0/0 | 0/0 |
| sustain-57 | 36/0/0 | 36/0/0 | 36/0/0 | 0/0 |
| true-octaves | 42/6/13 | 47/4/10 | 47/6/8 | 5/0 |
| repeated-notes | 14/0/22 | 26/0/10 | 26/0/10 | 12/0 |
| vibrato | 79/0/0 | 79/0/0 | 79/0/0 | 0/0 |
| glissando | 79/0/0 | 79/0/0 | 79/0/0 | 0/0 |
| silence | 0 usable (unlabelled) | 0 usable (unlabelled) | 0 usable (unlabelled) | 0/0 |
| noise | 0 usable (unlabelled) | 0 usable (unlabelled) | 0 usable (unlabelled) | 0/0 |
| held-out-701 | 68/9/20 | 71/8/18 | 71/9/17 | 3/0 |
| held-out-809 | 8/6/44 | 20/6/32 | 20/6/32 | 12/0 |
| held-out-997 | 42/6/49 | 42/6/49 | 42/6/49 | 0/0 |
| held-out-1237 | 3/10/45 | 3/10/45 | 3/10/45 | 0/0 |
| held-out-1601 | 40/7/35 | 53/6/23 | 53/7/22 | 13/0 |
| held-out-1777 | 16/7/43 | 30/6/30 | 30/7/29 | 14/0 |
| held-out-2029 | 16/22/44 | 16/22/44 | 17/22/43 | 1/0 |
| held-out-2411 | 5/7/54 | 5/7/54 | 5/7/54 | 0/0 |
| crossover-held-47 | 23/0/0 | 23/0/0 | 23/0/0 | 0/0 |
| crossover-held-48 | 23/0/0 | 23/0/0 | 23/0/0 | 0/0 |
| crossover-held-49 | 23/0/0 | 23/0/0 | 23/0/0 | 0/0 |
| crossover-held-50 | 23/0/0 | 23/0/0 | 23/0/0 | 0/0 |
| crossover-held-51 | 23/0/0 | 23/0/0 | 23/0/0 | 0/0 |
| crossover-fast | 21/0/40 | 38/0/23 | 38/0/23 | 17/0 |
| crossover-weak | 47/0/10 | 49/0/8 | 49/0/8 | 2/0 |
| hybrid-held-out-4507 | 13/4/57 | 20/4/50 | 20/4/50 | 7/0 |
| hybrid-held-out-5701 | 0/2/49 | 6/2/43 | 6/2/43 | 6/0 |
| hybrid-held-out-6359 | 9/13/52 | 9/13/52 | 9/13/52 | 0/0 |
| hybrid-held-out-7559 | 0/1/50 | 0/1/50 | 0/1/50 | 0/0 |
| open-strings-v1 | 452/0/12 | 452/0/12 | 452/0/12 | 0/0 |
| open-strings-v2 | 1301 usable (unlabelled) | 1313 usable (unlabelled) | 1314 usable (unlabelled) | 0/0 |
| bach | 214 usable (unlabelled) | 220 usable (unlabelled) | 222 usable (unlabelled) | 0/0 |
