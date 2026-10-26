# CREPE benchmark for StringMentor AI

26 October 2026. Offline evaluation against Standard and Experimental `2D.2B.1`. Production pitch analysis, tone analysis, Practice Mentor, recording, playback, playlists and storage are unchanged. This report evaluates a model, not a replacement release.

## Implementation and verified provenance

The benchmark uses **torchcrepe 0.0.24**, a PyTorch port of the official CREPE model, with Tiny and Full capacities. It uses the official CREPE local weighted-average decoder rather than torchcrepe's default Viterbi decoder or stochastic bin dithering. All neural inference uses FP32 on CPU with one PyTorch thread, one interop thread and batch size one. Neither model receives labels, expected notes or the open-string sequence.

Provenance is checked by executable code in `scripts/crepe/verify_models.py`:

- Official weights come from the immutable `marl/crepe` models commit `bb29b8d99a89924476d112d27ed470e4ac5617c0`; compressed and uncompressed SHA-256 hashes are enforced.
- Installed `.pth` hashes are enforced. All **38 weight/statistic tensors per model match the official H5 tensors exactly** after the documented Conv/Dense layout transpositions. BatchNorm counters are checked separately.
- Both forward passes are checked on 16 upstream input frames against upstream reference activations computed with the original CREPE implementation. Maximum absolute activation differences are below `1e-5`, with mean differences below `1e-7`.
- Reference arrays come from torchcrepe commit `19e2ec3d494c0797a5ff2a11408ec5838fba6681`. All file hashes, tensor names, model sizes and measured activation errors are in the numerical results. The upstream fixture is a compatibility test, not a cello-accuracy dataset.
- Python packages and the separate browser dependencies are pinned. Model files, private audio, decoded PCM, virtual environments and caches remain under ignored `work/crepe/`; none is committed. Applicable upstream MIT notices are in `scripts/crepe/NOTICE`.

