# Phase 2D.2A — Experimental multi-resolution pitch

Historical 2D.2A report. For the current opt-in implementation, see [Phase 2D.2B](experimental-pitch-recovery.md).

26 October 2026. Version `2D.2A.1`. **Standard remains the default. This experiment does not meet the criteria for replacing it.**

## What ships

Advanced Diagnostics → Pitch diagnostics now has a session-only **Pitch analysis mode** selector: Standard / Experimental. Selecting Experimental and running Analyse Intonation (or Analyse again) computes both paths from one decoded audio buffer in the existing tone worker. Toggling completed comparison views requires no new decoding or DSP. Reanalysis intentionally resets reviews, as before; export first.

The Advanced graphs can display adaptive estimates and the unchanged Standard overlay. They retain gaps, seeking and keyboard timestamp inspection. The comparison reports coverage, recovered frames, disagreements between eligible estimates, missing frames and separately timed Standard/experimental computation. The selected-frame panel gives source window, cycle count, candidate evidence and the arbitration reason. Expandable boundary proposals and feedback/review JSON export include the complete experimental diagnostics without audio.

Practice Mentor, Explore your performance and tone analysis **continue to use Standard measurements even while comparing Experimental in Advanced**. The baseline estimator (`pitch.ts` and `pitch-candidates.ts`), tone algorithm, audio decoding, player, microphone, IndexedDB schema and playlists are unchanged. No new external service, telemetry, secret or runtime dependency is introduced.

## Algorithm and explicit limits

The implementation is separate: [experimental-pitch.ts](../src/lib/experimental-pitch.ts) and [experimental-boundaries.ts](../src/lib/experimental-boundaries.ts). It reuses the baseline harmonic estimator, not expected note names or the Bach sequence.

1. Run Standard exactly as before: 4096/512 at 22050 Hz. Adaptive frame centres use integer `2048 + i × 512` sample positions, including the same unanalysed ends. No end padding or gap interpolation.
2. Calculate experimental boundary proposals from a 1024 Hann spectral window / 256 hop, low and upper magnitude-normalised bands (approximately 65–500 Hz and 500–3000 Hz), envelope changes and local flux peaks. The local threshold is `max(0.08, local median + 0.5 MAD)` over ±12 feature hops. Envelope changes of at least 4 dB can propose boundaries without a spectral peak; legato spectral changes do not require amplitude dips. Proposals have ±256-sample uncertainty and 35 ms suppression. Nearby changes in strong Standard harmonic candidates and Phase 2B flux are additional diagnostic cues, not sufficient evidence to assign pitch. The old sparse articulation event list is not used.
3. Retain accepted Standard estimates away from boundary proposals. Evaluate 2048 evidence when Standard is missing (except quiet frames) or its window overlaps a proposal. Cache only requested frame/window evidence, including neighbours required for corroboration. Dense boundaries can still request most 2048 frames; this is selective scheduling, not a guaranteed speed saving.
4. The short-window path requires primitive harmonic structure, support ≥0.8, periodicity ≥0.75, score ≥0.65, margin ≥0.08 and at least six cycles. These are **stricter** than baseline acceptance; baseline thresholds are unchanged. It retains the existing harmonic-match tolerance formula, whose absolute term broadens at shorter windows; its calibration remains a limitation.
5. Optional 1024 evidence is evaluated only when an eligible 2048 candidate independently establishes a register containing at least six periods in 1024 samples (about 129 Hz or higher). It corroborates the 2048 estimate within 35 cents; it never independently supplies the output frequency or establishes its own register.
6. Recovery also requires an eligible adjacent 2048 estimate within 80 cents, without crossing a proposed boundary, and a centre outside the boundary uncertainty interval. Either cross-resolution agreement or very strong 2048 evidence (support ≥0.95, periodicity ≥0.92, margin ≥0.15) is required. No nearest-previous-note selection, smoothing or note quantisation is applied.
7. Short/long disagreement >50 cents, or eligible 2048/1024 disagreement >35 cents, near changing content leaves **an adaptive gap**. The Standard trace is separately retained unchanged. This can withhold a previously correct Standard estimate, and does so in the open-string regression; it is not a released improvement.

“Independent evidence” means each candidate must pass its own acoustic gates; overlapping windows are not statistically independent observations. Scores/periodicity are not calibrated confidence probabilities. Boundary proposals are not verified note onsets or bow reversals. No physical technique or performer intention is inferred.

## Baseline reproduction and labelled measurements

The benchmark asserts exact reproduction of all 12 Phase 2D.1 Standard synthetic correct/wrong/withheld counts and the **214/919** Bach baseline. It evaluates on the same Standard-centre grid. Correct means within ±50 cents of the known active synthetic oscillator; accepted estimates outside tolerance count as wrong, and nulls count as withheld. Octave errors, accepted accuracy, correct/all, cent-error median/95th percentile, target-conditioned response timing, boundary matching and computation/memory measurements are retained in [results.json](data/experimental-pitch/results.json).

