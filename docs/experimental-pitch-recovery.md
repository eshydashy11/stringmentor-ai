# Phase 2D.2B — Evidence-guided experimental pitch recovery

Version `2D.2B.1`. Standard remains the default and the source for Practice Mentor, Explore and tone analysis. The revised path remains an opt-in Advanced Diagnostics comparison. It does not replace the baseline detector.

## Evidence available and unavailable

The Beethoven excerpt was **not supplied** in this workspace. The reported 261/680 Standard and 265/680 experimental accepted counts, 144 proposals, and the two timestamp examples are user-provided evidence, not measurements reproduced here. The rejection counts supplied total 415, consistent with 265 accepted out of 680; they should not be assigned to Standard without its export. There is no new Beethoven coverage or correctness claim.

At 5.596 s, support 0.77 misses the experimental 0.80 requirement by 0.03. Periodicity 0.91, score 0.73 and 17.5 cycles could satisfy the other displayed gates. The candidate margin, primitive harmonic indices, neighbouring measurements and other-resolution evidence are missing. Those four scalar measurements alone cannot establish 188.6 Hz as reliable. A constructed policy test supplies the missing evidence explicitly; it is not an acoustic regression of the Beethoven frame.

At 8.313 s, competing estimates 125.2, 83.2, 71.0, 134.6 and 142.6 Hz and multiple failed gates remain unresolved. Cello-only audio can contain overlapping resonances, nonstationary transitions and bow noise, but none of those explanations has been confirmed for this frame. Tests ensure such multi-gate failures cannot be rescued by neighbouring pitches. No piano or accompaniment is assumed.

Actual private regressions use the hash-verified original open-string recording, V2 and the earlier Bach excerpt. V1 has labelled sustained-note regions; V2 and Bach do not have independently annotated F0 trajectories. Their accepted counts are coverage measurements only. No original audio, PCM or external audio service is added to the repository.

## Changes and decision policy

The implementation is confined to the experimental engine, its diagnostic UI, tests and benchmark tooling. `pitch.ts`, `pitch-candidates.ts`, tone analysis, recording, playback, IndexedDB, playlists and microphone handling remain unchanged.

- **Keep evidence before selection.** The best harmonic candidate, raw Pitchy estimate, actual score margin, primitive harmonic indices, cycle count and numeric gate results remain available when selection withholds a frame. Previously the short-window path discarded the candidate frequency immediately on a failed gate. Margins now use the actual local score difference even when no candidate passed the baseline tracker.
- **Preserve strict gates.** Ordinary short-window evidence still requires support ≥0.80, periodicity ≥0.75, score ≥0.65, margin ≥0.08, primitive structure, six cycles, amplitude ≥0.003 RMS and the existing 55–1000 Hz range. No global support threshold is lowered.
- **Narrow support-only exception.** Support must be in [0.75, 0.80), and it must be the only failed acoustic gate. Additionally require periodicity ≥0.90, score ≥0.70, a visible fundamental and at least three matched harmonics. Independently strict-eligible 2048 estimates must support the candidate on both sides within ±1024 samples (46.44 ms), without crossing a supported boundary. An independently eligible 1024 estimate must agree within 35 cents and contain at least six cycles. The original failed gate is retained and the exception is explicitly marked. This conservative path cannot recover low-register near misses when 1024 samples contain too few cycles.
- **Bounded segment-aware selection.** Examine independently gated 2048 candidates at ±512/1024 samples. Recovered outputs never become anchors. The nearest eligible anchor on each available side must agree within 80 cents; any conflicting side blocks recovery, including octave and subharmonic alternatives. A strict candidate needs one agreeing neighbour plus cross-resolution agreement, or very strong support/periodicity/margin (0.95/0.92/0.15) with bilateral agreement. No runner-up with a failed margin is promoted. The output is the measured local estimate, never an interpolated value or a nearest previous note.
- **Transitions remain possible.** There is no fixed semitone target, sequence prior, cumulative note lock, smoothing or frequency quantisation. Selection resets across supported boundaries. Genuine leaps and octave changes can pass once local acoustic evidence supports them. Rapid transitions with insufficient evidence remain gaps; the bilateral rule can delay recovery around attacks and releases.
- **Protect stable long-window evidence.** Accepted Standard frames away from supported boundaries are retained. Near boundaries, short-window conflicts can withhold adaptive estimates unless accepted Standard neighbours on both sides agree within 80 cents without crossing a boundary. Such retained conflicts are described in the frame diagnostics. The unchanged Standard overlay is always available.

