# Cello pitch reliability: validation and limitations

Measured on 17 October 2026. Baseline: commit `6a216e9` (Pitchy alone, 0.97 relative-peak threshold, 0.90 clarity gate, isolated-octave rejection). Revised engine: raw Pitchy plus spectral harmonic candidates and bounded neighbouring-frame evidence. All processing remains local, with no recording or IndexedDB changes.

## Reproduce

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

To run the full original-audio regression, install FFmpeg and supply the private original file:

```bash
STRINGMENTOR_CELLO_SAMPLE_PATH='/path/to/Cello Open Strings sample.m4a' npm test
```

The original-audio test checks the SHA-256 before applying its labels. Without the environment variable, this one test is explicitly skipped; synthetic, lifecycle, storage, and derived-candidate regressions still run. `tests/fixtures/cello-candidates.json` contains candidate measurements around the reported failures, **not audio**. Those fixtures exercise tracking decisions, not decoding or spectral extraction; the original-file test exercises the complete DSP path after FFmpeg decoding. The M4A/PCM is not committed or uploaded.

## Supplied real recording

- Source: `Cello Open Strings sample.m4a`, 226,428 bytes, stereo AAC, 48 kHz, container duration 14.058667 seconds.
- SHA-256: `6da88d0b66109e476222d85b1334b53b8e183f99d1de44a1bb70c17e556e07fc`.
- User labels: C2 → G2 → D3 → A3. The labels are used **only in tests**, never in the estimator.
- Offline validation uses FFmpeg resampling to 22,050 Hz and an explicit arithmetic stereo mean. Browser decoding/resampling may differ slightly. Frequency estimates at the reported timestamps reproduce the user's rounded baseline values.
- Conservative evaluation intervals were chosen after inspecting spectral changes, leaving transition margins out. The recording was used during development; this is a regression/development result, **not a held-out evaluation**.

| Label and interval | Frames | Baseline expected note | Baseline wrong note | Baseline withheld | Revised expected note | Revised wrong note | Revised withheld |
| ------------------ | -----: | ---------------------: | ------------------: | ----------------: | --------------------: | -----------------: | ---------------: |
| C2, 1.40–4.20 s    |    120 |            89 (74.17%) |                  24 |                 7 |          116 (96.67%) |                  0 |                4 |
| G2, 4.60–7.50 s    |    124 |             124 (100%) |                   0 |                 0 |            124 (100%) |                  0 |                0 |
| D3, 7.90–10.60 s   |    116 |            56 (48.28%) |                   0 |                60 |          112 (96.55%) |                  0 |                4 |
| A3, 11.30–13.70 s  |    104 |              5 (4.81%) |                  99 |                 0 |          100 (96.15%) |                  0 |                4 |

These are counts of frames assigned the expected nearest semitone. They are **not intonation-accuracy scores**. The strings' exact instantaneous frequencies were not independently measured, so the recording cannot establish cents-level F0 error. Adjacent overlapping frames are correlated. Start/end silence and transition windows are excluded from this table, not relabelled as correct.

The remaining C2 frames comprise two low-confidence and two weak-harmonic-evidence rejections; D3 has three low-confidence and one weak-harmonic rejection; A3 has four weak-harmonic rejections. No note is invented for them. Full-file final and raw rejection counts can be inspected in the app.

### A-string octave ambiguity

At frame centre **12.0047 s**, baseline Pitchy returns **110.9423 Hz** with **95.91%** raw clarity. The revised estimate is **221.8391 Hz**, with **80.46%** spectral support and **85.35%** candidate periodicity. At **13.1425 s**, the supported raw estimate **221.9367 Hz** is retained.

Around 12 s, strong spectral peaks occur near 222, 443, 1,110, 1,331 and 1,775 Hz. These fit a 222 Hz family. The 111 Hz alternative mostly explains those same peaks as even harmonics, adding an unnecessary subharmonic. Additional lower-frequency energy is visible around 92–121 Hz; a two-cycle period can score more highly in the mixed waveform than the desired one-cycle period. At 13.14 s, the shorter period becomes close enough to the highest NSDF peak for Pitchy's relative-peak rule to select it. High raw clarity therefore does not resolve the octave.