Sources: [official CREPE source](https://github.com/marl/crepe/tree/c9b71ce61491454125a0693f584f7244f29d9884), [official model files](https://github.com/marl/crepe/tree/bb29b8d99a89924476d112d27ed470e4ac5617c0), [torchcrepe port and compatibility tests](https://github.com/maxrmorrison/torchcrepe/tree/19e2ec3d494c0797a5ff2a11408ec5838fba6681), [CREPE paper](https://arxiv.org/abs/1802.06182). The official README lists MIR-1K, Bach10, RWC-Synth, MedleyDB, MDB-STEM-Synth and NSynth training data. This is a general monophonic model, not a cello-specific model trained or calibrated here.

## Corpus, alignment and acceptance rules

All four methods analyse the same mono PCM. The 30 deterministic synthetic cases reuse the existing sustained, detuned, fast arpeggio, weak-fundamental, resonance-tail, noisy-attack, chromatic, octave-leap, repeated-note, vibrato, glissando, silence and noise controls, plus seeds 701/809/997/1237 and 1601/1777/2029/2411. The latter are frozen prior evaluation cases; they are not a newly collected independent real-cellist corpus. Ground-truth fundamentals and sample-quantised note boundaries come from synthesis, never detector output.

Private audio is decoded with FFmpeg to stereo 22050 Hz, then mixed with the same arithmetic mean used by the app. Known files are SHA-256 checked. The original open-string file has manually specified sustained regions: C2 1.4–4.2 s, G2 4.6–7.5 s, D3 7.9–10.6 s and A3 11.3–13.7 s. Their nominal open-string frequencies validate note identity within a broad tolerance; they are not independent cent-accurate F0 annotations. V2 and the Bach Prelude excerpt have no independent frame-level F0 labels and are used only for exploratory coverage.

The **Beethoven excerpt was unavailable**. `STRINGMENTOR_BEETHOVEN_PATH` supports including it in a future run as unlabelled audio and records its input hash. Earlier user-reported frame counts are not substituted for measurements. No Beethoven result is fabricated.

The shared output grid is the existing Standard grid: sample centres `2048 + i × 512` at 22050 Hz. Standard and Experimental use their existing implementations without modification. CREPE receives a 1024-sample window at 16000 Hz, resampled with the official implementation's `resampy` Kaiser-best filter. Each CREPE centre is rounded to the nearest 16000 Hz sample, giving at most **31.25 μs** alignment error. No pitch interpolation or nearest-output-frame matching is used. The Standard end guards apply to all methods; CREPE is not credited with extra edge frames.

CREPE frames are mean-centred and normalised by population standard deviation, clipped at `1e-8`, as in the official implementation. Decoding averages the nine pitch bins centred on the unrestricted activation maximum (clipped at the model's edges), in cents before converting to Hz. There is no smoothing, Viterbi sequence prior, note quantisation or stochastic dithering.

Primary CREPE acceptance was fixed before examining accuracy: activation confidence **≥0.50**, predicted frequency **55–1000 Hz**, and the same DC-removed 4096-sample RMS **≥0.003** as Standard. Below-amplitude frames are withheld without neural inference. Out-of-range predictions are withheld rather than forcing the nearest allowed pitch. Confidence sensitivity at 0/0.3/0.5/0.7/0.9 is reported without retuning the primary threshold. CREPE activation confidence is not a calibrated probability of correctness and is not numerically comparable to Pitchy's periodicity or harmonic support.

## Scoring and timing

A labelled frame is **correct** at an absolute error ≤50 cents; an accepted estimate outside tolerance is **wrong**; a null estimate is **withheld**. All three counts sum to the labelled denominator. Octave errors are wrong estimates within 50 cents of any nonzero whole-octave displacement. The JSON also records one-octave-only errors for comparison with older audits. Median/p95 errors for all accepted estimates include wrong notes; correct-only errors are explicitly separate.

Timing uses the same clips and output grid. Standard and Experimental are warmed and measured twice; per-case medians are summed. Experimental time includes its required Standard pass, not merely its additional work. The optional Phase 2B cue text is omitted because it does not change pitch decisions; decode and tone analysis are excluded for all methods. CREPE has a separate load/warm-up measurement and one measured corpus pass, including 16 kHz resampling, frame preparation, inference and decoding. Input file reads and FFmpeg decoding are excluded consistently. Thread counts, CPU time, wall time, peak RSS and frame latency are recorded.

These are shared-host measurements. Some model runs and validation overlapped on a four-CPU-quota Linux host; scheduling/load variation affects wall time. CPU time is included to distinguish computational cost from scheduling delay. Two JS runs versus one neural run do not establish stable timing confidence intervals. No server CPU result is presented as browser/mobile speed.

Transition responsiveness is a **label-conditioned first correct estimate** around each known change, with the same search interval for every method. Early estimates can reflect centred look-ahead. Misses are counted separately; medians/p95 of found responses never imply missing responses were detected. Repeated same-pitch onsets are excluded because a continuous pitch estimate cannot demonstrate rearticulation. This is not onset precision/recall, musical transcription accuracy or live latency. Continuous vibrato/glissando cases have per-centre F0 labels and no discrete onset score.

## Results and recommendation

**Keep Standard as the production default. A guarded, evidence-checked hybrid is a research direction, not a validated integration.** CREPE recovers many more synthetic fast-passage frames, but both capacities fail the real C2 regression. Full improves real G2 behaviour relative to Tiny, at a large computational cost. Neither is a safe direct replacement, and a naive “fill every Standard gap with CREPE” policy would introduce wrong notes.

### Main aligned comparison

The common labelled evaluation contains **2,628 frames**: 2,164 synthetic frames plus 464 sustained-region frames from the original real cello file. Correct/wrong/withheld use the fixed rules above. Time covers the complete clips containing those labels, including their unlabelled portions; silence/noise-only controls and unlabelled V2/Bach are outside this aggregate. Every method uses exactly the same labelled centres. CPU time is particularly useful here because wall time is affected by concurrent host work.

| Method       | Correct | Wrong | Withheld | Octave errors | Correct / all | Accepted accuracy | Wall time (s) | CPU time (s) |
| ------------ | ------: | ----: | -------: | ------------: | ------------: | ----------------: | ------------: | -----------: |
| Standard     |    1885 |   122 |      621 |            80 |        71.73% |            93.92% |         16.47 |        16.93 |
| Experimental |    1979 |   110 |      539 |            70 |        75.30% |            94.73% |         26.39 |        27.63 |
| CREPE Tiny   |    2224 |   243 |      161 |            79 |        84.63% |            90.15% |         38.61 |        38.11 |
| CREPE Full   |    2332 |   193 |      103 |            13 |        88.74% |            92.36% |        844.47 |       833.29 |

This pooled table is not a universal accuracy ranking: it combines simple controlled oscillators with a small real regression. The real low-register failures below are release blockers even where the pooled correct count increases.

### Synthetic accuracy and cents error

| Method       | Correct / wrong / withheld | Octave errors | Accepted absolute cents median / p95 | Correct-only cents median / p95 |
| ------------ | -------------------------: | ------------: | -----------------------------------: | ------------------------------: |
| Standard     |           1433 / 122 / 609 |            80 |                       0.08 / 1200.16 |                     0.05 / 7.63 |
| Experimental |           1527 / 110 / 527 |            70 |                       0.09 / 1199.73 |                     0.06 / 7.33 |
| CREPE Tiny   |            1950 / 54 / 160 |             9 |                         2.90 / 17.28 |                    2.80 / 12.73 |
| CREPE Full   |            1993 / 71 / 100 |            10 |                         2.56 / 14.77 |                    2.48 / 10.66 |

All labelled synthetic case results follow. These counts include errors, rather than describing every newly available measurement as a recovery.

| Case                            | Standard C / W / withheld | Experimental |         Tiny |        Full |
| ------------------------------- | ------------------------: | -----------: | -----------: | ----------: |
| low-0.5-clean                   |               151 / 6 / 8 |  153 / 4 / 8 |  159 / 0 / 6 | 160 / 1 / 4 |
| low-0.125-clean                 |               20 / 6 / 10 |   23 / 4 / 9 |   30 / 0 / 6 |  31 / 0 / 5 |
| low-0.08-clean                  |                0 / 1 / 19 |   0 / 1 / 19 |   16 / 0 / 4 |  18 / 0 / 2 |
| arpeggio-0.5-clean              |              312 / 0 / 25 | 314 / 0 / 23 |  329 / 0 / 8 | 332 / 0 / 5 |
| arpeggio-0.125-clean            |               56 / 0 / 23 |  60 / 0 / 19 |   71 / 0 / 8 |  73 / 0 / 6 |
| arpeggio-0.08-clean             |                0 / 0 / 48 |   9 / 0 / 39 |   40 / 1 / 7 |  44 / 1 / 3 |
| arpeggio-0.125-resonance        |              28 / 18 / 33 | 28 / 18 / 33 |   67 / 7 / 5 |  73 / 6 / 0 |
| arpeggio-0.125-attack-noise     |               55 / 0 / 24 |  59 / 0 / 20 |   71 / 0 / 8 |  73 / 0 / 6 |
| arpeggio-0.125-weak-fundamental |              49 / 11 / 19 |  55 / 8 / 16 |   74 / 0 / 5 |  74 / 1 / 4 |
| chromatic-0.125-clean           |               48 / 0 / 31 |  53 / 0 / 26 |  66 / 2 / 11 |  72 / 1 / 6 |
| sustained-C2-minus12c           |                79 / 0 / 0 |   79 / 0 / 0 |   79 / 0 / 0 |  79 / 0 / 0 |
| sustained-A3-plus12c            |                79 / 0 / 0 |   79 / 0 / 0 |   79 / 0 / 0 |  79 / 0 / 0 |
| sustain-36                      |                36 / 0 / 0 |   36 / 0 / 0 |   36 / 0 / 0 |  36 / 0 / 0 |
| sustain-43                      |                36 / 0 / 0 |   36 / 0 / 0 |   36 / 0 / 0 |  36 / 0 / 0 |
| sustain-50                      |                36 / 0 / 0 |   36 / 0 / 0 |   36 / 0 / 0 |  36 / 0 / 0 |
| sustain-57                      |                36 / 0 / 0 |   36 / 0 / 0 |   36 / 0 / 0 |  36 / 0 / 0 |
| true-octaves                    |               42 / 6 / 13 |  47 / 4 / 10 |   57 / 0 / 4 |  58 / 0 / 3 |
| repeated-notes                  |               14 / 0 / 22 |  26 / 0 / 10 |   35 / 0 / 1 |  32 / 0 / 4 |
| vibrato                         |                79 / 0 / 0 |   79 / 0 / 0 |   79 / 0 / 0 |  79 / 0 / 0 |
| glissando                       |                79 / 0 / 0 |   79 / 0 / 0 |   79 / 0 / 0 |  79 / 0 / 0 |
| held-out-701                    |               68 / 9 / 20 |  71 / 8 / 18 |  82 / 1 / 14 |  84 / 5 / 8 |
| held-out-809                    |                8 / 6 / 44 |  20 / 6 / 32 |   51 / 1 / 6 |  51 / 1 / 6 |
| held-out-997                    |               42 / 6 / 49 |  42 / 6 / 49 | 72 / 11 / 14 | 71 / 22 / 4 |
| held-out-1237                   |               3 / 10 / 45 |  3 / 10 / 45 |  42 / 6 / 10 |  41 / 8 / 9 |
| held-out-1601                   |               40 / 7 / 35 |  53 / 6 / 23 |   72 / 1 / 9 |  76 / 2 / 4 |
| held-out-1777                   |               16 / 7 / 43 |  30 / 6 / 30 |   58 / 0 / 8 |  62 / 1 / 3 |
| held-out-2029                   |              16 / 22 / 44 | 16 / 22 / 44 | 60 / 10 / 12 |  64 / 9 / 9 |
| held-out-2411                   |                5 / 7 / 54 |   5 / 7 / 54 | 38 / 14 / 14 | 44 / 13 / 9 |

### Real open-string regression

| V1 region       | Standard C / W / withheld | Experimental |          Tiny |          Full |
| --------------- | ------------------------: | -----------: | ------------: | ------------: |
| C2, 1.4–4.2 s   |               116 / 0 / 4 |  116 / 0 / 4 |   0 / 119 / 1 |   0 / 119 / 1 |
| G2, 4.6–7.5 s   |               124 / 0 / 0 |  124 / 0 / 0 |   55 / 69 / 0 |   121 / 3 / 0 |
| D3, 7.9–10.6 s  |               112 / 0 / 4 |  112 / 0 / 4 |   116 / 0 / 0 |   115 / 0 / 1 |
| A3, 11.3–13.7 s |               100 / 0 / 4 |  100 / 0 / 4 |   103 / 1 / 0 |   103 / 0 / 1 |
| **Pooled V1**   |              452 / 0 / 12 | 452 / 0 / 12 | 274 / 189 / 1 | 339 / 122 / 3 |

Both neural models produce **0 correct / 119 wrong / 1 withheld** in the labelled C2 region. Their errors are mostly near the third harmonic, not an octave; this is why a small octave-error count alone can hide a serious failure. For example, Tiny reports 199.79 Hz at 3.994 s where the supplied label is C2. This establishes a wrong harmonic-related estimate, not the causal mechanism inside the network. No spectral-cause or bow-technique conclusion is inferred from confidence alone. Full resolves most of Tiny's G2 errors but does not repair the C2 failure. Standard/Experimental retain 452 correct and zero wrong across the labelled real regions.

These nominal open-string labels cannot establish sub-cent detector accuracy. Actual tuning deviation is part of the measured cents error on V1; use the synthetic cents table for exact oscillator-frequency comparisons.

### Confidence sensitivity

The selected confidence threshold remains 0.50. Alternative thresholds use the same saved predictions, without rerunning or tuning the estimators.

| Minimum confidence | Tiny synthetic C / W / withheld |  Full synthetic |        Tiny V1 |        Full V1 |
| ------------------ | ------------------------------: | --------------: | -------------: | -------------: |
| 0.0                |                 2015 / 122 / 27 | 2043 / 107 / 14 |  274 / 190 / 0 |  341 / 123 / 0 |
| 0.3                |                  2002 / 98 / 64 |  2026 / 94 / 44 |  274 / 190 / 0 |  341 / 123 / 0 |
| 0.5                |                 1950 / 54 / 160 | 1993 / 71 / 100 |  274 / 189 / 1 |  339 / 122 / 3 |
| 0.7                |                 1808 / 22 / 334 | 1895 / 41 / 228 | 244 / 166 / 54 | 294 / 115 / 55 |
| 0.9                |                  453 / 0 / 1711 |  1474 / 3 / 687 |    5 / 0 / 459 |   91 / 0 / 373 |

At 0.90, Tiny avoids accepted V1 errors by withholding 459/464 frames; Full withholds 373/464. That is not a solved estimator. The common RMS gate remains active even at a zero confidence threshold. A zero threshold does not bypass range or finite-value checks.

### Transition responsiveness and unpitched controls

Cells show **found / total changes; absolute timing p95 in ms**. Missing responses remain in the denominator. Negative response times can arise from centred look-ahead; signed timing and individual responses are in JSON.

| Case                     |       Standard |   Experimental |           Tiny |           Full |
| ------------------------ | -------------: | -------------: | -------------: | -------------: |
| low-0.125-clean          |   6 / 7; 59.05 |   6 / 7; 41.63 |   7 / 7; 36.52 |   7 / 7; 31.44 |
| arpeggio-0.125-clean     | 15 / 15; 50.87 | 15 / 15; 34.12 | 15 / 15; 24.20 | 15 / 15; 24.20 |
| arpeggio-0.08-clean      |      0 / 15; — |  7 / 15; 48.29 | 14 / 15; 29.96 | 14 / 15; 30.08 |
| arpeggio-0.125-resonance | 11 / 15; 78.10 | 11 / 15; 78.10 | 15 / 15; 50.56 | 15 / 15; 33.94 |
| chromatic-0.125-clean    | 15 / 15; 54.71 | 15 / 15; 43.59 | 15 / 15; 33.09 | 15 / 15; 25.81 |
| true-octaves             |   7 / 7; 71.80 |   7 / 7; 53.84 |   7 / 7; 34.34 |   7 / 7; 27.96 |
| held-out-2029            | 9 / 17; 103.88 | 9 / 17; 103.88 | 16 / 17; 77.91 | 16 / 17; 79.01 |

Repeated same-note onsets have no response score; a held pitch cannot show whether the bow rearticulated.

| Unpitched control | Standard accepted | Experimental | Tiny | Full |
| ----------------- | ----------------: | -----------: | ---: | ---: |
| silence           |              0/36 |         0/36 | 0/36 | 0/36 |
| noise             |              0/36 |         0/36 | 0/36 | 0/36 |

### Exploratory coverage on unlabelled audio

These are accepted measurements, **not correct-note counts**. No accuracy, octave-error rate or cents-accuracy claim is made for V2 or Bach.

| Recording       | Frames | Standard accepted | Experimental | Tiny | Full |
| --------------- | -----: | ----------------: | -----------: | ---: | ---: |
| open-strings-v2 |   1574 |              1301 |         1313 | 1417 | 1442 |
| bach            |    919 |               214 |          220 |  647 |  672 |

Beethoven: **not completed — original audio was unavailable**. V2 has no independently timestamped F0 labels; known performance context is not used to manufacture them.

### Complementarity and the hybrid question

For the 2,628 labelled centres, these are descriptive cross-tabs against Standard, not a deployed fusion rule:

| Situation                        | Tiny | Full |
| -------------------------------- | ---: | ---: |
| Standard withheld; CREPE correct |  444 |  483 |
| Standard withheld; CREPE wrong   |   44 |   55 |
| Standard correct; CREPE wrong    |  193 |  126 |
| Standard wrong; CREPE correct    |  105 |  104 |

This demonstrates complementary information and also shows why unconditional gap filling is unsafe. A useful hybrid would preserve long-window low-register evidence, request neural candidates only where appropriate, check harmonic/octave alternatives and segment boundaries, and withhold unresolved disagreements. It must be evaluated against the real C2/G2 regressions before any app integration. Tiny's download/computation advantage does not compensate for its present real-cello errors; Full is more useful as an offline comparison/reference candidate than as an immediate mobile CPU feature.

## Browser feasibility

A separate localhost harness exports the verified models to ONNX opset 17 and runs ONNX Runtime Web 1.22.0 with WASM SIMD, one thread, in desktop headless Chromium. It uses eight fixed synthetic windows, three warm-ups and 24 timed single-frame calls per condition. All 360 activation outputs agree with PyTorch within `1e-4`; the actual maximum errors are below. This tests model execution compatibility, not the app's end-to-end browser audio path.

The headline browser run was performed after the native benchmark and build jobs completed. An earlier concurrent run is retained in `browserConcurrentRun` to show sensitivity to host load. Model loading is measured over localhost without cache and does not represent Internet download time. CPU throttling is Chromium's nominal 4× slowdown, **not physical mobile hardware**.

Full's final latencies exceeded those in the earlier concurrent run. The cause of that variability was not isolated on this shared virtual host; the large median/p95 spread should prevent treating these numbers as stable device-performance estimates. JSON includes browser-process CPU seconds for each condition, including its three warm-up calls, alongside wall-clock frame latencies.

| Model      | Parameters | ONNX bytes | Gzip bytes | Warm normal median / p95 ms | 4× throttle median / p95 ms | Max activation difference |
| ---------- | ---------: | ---------: | ---------: | --------------------------: | --------------------------: | ------------------------: |
| CREPE Tiny |    486,552 |  1,963,212 |  1,547,169 |               30.37 / 51.23 |             123.69 / 274.54 |                  2.38e-07 |
| CREPE Full | 22,239,976 | 88,992,219 | 70,759,178 |           1125.01 / 3807.88 |          4215.52 / 12614.67 |                  1.55e-07 |

| Model      | Local load ms | Browser RSS sum before model / sampled peak MiB | JS heap after normal test MiB | Native process peak MiB |
| ---------- | ------------: | ----------------------------------------------: | ----------------------------: | ----------------------: |
| CREPE Tiny |        3364.3 |                                   405.9 / 514.9 |                           5.3 |                   441.4 |
| CREPE Full |       10525.8 |                                   403.5 / 728.3 |                           3.4 |                   554.7 |

RSS sums include the browser, renderers and utility processes, can double-count shared pages, and are sampled every 200 ms rather than measuring a guaranteed peak. JS heap excludes some native/WASM memory. Native peak RSS includes Python, PyTorch, resampler/JIT and model workspaces; it is not just weight size. These measurements cannot be transferred directly to a phone's memory budget.

At the existing 512/22050 hop, a streaming implementation would need about 43 estimates per second (23.22 ms per frame). Compare that budget with the measured latencies, while remembering the current app analyses recordings offline. Large-kernel convolutions make even the small weight file computationally significant. Worker execution, lazy loading and cancellation would be necessary for an interactive prototype. Batching, WebGPU or quantisation may change throughput/memory/accuracy and require their own measured regressions; none is assumed to solve the problem here.

## Specific next steps

1. Retain Standard and the current opt-in Experimental mode. Do not ship CREPE as an automatic replacement or infer musical quality from its confidence.
2. Obtain the Beethoven file and independent timestamped F0/note labels for multiple real solo-cellist takes, especially quiet C2, fast fingered passages, weak fundamentals, resonance overlap and transitions. Keep a performer/recording-level held-out split.
3. Investigate the measured C2 third-harmonic failures and G2 octave alternatives with actual spectra and controlled ablations. Do not hardcode the open-string order or select a threshold on this regression alone.
4. Prototype an offline hybrid using independent harmonic evidence, segment-aware candidate comparisons and calibrated abstention. Use the cross-tabs above to track newly introduced wrong estimates, not just filled gaps. Keep the unchanged Standard trace available.
5. If that hybrid passes real-cello regressions, test an isolated Web Worker implementation with the existing player's exact decode/mix/resample policy. Verify cancellation, long-file memory, IndexedDB/microphone workflows and model versioning before any production switch.
6. Measure real Android Chrome and iOS Safari hardware, cold/warm download, sustained thermal/battery behaviour, and optional WebGPU/quantised variants. Match model outputs against verified FP32 references before comparing speed. Establish explicit acceptable wrong-note and withheld-frame budgets before deployment.

## Scientific limitations

1. Synthetic harmonic oscillators are useful controlled tests but do not reproduce bowed-string nonlinearities, body resonances, microphone/room response or diverse performers. Good synthetic performance can coexist with serious real-cello errors.
2. Only V1 has labelled real sustained regions, and those labels identify notes rather than precise instantaneous tuning. Adjacent frames overlap and are correlated. Frame counts are not thousands of statistically independent trials; confidence intervals from independent-frame binomial assumptions would be misleading.
3. The known active oscillator is the labelled target in synthetic resonance-tail cases, even when another oscillator overlaps. Both Standard and CREPE are monophonic estimators. A mixed signal need not have a uniquely recoverable fundamental.
4. CREPE's 64 ms window has about 4.2 cycles at C2, versus Standard's approximately 186 ms window. Shorter context can help transitions and can also make low-register/harmonic ambiguity harder. Output differences cannot be attributed solely to the neural architecture because context and acceptance policies differ.
5. Confidence thresholds control coverage/error trade-offs without proving reliability. A large activation can still correspond to a wrong harmonic or octave. The reported sensitivity analysis is descriptive, not a threshold fitted for deployment.
6. Official weights and port equivalence are verified; training-set overlap and domain coverage are not fully auditable from this evaluation. Unlabelled commercial recordings are not correctness benchmarks.
7. The browser prototype tests the CNN on precomputed normalised synthetic frames. It does not test an end-to-end browser decoder/resampler, long-recording memory, cancellation, worker scheduling or the production app. Single-frame microbenchmarks do not predict batched offline throughput.
8. Physical Android/iOS devices, Safari, WebGPU, battery use, thermal throttling, quantised models, neural Viterbi decoding and training/fine-tuning were **not benchmarked**. CPU throttling is a desktop simulation, not a measurement of any phone.

## Reproduction

Use the repository's Node version and Python 3.12 on Linux x86-64. FFmpeg is required for private M4A inputs. Setup downloads packages and public models; all audio analysis runs locally. No audio is sent to a service.

```bash
npm ci
mkdir -p work/crepe
python3 -m venv work/crepe/venv
work/crepe/venv/bin/python -m pip install \
  --cache-dir work/crepe/pip-cache \
  --extra-index-url https://download.pytorch.org/whl/cpu \
  -r scripts/crepe/requirements-lock.txt

mkdir -p work/crepe/browser-env
cp scripts/crepe/browser/package*.json work/crepe/browser-env/
npm ci --prefix work/crepe/browser-env --cache work/crepe/npm-cache

STRINGMENTOR_CELLO_SAMPLE_PATH='/path/to/Cello Open Strings sample.m4a' \
STRINGMENTOR_CELLO_V2_PATH='/path/to/Cello Open Strings Sample V2.m4a' \
STRINGMENTOR_BACH_PATH='/path/to/Yo-yo Ma Prelude Bach Recording.m4a' \
npm run benchmark:crepe -- --browser
```

Set `CHROMIUM_PATH` if Chromium is not `/usr/bin/chromium`. Set `CREPE_PYTHON` to use a differently located environment. Add `STRINGMENTOR_BEETHOVEN_PATH` only when the actual file is available. Missing private files are explicitly listed as unavailable. Full CPU evaluation is computationally expensive; allow tens of minutes on this class of host.

`npm run benchmark:crepe -- --score-only` rebuilds the numerical report from completed matching-manifest model outputs. It refuses incomplete or stale neural results. A fresh run clears previous model/browser result files. Without `--browser`, neural and JS benchmarks still run and browser measurements are explicitly unavailable. Intermediate PCM, predictions and provenance checks are in ignored `work/crepe/`. The committed JSON contains aggregate/per-case measurements and hashes, not audio. The curated Markdown discussion should be reviewed after changing the corpus, models or thresholds.

Relevant checks:

```bash
npm run typecheck
npm run lint
# Supply both private cello variables above to avoid skipping those regressions.
npm test
OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 NUMBA_NUM_THREADS=1 \
  work/crepe/venv/bin/python scripts/crepe/test_infer.py
npm run build
```

Validation completed: TypeScript, ESLint and the production Next.js build passed. All **95 Node tests passed with zero skips**, including the original private cello regressions, microphone, storage, playlists, feedback and UI tests. The three Python preprocessing/decoder tests passed, as did exact-weight/reference-activation checks and both browser model comparisons. Additional assertions check shared denominators, threshold monotonicity, the unchanged Standard/Experimental regression counts, and model/corpus provenance. No production `src/` file changed.

Incomplete benchmarks: Beethoven audio, independent F0 accuracy on V2/Bach, physical mobile/Safari/WebGPU performance, long-recording browser memory and end-to-end browser integration. Tiny and Full CPU inference and the desktop browser microbenchmarks were completed; the absent experiments are not represented as successes.