Windows remain 4096/2048/1024 at 22050 Hz on the Standard 512-hop output grid. Optional 1024 evidence only corroborates a register established by the medium candidate. This is offline bounded look-around, not a live latency guarantee. Overlapping windows are separately gated but are not statistically independent observations; scores are not calibrated probabilities.

## Acoustic proposals versus segmentation

The original multiband flux/envelope proposal detector and its thresholds are retained. Every proposal stays in diagnostics/export. A separate classifier decides whether it should constrain pitch tracking:

1. Two independently gated 2048 estimates on each side, centred 1024/1536 samples from the proposal, must be internally consistent within 80 cents. A before/after change of at least 90 cents supports a tentative pitch-transition barrier.
2. Alternatively, an envelope change of at least 4 dB coinciding with low-band flux above the proposal threshold forms a conservative articulation/transition barrier.
3. Other proposals remain unconfirmed acoustic changes. Upper-band fluctuation or an envelope change alone does not establish a boundary.

Recovery centres are excluded inside the declared ±256-sample uncertainty interval. The previous implementation expanded that interval by another 256 samples while describing it as the boundary interval; the revised test matches the declared interval. Long-window overlap still uses the full half-window. These geometric and acoustic rules do not inspect graph continuity or labelled note identities.

Neither retained proposals nor segmentation barriers are confirmed note onsets or bow reversals. This classifier is intentionally conservative and can miss rapid boundaries when either side lacks eligible evidence. Competing eligible neighbouring candidates still block pitch recovery even if no boundary was classified. Bow dynamics can also form a conservative barrier within one note.

## Diagnostics and inspection

Advanced Diagnostics → Pitch diagnostics → Experimental → Analyse again computes the comparison locally. The frame inspector distinguishes amplitude, harmonic support, periodicity, candidate score, candidate ambiguity, cycles, primitive structure, range, cross-resolution disagreement/unavailable corroboration, boundary overlap, insufficient bilateral support and conflicting segment evidence.

Numeric gate values, thresholds and the size of a support near miss are shown. Candidate lists include harmonic indices and frequency ratios to the leading candidate without asserting that any candidate is correct. Aggregate rejection counts overlap because one frame can fail multiple requirements. Proposals show whether and why they constrained segmentation. Export feedback & reviews includes all experimental decisions separately from Standard-backed feedback.

## Numerical validation

Full measurements: [2D.2B results](data/experimental-pitch-recovery/results.json); unchanged comparator: [2D.2A results](data/experimental-pitch/results.json). The runner asserts exact reproduction of all twelve original Standard synthetic baselines and Bach Standard 214/919. Correct means within ±50 cents of the labelled active fundamental at the aligned frame centre. Nulls are withheld; other accepted estimates are wrong. V1 regions validate note identity relative to nominal open-string frequencies, not perfect tuning. Synthetic overlapping tails deliberately contain another decaying oscillator, so a labelled active target is not necessarily a uniquely recoverable single F0.

Counts are **correct / wrong / withheld**. “Newly recovered” counts are restricted to frames Standard withheld and do not conceal retained Standard errors.

| Case                            |     Standard | Previous experiment (2D.2A) | Revised experiment (2D.2B) |
| ------------------------------- | -----------: | --------------------------: | -------------------------: |
| low-0.125-clean                 |  20 / 6 / 10 |                  23 / 4 / 9 |                 23 / 4 / 9 |
| low-0.08-clean                  |   0 / 1 / 19 |                  0 / 1 / 19 |                 0 / 1 / 19 |
| arpeggio-0.125-clean            |  56 / 0 / 23 |                 58 / 0 / 21 |                60 / 0 / 19 |
| arpeggio-0.08-clean             |   0 / 0 / 48 |                  8 / 0 / 40 |                 9 / 0 / 39 |
| arpeggio-0.125-resonance        | 28 / 18 / 33 |                28 / 17 / 34 |               28 / 18 / 33 |
| arpeggio-0.125-attack-noise     |  55 / 0 / 24 |                 59 / 0 / 20 |                59 / 0 / 20 |
| arpeggio-0.125-weak-fundamental | 49 / 11 / 19 |                 55 / 8 / 16 |                55 / 8 / 16 |
| chromatic-0.125-clean           |  48 / 0 / 31 |                 50 / 0 / 29 |                53 / 0 / 26 |
| true-octaves                    |  42 / 6 / 13 |                 47 / 4 / 10 |                47 / 4 / 10 |
| repeated-notes                  |  14 / 0 / 22 |                 18 / 0 / 18 |                26 / 0 / 10 |
| vibrato                         |   79 / 0 / 0 |                  79 / 0 / 0 |                 79 / 0 / 0 |
| glissando                       |   79 / 0 / 0 |                  79 / 0 / 0 |                 79 / 0 / 0 |
| held-out-701                    |  68 / 9 / 20 |                 69 / 8 / 20 |                71 / 8 / 18 |
| held-out-809                    |   8 / 6 / 44 |                 17 / 5 / 36 |                20 / 6 / 32 |
| held-out-997                    |  42 / 6 / 49 |                 41 / 6 / 50 |                42 / 6 / 49 |
| held-out-1237                   |  3 / 10 / 45 |                 3 / 10 / 45 |                3 / 10 / 45 |
| open-strings                    | 452 / 0 / 12 |                451 / 0 / 13 |               452 / 0 / 12 |