As a diagnostic ablation only, a sixth-order 160 Hz Butterworth high-pass design applied forward/backward offline raises the old detector's A3-labelled frames from 5/104 to 104/104 in this interval. This supports low-frequency interference affecting periodicity selection. It does **not** establish that a bow change, a particular resonance, fingering, or recording hardware caused that energy. The application does not apply this filter.

### C-string harmonic interference

During C2, the approximately 199 Hz third harmonic and 398 Hz sixth harmonic dominate. Weaker peaks around 265, 332 and 466 Hz support the approximately 66 Hz family. For example, at **3.9938 s** the raw detector selects **99.6434 Hz**, while the harmonic estimate is **66.5155 Hz**. Its supported harmonic numbers are 3, 4, 5, 6 and 7, rather than just the dominant 199/398 Hz pair.

At that frame, candidate periodicities are approximately 0.994 at 66.5 Hz and 0.969 at 99.8 Hz. A relative threshold of 0.97 can allow a shorter, slightly weaker period through; a dominant third harmonic can produce both an approximately 199 Hz choice and an approximately 99.5 Hz submultiple. The spectral evidence supports this mechanism. It does not identify the physical origin of every transient.

Removing the dominant 199/398 Hz components with forward/backward diagnostic notches (Q=12) makes the old detector mostly reject the weakened signal (only 9/120 C2 frames retained). Filtering out strong partials is therefore not a general solution and is not used by the application.

### D-string gaps

In the D3 evaluation interval, **53 baseline frames were rejected as out of range**, seven for low clarity, **zero for silence, and zero for isolated-octave instability**. Around 8 s, a roughly 148 Hz harmonic family coexists with substantial energy near 198 Hz. Their approximate common period corresponds to 49 Hz. At **8.0109 s**, raw Pitchy returns **49.3022 Hz / 98.04% clarity**, below the configured 55 Hz lower bound. The revised candidate is **147.8857 Hz**, with 68.35% spectral support and 46.06% periodicity. Its spectral family is better supported than the in-range alternatives despite modest mixed-waveform periodicity.

An offline diagnostic 198 Hz notch (Q=8) raises the old detector's D3 frames from 56/116 to 102/116. This supports the competing-component explanation, while leaving the source of that component unproven. The runtime estimator instead uses the original signal and can abstain where evidence remains weak.

## General-purpose estimator and tracking

All numeric settings are in `CELLO_CONFIG` in `src/lib/pitch.ts`; none encodes the sample's note sequence.

1. Keep the 4,096-sample (~186 ms) window, 512-sample (~23 ms) hop, DC removal, RMS threshold 0.003, and 55–1,000 Hz output range. Retain Pitchy's raw frequency, clarity and old rejection reason for comparison.
2. Use a Hann-windowed spectrum with 4× zero padding and log-parabolic peak interpolation (`fft.js`). Retain up to 32 peaks below 3 kHz above both 3.5% of the maximum amplitude and eight times the band median. Zero padding interpolates the spectrum; it does not create additional independent resolution.
3. Propose fundamentals from peak frequencies divided by integers 1–16. Match at most one peak per harmonic (up to harmonic 20), with tolerance `max(0.65 × sampleRate/windowSize, 0.008 × peakHz)`. Refine candidates by amplitude-weighted harmonic least squares. Retain five distinct alternatives.
4. Score explained peak amplitude, with a 0.025-weighted harmonic-order complexity penalty and a 0.20 penalty for common-divisor families. A candidate whose sufficiently strong matched harmonics still share a common divisor is ineligible. This prevents inventing, for example, 800 Hz solely from an out-of-range 1,600 Hz sine. Missing fundamentals with distinct coprime harmonics can still be supported.
5. Require spectral support ≥0.65, score ≥0.60, candidate periodicity ≥0.25, and a winning score margin ≥0.04. A candidate with only one matched peak also requires periodicity ≥0.90. Periodicity is NSDF interpolated at the candidate period; spectral support and scores are **not calibrated probabilities**.
6. Use up to three frames on either side (about ±70 ms) to add at most 0.05 to a candidate's score, with similarity tapering to zero by 80 cents. The bonus can resolve close choices but cannot bypass current-frame gates. It never changes the measured frequency, quantises a note, fills silence, or imposes a previous pitch indefinitely. Clear genuine changes can override continuity. The old unconditional isolated-octave deletion has been removed.
7. Retain the original Pitchy frequency if it passes the old gates and agrees within 15 cents with the selected harmonic candidate; otherwise use the candidate estimate. Weak or unresolved candidates become explicit gaps. Stable-region observations additionally require ≥75% spectral support and ≥0.08 winning margin.