Selected development/regression results (**correct / wrong / withheld**):

| Case | Standard | Experimental |
| --- | ---: | ---: |
| Low notes, 125 ms | 20 / 6 / 10 | 23 / 4 / 9 |
| Low notes, 80 ms | 0 / 1 / 19 | 0 / 1 / 19 |
| Arpeggio, 125 ms | 56 / 0 / 23 | 58 / 0 / 21 |
| Arpeggio, 80 ms | 0 / 0 / 48 | 8 / 0 / 40 |
| Arpeggio with resonance tails, 125 ms | 28 / 18 / 33 | 28 / 17 / 34 |
| Arpeggio with attack noise, 125 ms | 55 / 0 / 24 | 59 / 0 / 20 |
| Arpeggio with weak fundamental, 125 ms | 49 / 11 / 19 | 55 / 8 / 16 |
| Chromatic, 125 ms | 48 / 0 / 31 | 50 / 0 / 29 |
| True octave leaps | 42 / 6 / 13 | 47 / 4 / 10 |
| Repeated notes | 14 / 0 / 22 | 18 / 0 / 18 |
| Vibrato / glissando, each | 79 / 0 / 0 | 79 / 0 / 0 |
| Real V1 labelled open-string regions, pooled | 452 / 0 / 12 | 451 / 0 / 13 |

Separate sustained C2/G2/D3/A3 synthetic tests retain all 36/36 accepted reference frames for each note. The two original detuned stationary synthetic controls retain 79/79 each. Silence and deterministic noise both produce zero accepted frames in either mode. The existing Standard A3 octave-error, C2 harmonic-interference and D3 coverage regressions remain in the test suite. Experimental preservation is not inferred from Standard test success: its pooled real V1 result above explicitly fails strict correct-frame non-regression.

For clean 125 ms arpeggios, correct/all improves from 70.89% to 73.42%, with accepted accuracy 100% on this synthetic case. Median absolute cents error changes from 0.282 to 0.297; 95th percentile is 1.525 versus 1.517 cents. All 15 new-note responses are found, but the 95th-percentile response error remains **50.87 ms**, narrowly missing the proposed ≤50 ms criterion.

For 80 ms arpeggios, correct/all improves from 0% to 16.67%; the eight accepted adaptive frames are correct against the synthetic reference. Only eight of 15 transitions have an accepted new-note response; seven remain missing. Its response 95th percentile is **53.17 ms**. Response timing uses the Phase 2D.1 target-conditioned metric, not independent onset recall, and is not live audio latency.

## Held-out synthetic configurations

The separate evaluation generator uses seeds **701, 809, 997, 1237**, 18 randomly chosen notes, detuning, different harmonic envelopes/phases, 135/85 ms notes, weak fundamentals and overlapping tails. These cases are separate from the Phase 2D.1 development patterns. Thresholds were not adjusted to improve their observed error counts. They remain a small, synthetic evaluation set, not evidence of general cello accuracy or a large independent corpus.

| Seed / texture | Standard correct / wrong / withheld | Experimental |
| --- | ---: | ---: |
| 701 / legato | 68 / 9 / 20 | 69 / 8 / 20 |
| 809 / weak fundamental | 8 / 6 / 44 | 17 / 5 / 36 |
| 997 / overlapping tails | 42 / 6 / 49 | 41 / 6 / 50 |
| 1237 / overlapping tails | 3 / 10 / 45 | 3 / 10 / 45 |

This confirms the remaining problem: resonance mixtures still give wrong accepted notes, and conservative disagreement handling can remove a correct one. No threshold was relaxed to fill the graph. The active oscillator labels a target in deliberately mixed synthetic audio; that does not establish a uniquely recoverable fundamental in real overlapping resonance.

## Boundary evidence and Bach results

At ±50 ms one-to-one matching, the experimental boundary layer finds all 15 clean 125 ms arpeggio onsets with 15 proposals, compared with zero proposals from the old Phase 2B threshold in the audit. Boundary absolute timing p95 is 12.59 ms. Held-out 701/809/1237 have 17/17 matched proposals; overlap seed 997 produces 23 proposals for 17 onsets (17 matches, precision 73.9%, recall 100%). These are limited synthetic results. Good boundary recall does not guarantee reliable pitch recovery.

For the original Bach excerpt, Standard accepts **214/919 (23.29%)**, Experimental **217/919 (23.61%)**: three additional candidates, 702 adaptive frames still withheld. No additional correct-note claim is made. The V2 cello sample changes from 1301/1574 to 1302/1574 accepted frames; it likewise has no independently labelled exact F0 trajectory for accuracy evaluation. Original recordings and PCM are not committed.