**Regressions relative to 2D.2A are visible above:** the resonance development case retains 18 wrong Standard estimates instead of withholding one of them (2D.2A had 17); seed 809 retains six wrong instead of five. Neither is a newly recovered pitch, but both are wrong accepted outputs and prevent an unconditional non-regression claim against the previous experiment. All accepted Standard frames in both real open-string files are preserved. V1's previously lost correct frame is restored; this does not imply that every retained Standard estimate is correct in other audio.

Across the 12 development cases: 877 / 42 / 240 → 912 / 35 / 212. The extra labelled regression controls: 358 / 6 / 35 → 375 / 4 / 20. Previous evaluation seeds: 121 / 31 / 158 → 136 / 30 / 144. Across all labelled synthetic benchmark groups, 94 newly recovered frames were correct and zero newly recovered frames were wrong at the ±50-cent tolerance. That is a finite synthetic result, not a guarantee for real recordings.

### New held-out sequences

| Seed / texture                   |     Standard | Revised experiment | Newly recovered correct / wrong |
| -------------------------------- | -----------: | -----------------: | ------------------------------: |
| held-out-1601 / legato           |  40 / 7 / 35 |        53 / 6 / 23 |                          13 / 0 |
| held-out-1777 / weak-fundamental |  16 / 7 / 43 |        30 / 6 / 30 |                          14 / 0 |
| held-out-2029 / overlap          | 16 / 22 / 44 |       16 / 22 / 44 |                           0 / 0 |
| held-out-2411 / overlap          |   5 / 7 / 54 |         5 / 7 / 54 |                           0 / 0 |

Pooled held-out counts: **77 / 43 / 176 → 104 / 41 / 151**, including 27 newly recovered correct and zero newly recovered wrong estimates. Correct/all rises from 26.0% to 35.1%, but accepted accuracy is only 71.7% (104/145) because baseline errors remain. The two overlap cases gain nothing and retain 29 wrong estimates between them. They are a major remaining limitation, not a solved ambiguity problem.

### Boundary and motion controls

Clean 125 ms arpeggios retain 15/15 segmentation proposals matching all 15 true transitions within ±50 ms; boundary timing absolute p95 is 12.59 ms. The target-conditioned pitch response finds all 15 new notes; absolute p95 improves from 50.87 ms in 2D.2A to 34.12 ms. Accepted pitch error on this clean case has median 0.295 cents and p95 1.509 cents against its synthetic oscillator. This is an offline response metric, not independent onset detection or live latency.

At 80 ms, nine accepted frames are correct, but only seven of 15 new-note responses are found (eight in 2D.2A); eight responses remain missing. No proposals qualify as segmentation barriers. Response p95 of the seven found responses is 48.29 ms, which must not be read without the missing count. Very fast low-register notes still produce 0 correct / 1 wrong / 19 withheld.

The classifier treats vibrato's 10, glissando's 19 and noise's 13 acoustic proposals as unconfirmed changes; none becomes a barrier. Dedicated constant-pitch controls produce 15 proposals during harmonic-amplitude variation and 18 during simulated noise bursts, with zero barriers and 79 correct / 0 wrong / 0 withheld frames in each mode. These generated controls have no note transitions. Repeated notes retain seven acoustic proposals but zero segmentation barriers: onset recall is not established by the smoother pitch trace. In previous overlap seed 997, the original 23 proposals include 17 matching transitions, but none qualifies as a barrier. This rejects false positives at the cost of missed true boundaries; it is not a generally accurate onset detector.

### Private recordings, coverage only where unlabelled

| Recording         | Standard accepted | 2D.2A accepted | 2D.2B accepted | Raw proposals / segmentation barriers |
| ----------------- | ----------------: | -------------: | -------------: | ------------------------------------: |
| V1, complete file |           506/596 |        505/596 |        506/596 |                               130 / 1 |
| V2                |         1301/1574 |      1302/1574 |      1313/1574 |                               225 / 0 |
| Bach              |           214/919 |        217/919 |        220/919 |                               175 / 2 |