Raw/tracked overlays, per-frame competing candidates, final/raw rejection breakdowns, score margins, RMS, and selected-candidate periodicity are available in Practice Studio. The existing cents graph, playback, timestamp seeking and cancellation remain integrated.

## Synthetic accuracy and behavioural regressions

The original 48-signal benchmark uses C2, G2, D3, A3, each at 0 and ±20 cents, with sine, rich harmonics, dominant-second and missing-fundamental waveforms. Signals last 1.5 s. Harmonic amplitudes are `[1]`, `[1,.8,.6,.4,.3,.2]`, `[.12,1,.4,.2]`, and `[0,1,.65,.3]`, normalised and scaled to 0.3.

| Check                                      | Revised measured result                                                                                                                | Required tolerance                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 48 stationary signals                      | Max absolute error **0.023322 cents**, mean **0.002486 cents**, minimum coverage **100%**                                              | Every accepted frame <3 cents error; every signal >95% coverage |
| Dominant-third tone at 82.4 Hz             | Max error **0.002 cents**, 100% coverage                                                                                               | <5 cents, ≥90% coverage                                         |
| 164.8 Hz tone with 220.1 Hz interference   | Max error **0.002 cents**, 100% coverage                                                                                               | <5 cents, ≥90% coverage                                         |
| 246.9 Hz tone with 110/135 Hz interference | Max error **0.001 cents**, 100% coverage                                                                                               | <5 cents, ≥90% coverage                                         |
| 160 cents/second glissando                 | Max difference from instantaneous frame-centre frequency **0.279 cents**, 100% coverage                                                | <10 cents, >90% coverage                                        |
| ±30-cent, 5 Hz synthetic vibrato           | Max difference from instantaneous centre frequency **24.199 cents**, 100% coverage; measured modulation remains >30 cents peak-to-peak | <25 cents, >90% coverage; not flattened or note-snapped         |
| 400 ms genuine octave change               | Correct octave retained in interior windows                                                                                            | <5 cents; no unconditional octave deletion                      |

Stationary-signal error is `abs(1200 × log2(estimated F0 / known F0))`; the mean averages per-signal accepted-frame means. This differs from cents deviation against the nearest equal-tempered note. The vibrato test deliberately exposes temporal averaging by the long window: tracking adds no frequency smoothing, but the estimator cannot preserve rapid modulation exactly. This is not a vibrato-characterisation feature.

Other automated checks cover uncertain candidate ties; neighbour support bounded against clear note changes; nonprimitive subharmonic rejection; noise, silence, DC offset, very quiet audio, invalid configurations, stereo cancellation, note conversion and signed cents; worker cancellation and decoding errors; and all prior microphone, upload, IndexedDB/playlist and WebM tests.

## Remaining limitations

One real recording has been used for development and regression. No independently measured real-cello F0 trajectory or diverse held-out dataset is available. More players, microphones, rooms, bow attacks, double stops and register changes may expose new errors. Broad real-cello cents accuracy is unverified.

A lone audible partial cannot reveal an absent intended fundamental. Coherent interference can still look harmonic. Inharmonic or broadened partials can bias the weighted frequency estimate. Weak partials may fall below the peak floor; candidates can be incorrect even with high periodicity or spectral support. The safe response to close or weak candidates is abstention, but the thresholds are heuristics rather than guarantees. Monophonic, mostly solo cello remains the intended input.

Browser/device codec, touchscreen, microphone and rendering checks remain manual; Node decoder/worker adapters and FFmpeg regression do not certify Safari/Chrome behaviour. Processing remains in a cancellable Web Worker and is more expensive than Pitchy alone (the supplied 14 s sample took approximately 4–8 s in this development environment). Mobile processing may be slower. No original audio, playlists, preferences, player code, microphone code or storage schema were changed.