## Performance, memory, cancellation and integration

The saved benchmark is one wall-clock run per case under Node on a shared execution host, including cold/JIT effects; some validation work overlapped the later real-audio runs. These are diagnostic measurements, not controlled speed comparisons with the earlier audit or browser guarantees. On this run Bach Standard pitch took **17.66 s**, with **13.25 s additional** experimental work; V1 took 11.75 + 10.44 s. Decode/tone time is excluded. The experiment is not yet optimised for speed.

The process high-water RSS reached **293,984 KiB (about 287 MiB)** across the entire sequential benchmark, not per-analysis or browser peak memory. Heap/ArrayBuffer deltas are affected by garbage collection, sometimes negative; they are not peak allocations. The serialized comparison payload was about 2.38 MB for Bach and 3.90 MB for V2. Longer recordings can use substantially more memory; ten-minute/browser peak memory remains uncharacterised. Caches are local to one worker job and discarded after it terminates. The feedback worker receives only Standard pitch/tone, avoiding copying the full comparison a second time.

Cancellation terminates the existing worker, rather than waiting for a synchronous DSP loop to process an abort message. A Node worker-thread test terminated active experimental work in **35.1 ms**, before completion. This is a measured thread-level check, not certified browser timing. Browser adapter tests cover abort/error cleanup; session tests cover stale responses and recording switches. Both modes use one decode and one copied-channel transfer per requested run. Switching comparison views uses cached results; explicit reanalysis decodes again by design.

## Release decision

**Keep Experimental optional. Do not promote it to Standard.**

Validation completed: `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` passed. All **87 tests passed with zero failures or skips**, including the two supplied private cello regressions. Component tests cover the Standard default, explicit experimental reanalysis, cached mode switching and the continued Standard-backed Explore/Mentor flow. Adapter tests verify one decode per requested comparison and reject missing/malformed experimental results. Production HTTP checks passed for all five application routes and delivery of the feedback and analysis worker JavaScript. Real-browser microphone, mobile layout and interactive graph checks still require the acceptance steps below.

- Standard source and all existing application paths are preserved.
- Some labelled fast sequences gain correct frames without adding wrong ones; the 80 ms arpeggio clears a 15-point correct/all gain, but 125 ms and low-register cases do not consistently do so.
- The V1 correct-frame count falls by one; the strict sustained preservation gate fails.
- Resonance failures remain severe; one held-out case loses a correct frame.
- Clean 125 ms response p95 remains above 50 ms, and 80 ms misses nearly half the note responses.
- Real Bach accuracy and onset recall remain unknown without independent labels.

Next work should evaluate false boundary proposals on sustained real cello, segment-internal pitch evidence near transitions, and calibration of short-window harmonic matching. Use a new held-out set for subsequent tuning. Do not improve apparent coverage by weakening gates or hiding withheld frames.

## Reproduction and Vercel acceptance

```sh
STRINGMENTOR_BACH_PATH='/path/to/Yo-yo Ma Prelude Bach Recording.m4a' \
STRINGMENTOR_CELLO_SAMPLE_PATH='/path/to/Cello Open Strings sample.m4a' \
STRINGMENTOR_CELLO_V2_PATH='/path/to/Cello Open Strings Sample V2.m4a' \
npm run benchmark:pitch
```

Requires FFmpeg. The runner hash-checks each private recording, reproduces the baseline and saves measurement-only JSON under ignored `work/experimental/`. Missing private inputs are marked unavailable. `npm test` runs synthetic/lifecycle/UI regression cases; supply the two existing cello environment variables for the private Standard regressions.

After the new deployment is ready:

1. Open Practice Studio, load audio and run ordinary analysis. Standard must remain selected by default; existing Mentor, graphs, notes, player and library should work.
2. Open Advanced Diagnostics → Pitch diagnostics. Select Experimental, then Analyse again. Export reviews before reanalysis. Wait for the local comparison; switching Standard/Experimental afterwards should be instant and not start decoding again.
3. Inspect adaptive gaps, ivory Standard overlay, coverage/recovered/disagreement counts and timing. Move the timestamp inspector and expand Adaptive decision; use existing graph seeking/playback.
4. Change practice goals. Feedback must continue to use Standard data. Export feedback/reviews and inspect `experimentalComparison` separately from the Standard-backed feedback.
5. Start Experimental on a longer recording, cancel, then switch recording or navigate away. No stale comparison should appear. Confirm recordings/playlists/settings survive refresh, and test microphone recording as usual.
6. Repeat with keyboard navigation, narrow mobile layout and current Chrome/Safari. Automated component and HTTP tests do not replace real browser interaction checks.
