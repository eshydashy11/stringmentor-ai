# Cello pitch analysis: validation and accuracy

## Reproduce

Run `npm ci`, then `npm test` with Node.js 22.18 or later. The benchmark prints its measured maximum and mean absolute cents errors and minimum coverage. Production uses the same `analysePitch` implementation and Pitchy dependency as these tests, inside a browser Web Worker.

## Synthetic benchmark

Measured on 17 October 2026 using Pitchy 4.1.0, 22,050 Hz sampling, 4,096-sample windows, 512-sample hops, minimum RMS 0.003, minimum clarity 0.90, and relative peak threshold 0.97.

| Property                                    | Test set / measured result                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Fundamental notes                           | Equal-tempered C2 65.406391 Hz, G2 97.998859 Hz, D3 146.832384 Hz, A3 220 Hz                           |
| Detuning                                    | 0, +20, −20 cents for every note                                                                       |
| Waveforms                                   | Sine; rich harmonics; dominant second harmonic; missing fundamental with second/third/fourth harmonics |
| Total                                       | 48 deterministic signals, each 1.5 seconds                                                             |
| Harmonic amplitudes                         | `[1]`; `[1,.8,.6,.4,.3,.2]`; `[.12,1,.4,.2]`; `[0,1,.65,.3]`, normalised and scaled to 0.3             |
| Maximum absolute F0 error, accepted frames  | **0.023322 cents**                                                                                     |
| Mean absolute F0 error, accepted frames     | **0.002482 cents**                                                                                     |
| Lowest usable-frame coverage across signals | **98.25%**                                                                                             |
| Required tolerance                          | Every accepted frame <3 cents absolute error; every signal >95% coverage                               |

Error is `abs(1200 × log2(estimated F0 / known F0))`, not deviation from the nearest note. All signals have the same length and frame count; mean error averages per-signal means. Rejected frames are excluded from error calculations and represented in coverage. The octave stress cases test dominant harmonics and missing fundamentals; isolated octave spikes are also tested directly. A pure second harmonic with no evidence of a lower fundamental is inherently ambiguous and cannot establish an intended lower note.

**These are clean synthetic periodic signals, not recordings of a real cello. These numbers do not establish real-cello accuracy, technique assessment, or performance under room acoustics, bow noise, articulation, vibrato, accompaniment, microphone processing, lossy compression, or device clock error.** No such acoustic validation has been completed.

## Other automated checks

- Note naming and MIDI mapping for all four open strings; cents arithmetic within 1e-9 cents for exact frequency conversions, including positive and negative detuning.
- Silence, DC-only input, and tones at amplitude 0.0001 produce no usable pitch. DC offsets are removed before estimation.
- Seeded broadband noise produces no usable pitch: either low clarity or outside the cello range. A few long-lag peaks can have high periodicity without representing a usable cello pitch; range rejection remains necessary.
- Range filtering, very short inputs, non-finite PCM, invalid settings, and empty input.
- Stereo averaging, silent-channel handling, and opposite-phase cancellation fallback.
- Rejection of isolated octave spikes while preserving sustained octave changes.
- Stable above/below-reference observations on measured detuned tones; no stable-region judgments on the tested transition and oscillating-pitch sequences.
- Accurate frame-centre timestamps, hop spacing, and monotonic progress.
- Decoding errors, unreadable and oversized files, duration limits, and cancellation before/during decoding, using injected decoder adapters.
- Worker lifecycle tests: copied audio buffers, progress/results, cancellation, worker errors, message errors, and termination, using worker adapters.
- Existing upload, microphone, IndexedDB recording/playlist round-trip, and WebM duration tests remain in the test suite.

The adapter tests exercise application error handling and lifecycle logic, not native browser codecs. Manual Chrome/Safari testing, microphone capture, mobile rendering, and labelled real-cello evaluation remain outstanding. Follow the README's live-site checklist. No browser data reset or IndexedDB migration is required.