V1's labelled sustained regions remain **452 correct / 0 wrong / 12 withheld**. Its C2 harmonic-interference, D3 subharmonic-range and A3 bow-change timestamps still pass the existing tests. Both V1 and V2 additionally assert that every Standard-accepted frequency is retained by the revised experiment. V2's 12 and Bach's six recovered frames have **unknown correctness**. No new labelled solo-cellist corpus was available.

The support-only exception did **not** activate on any complete benchmark case, including the available real recordings. It is covered by constructed positive and negative policy tests, but its real acoustic effectiveness and false-accept rate remain unvalidated. In Bach, seven support-only near-miss measurements were exposed; the additional safeguards withheld them. This is deliberate uncertainty, not evidence that the Beethoven candidate should also be withheld or accepted.

### Runtime, checks and decision

The saved benchmark includes wall-clock timings, heap/ArrayBuffer deltas, process high-water RSS and serialized comparison sizes. Shared-host contention occurred during the run; timing cannot support a controlled speed comparison. Bach measured 180.81 s Standard plus 69.86 s experimental, V1 15.97 + 10.48 s, and V2 16.91 + 7.81 s, excluding decode/tone. Process high-water RSS reached 279,220 KiB (about 273 MiB); it is not per-recording/browser peak memory. Payload sizes were about 2.86 MB for Bach/V2. Browser/mobile speed, long-recording memory and cross-browser DSP behaviour remain uncharacterised.

The revised method is **promising enough for additional labelled real-world validation as an opt-in experiment**: it recovers additional correct synthetic frames and restores open-string non-regression. It is **not ready to replace Standard**. Resonance ambiguity, retained wrong baseline estimates, missed fast-note responses, conservative/under-sensitive segmentation and unvalidated real-world support exceptions remain. The Beethoven recording is required before claiming improvement on the reported failure evidence.

## Reproduction and further validation

Completed checks: `npm run typecheck`, `npm run lint`, `npm test` (**92 passed, zero failed or skipped**, with both private audio variables supplied), and `npm run build`. Production HTTP smoke checks passed for all five routes, navigation/expected controls, the 404 route, and tone/feedback worker delivery. Standard/audio/storage source files are unchanged. The new tests cover support-only positive/negative cases, multiple failed gates, conflicting octave estimates, boundary evidence, harmonic variation/noise bursts, numeric diagnostic rendering and accepted-frame preservation on both real open-string files.

An earlier focused run hit its 60-second worker-readiness timeout while the benchmark and lint were also running. The subsequent complete suite passed; experimental worker termination measured 20.4 ms without receiving completion. This does not establish browser cancellation latency under all loads.

Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`. Supply `STRINGMENTOR_CELLO_SAMPLE_PATH` and `STRINGMENTOR_CELLO_V2_PATH` to include the private-file regressions (FFmpeg required). Without those files the corresponding tests explicitly skip.

Run `npm run benchmark:pitch` with those variables plus `STRINGMENTOR_BACH_PATH` to reproduce the benchmark. `-- --real-only` restricts it to available private recordings; `-- --diagnostics` also writes complete local measurement diagnostics. Outputs go to ignored `work/experimental-b/`; they contain measurements, not audio. Missing files are recorded as unavailable. The earlier 2D.2A snapshot is preserved for comparison.

The held-out evaluation uses new seeds 1601, 1777, 2029 and 2411 with 115/95 ms notes, random register/leaps/detuning, weak fundamentals and resonance tails. These cases were frozen before evaluating them; parameters were not adjusted in response to their results. Seeds 701/809/997/1237 are now previous evaluation controls, not newly held-out evidence.

For Beethoven validation, supply the original audio and preferably its full feedback/reviews export. Inspect spectra, candidate harmonic families and independently gated surrounding windows at 5.596 and 8.313 s before assigning causes. Obtain timestamped F0/note and transition labels from multiple solo-cellist takes, including quiet playing, fast low notes, resonances, repeated notes, portamento and vibrato. Count newly accepted wrong estimates separately from retained baseline errors. Commercial unlabelled excerpts can test coverage and failure patterns but cannot establish correct-note accuracy.

After deployment, verify the Standard default, explicit experimental reanalysis, graph seeking, keyboard timestamp controls, cancellation, recording switches, export, local persistence and microphone playback in current Chrome/Safari and at mobile width. Automated component and HTTP tests do not establish real-browser interaction correctness.
