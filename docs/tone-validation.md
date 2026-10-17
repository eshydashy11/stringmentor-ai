# Phase 2B: acoustic tone and articulation validation

Version **2B.1**, 17 October 2026. This is a development implementation with explicit measurements and conservative event hypotheses. It is not a validated bow-technique assessment or a tone-quality grading system.

## Architecture and preservation

`src/lib/tone.ts` contains acoustic features, event proposals, interval statistics and deterministic observations. `tone.worker.ts` runs the unchanged harmonic-aware `analysePitch` for time-aligned context, then the independent tone module. It does not change the pitch algorithm, thresholds, raw/corrected diagnostics or intonation graphs. Tone analysis currently recalculates pitch context instead of sharing mutable results with the intonation UI; two independently launched jobs can run concurrently and use additional CPU/memory.

The existing decoder reads a copy of the selected uploaded or microphone-recorded Blob at 22,050 Hz. Channel averaging and the existing severe-phase-cancellation fallback are reused. Clipping evidence is counted on each decoded channel before mixing. Original audio, the player, microphone controller, recording metadata, playlist logic, settings and IndexedDB schema are unchanged. No audio or analysis is sent to a server. There is no LLM or external analysis service.

A recording-keyed UI session owns its worker and results. Cancel, recording changes, route departure and pagehide terminate the worker. Late native decode results are ignored after cancellation; browser decoding itself cannot be interrupted. Progress covers pitch context (0–70%) and acoustic processing (70–100%). Worker startup, message, processing and transfer/allocation failures have visible errors. The existing 100 MB compressed-file and ten-minute decoded-duration limits apply. A large compressed file can still require substantial decoded memory before duration is known; browser/device memory limits remain relevant.

## Raw measurements and units

All timestamps are window centres. Only complete windows are analysed; no zero-filled endpoint measurements are invented. Adjacent frames overlap and are not statistically independent.

| Measurement             | Definition and settings                                                                                      | Meaning / limits                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| RMS amplitude           | DC-removed RMS over 1,024 samples (46.44 ms), hop 256 (11.61 ms)                                             | Digital waveform amplitude, not calibrated physical sound intensity                                                                 |
| Level / dynamic contour | `20 log10(RMS)` dBFS; display floor −120 dBFS                                                                | RMS 1 is 0 dBFS; full-scale-peak sine is approximately −3.01 dBFS. Not perceived loudness or dB SPL                                 |
| Spectral centroid       | Hann window, 2,048 samples (92.88 ms); magnitude-weighted mean frequency in 50–8,000 Hz                      | Brightness proxy in that band; spectral resolution about 10.77 Hz. Not a fundamental-frequency estimate                             |
| Spectral flatness       | Geometric mean / arithmetic mean spectral **power** in the same band; numerical power floor `1e-20`          | Unitless 0–1, noise-related distribution indicator. Not a noise fraction or quality grade                                           |
| Spectral flux           | Sum of positive changes between adjacent magnitude spectra, each normalised to sum to 1                      | Unitless 0–1, largely gain-normalised spectral change. Envelope transients can themselves change spectrum; cues are not independent |
| Pitch harmonic support  | The existing estimator's explained retained peak-amplitude share below 3 kHz, only for an accepted pitch     | Harmonicity-related evidence. Not broadband HNR or SNR; excludes weak/unretained peaks and cannot isolate noise source              |
| Pitch periodicity       | Existing selected-candidate periodicity, only with accepted pitch                                            | Repeatability of the waveform at the selected period, not confidence in physical technique                                          |
| Local consistency       | Standard deviation of level (dB) and centroid (Hz) in a centred ~0.5 s window                                | Withheld unless every local frame is above the level floor; may include real dynamics or note changes. Not a stability grade        |
| Possible clipping       | Count channel samples with magnitude ≥0.999; report peak and longest consecutive near-rail run; flag runs ≥3 | Count samples once, not overlapping-frame duplicates. Evidence of proximity to the digital rail, not proof of original ADC clipping |

RMS below 0.003 (−50.46 dBFS) suppresses spectral interpretation. Flux resets across quiet frames. This fixed analysis floor is not a learned ambient-noise estimate. Pitch is aligned by the nearest existing pitch-frame centre within 18 ms; missing pitch remains missing. Pitch windows are longer (~186 ms), so pitch context is coarser than acoustic event timestamps.

Interval summaries show the proportion above the floor and with usable pitch. Level means use energy averaging of active-frame RMS; level spread uses population SD in dB. Brightness and noise-related averages use active measured frames. Averages do **not** include quiet frames, so coverage must be read alongside them. Whole-recording means mixing different registers are descriptive, not comparable tone ratings.

## Event detection: evidence, then a tentative label

No note sequence, string order, number of strokes or timing from either real recording enters production code.

1. For every eligible frame, compare median levels and spectral properties 70–220 ms before and after it. At least 80% of each flank must be above the level floor. Recording onsets/offsets without sound on both sides are intentionally excluded.
2. Measure a dip relative to the quieter flank, a peak relative to the louder flank, and the signed before/after level step. Inspect maximum flux within ±70 ms. The flux threshold is `max(0.08, median(flux) + 4 × MAD(flux))` across the recording.
3. Energy evidence is a dip ≥3 dB, step magnitude ≥4 dB, or peak ≥5 dB. Structural change is centroid change ≥0.25 octave or flatness change ≥0.08. Propose an event for energy + flux, flux + structural change, or a strong energy-only event (dip ≥6 dB, step/peak ≥8 dB). Strong energy alone remains uncertain unless pitch identifies a change.
4. Pitch context uses 120–380 ms flanks: at least five usable samples, ≥60% pitch coverage and SD ≤0.35 semitone on each side. A before/after change ≥75 cents labels a **note-change candidate**. A change ≤35 cents, a dip ≥3 dB **and** sufficient flux labels a **candidate bow reversal**. Spectral changes with peaks/noise-like changes, or structural changes without a qualifying dip, become **other acoustic transients**. Remaining proposals are **uncertain**. Rapid glissandi or pitch errors can affect these labels.
5. Rank by normalised energy contrast plus flux, with a note-change preference, then apply non-maximum suppression within 250 ms. This keeps the strongest proposal in a local neighbourhood, not necessarily the physical reversal instant. Rapid articulations may merge; longer disturbances can produce multiple candidates.

“Multiple cues” means both energy and spectral-flux rules passed; “limited cues” covers other admissible combinations. Neither is a calibrated probability. The algorithm cannot prove bow reversal, direction, speed, pressure, location or technique. Similar evidence can come from taps, articulation, microphone handling, background noise or gain changes. A continuous legato reversal may generate no usable event.

## Sustained selection, comparison and observations

The passage picker lists contiguous accepted, same-nearest-note regions lasting at least 0.65 s with no more than 0.5 semitone drift from the first frame. This is a convenience, not a stroke segmentation. Pitch gaps split passages. Users can select any interval directly.

A selection qualifies for a stable same-note comparison only if it lasts ≥0.5 s, has ≥90% active-frame coverage, ≥80% usable-pitch coverage, ≥90% of accepted notes on the same nearest semitone, and pitch SD ≤0.35 semitone. Both selections must share that detected note. Differences in dBFS and centroid Hz are reported without a good/bad interpretation. A kept comparison and all analysis results last only for the current analysis session.

Deterministic observations describe level variation in qualifying passages, or a final-third versus first-third mean-level difference of at least 3 dB (at least five active frames per third). Timestamped transition observations repeat measured evidence and label the physical cause unknown. Mixed or weak selections are identified rather than interpreted as sustained notes. Practice investigations ask the musician to listen and compare under consistent recording conditions.

Manual confirmations, rejections and timestamp/type adjustments are a separate `EventReview` collection. They never overwrite algorithm timestamps, labels or evidence. Exported JSON contains versioned algorithm events, manual reviews and recording metadata, **no audio**. Reviews are not persisted to IndexedDB and disappear on reanalysis, recording change or navigation; the UI explicitly says to export first. These musician annotations are not automatically treated as independent ground truth.

## Synthetic validation

`tests/tone.test.ts` uses deterministic PCM and seeded noise. Tests cover constant amplitude, rich harmonics, gradual gain ramps, abrupt steps, brightness changes, noise bursts, single-sample artefacts, pitch changes without envelope dips, quiet/DC/silent signals, gradually varying background noise, and bow-like dips with a spectral disturbance. Integrated constant-harmonic and note-change cases run the actual unchanged pitch estimator; other controlled classification tests inject known pitch context to isolate the tone module.

Eight stationary sine cases (C2, G2, D3, A3, each at amplitudes 0.02 and 0.2) have maximum interval level error **0.020731 dB** and maximum centroid error **0.335884 Hz**. This validates these ideal signals and definitions, not real-cello tone accuracy. No boundaries were proposed for stationary sines, the rich steady tone, gradual crescendos/decrescendos, the gradual background-noise ramp, or artificial pitch-data gaps over an unchanged waveform.

Known synthetic event times use one-to-one nearest matching with a ±150 ms tolerance; every unmatched proposal is a false positive and every unmatched label a miss:

| Controlled case                                   | Labelled events | Matched | False positives | Missed | Precision / recall | Max absolute timing error |
| ------------------------------------------------- | --------------: | ------: | --------------: | -----: | ------------------ | ------------------------: |
| Abrupt level step                                 |               1 |       1 |               0 |      0 | 1.00 / 1.00        |                  26.30 ms |
| Spectral brightness step                          |               1 |       1 |               0 |      0 | 1.00 / 1.00        |                  20.14 ms |
| Noise burst onset and offset                      |               2 |       2 |               0 |      0 | 1.00 / 1.00        |                  45.99 ms |
| Synthetic note change, no envelope dip            |               1 |       1 |               0 |      0 | 1.00 / 1.00        |                  20.14 ms |
| Four bow-like envelope dips + 1.9 kHz disturbance |               4 |       4 |               0 |      0 | 1.00 / 1.00        |                   5.44 ms |

These are **nine deliberately constructed events**, not a general precision/recall estimate or independent test corpus. The bow-like examples explicitly contain the cues the rule seeks; real bows may not. An unchanged waveform representing acoustically invisible reversals correctly produces zero candidates; no method can infer a boundary solely from a declared stroke count. The synthetic timing errors do not justify millisecond real-bow accuracy. The tests also verify rail-sample counting, immutable manual annotations, invalid input guards, and same-note comparison gating.

Lifecycle tests exercise copied-channel transfer, result/progress delivery, worker disposal, cancellation, message/worker errors, unavailable browsers, startup failure and transfer/allocation failure. Existing decoder tests cover malformed/unsupported files, limits and late cancellation. These adapter tests do not certify device-specific browser codecs or microphone behaviour.

## Real development recording: V2

Private source: **Cello Open Strings Sample V2.m4a**, stereo AAC at 48 kHz, 614,580 bytes. SHA-256:

`480019bc9d5d409167bc5723ff95e32552e835ce601a079b344f0984efd121a6`

Container duration is 36.757333 s; FFmpeg decodes **36.713333 s** after AAC padding handling. Browser decoding can differ slightly at the endpoints. Validation resamples both channels to 22,050 Hz, then uses the production mono policy and the actual pitch/tone modules. The source file stays outside Git; no original audio is published.

User-provided context: **C2 → G2 → D3 → A3 → A3 → D3 → G2 → C2**, four strokes per passage, 32 performed strokes overall. There are no independently labelled boundary timestamps. A stroke count is not an acoustic event count; starts, ends, note changes and multiple transients can differ. We do not infer ground-truth times or claim real precision, recall, false-positive count or missed-event count.

Measured results:

- **3,155 frames**; 94.33% above the level floor; 82.31% with aligned usable pitch.
- Active-frame energy-averaged level **−32.15 dBFS**; level SD **4.10 dB** across the recording's mixed notes/dynamics.
- Mean centroid **1,049.95 Hz**, centroid SD **470.58 Hz**; mean power flatness **0.000313**; mean accepted-pitch harmonic support **0.8906**. These whole-recording averages are not tone grades.
- Maximum decoded **channel** magnitude **0.13895**, zero samples ≥0.999; no near-rail clipping evidence in this decoded representation. This cannot exclude prior clipping/limiting.
- **36 algorithm proposals: 1 candidate bow reversal, 4 note-change candidates, 13 other transients, 18 uncertain events.** Adaptive flux threshold was 0.08.
- The candidate bow reversal at **3.506 s** has a 3.07 dB envelope dip, flux 0.082 and approximately 1 cent before/after pitch difference. This is a plausible acoustic event, **not a verified reversal**.
- Note-change candidates occur at **6.606, 15.244, 23.487 and 27.643 s**, with before/after pitch changes approximately +690, +699, −703 and −696 cents. They are consistent with some string transitions in the known sequence, but their exact timing/classification has no independent annotation.
- Many other proposals are level steps with similar pitch. For example, **8.847 s** has a −7.30 dB flank difference and flux 0.098 but no qualifying local dip at the selected timestamp. It remains **uncertain**. The detector is intentionally too conservative to label every such pattern as a bow reversal.

Algorithm timestamps by category (seconds, not human labels):

- Candidate bow reversal: **3.506**.
- Note change: **6.606, 15.244, 23.487, 27.643**.
- Other transient: **3.123, 5.387, 5.642, 7.709, 9.950, 12.074, 14.141, 18.541, 26.773, 27.028, 28.642, 30.848, 34.203**.
- Uncertain: **4.447, 4.748, 8.847, 13.073, 16.173, 17.345, 18.262, 19.470, 20.410, 20.863, 21.478, 22.500, 22.860, 24.590, 25.577, 29.791, 33.205, 35.422**.

This implementation therefore finds reviewable changes but **does not recover a reliable 32-stroke segmentation**. The correct next validation step is independent listening/video or teacher-labelled timestamps, including ambiguous regions and acoustically smooth reversals, on multiple recordings and recording setups. Event counts alone cannot establish missed boundaries or false positives. Thresholds are transparent heuristics; no claim of population validation is made.

The optional V2 regression checks its hash, complete feature calculation, event snapshot and rail evidence. Its event assertions preserve current algorithm behaviour; they are **not accuracy labels**. The prior V1 labelled-pitch regression still runs separately and protects harmonic corrections.

```bash
STRINGMENTOR_CELLO_SAMPLE_PATH='/path/to/Cello Open Strings sample.m4a' \
STRINGMENTOR_CELLO_V2_PATH='/path/to/Cello Open Strings Sample V2.m4a' \
npm test
```

FFmpeg is required for the two private-file tests. Without these variables they are explicitly skipped; deterministic synthetic, lifecycle and existing derived pitch-fixture tests still run in CI.

## Confounds and remaining limitations

- **Microphone distance/orientation** changes recorded level and spectral balance, including proximity effects. This analysis has no microphone calibration.
- **Room acoustics** and reflections alter spectra, envelope decays and interference; reverberation can smear boundaries.
- **Automatic gain control, compression and limiting** can flatten or create dynamic contrasts. Browser microphone processing and phone encoding are not controlled by this analysis.
- **Instrument register and harmonic balance** change centroid, flatness and support even with similar playing. Compare the same note and recording setup, and listen.
- **Background sound** can produce transients or inflate flatness. Noise-like spectra can also be part of the instrument's natural sound. No source separation or true HNR/SNR is claimed.
- **AAC/resampling** can shift endpoints, alter peaks and smear transients. Decoded near-rail evidence is not source clipping certification.
- **Pitch errors and gaps** affect contextual labels and passage selection. The working estimator is preserved; it is not a reference transcription.
- **Resolution/segmentation**: 93 ms spectra blur short events, 186 ms pitch windows blur context, and 250 ms suppression merges nearby events. Slow changes may not trigger, smooth reversals may be invisible, and one physical event can produce multiple proposals.
- **Scope**: development tests cover solo cello and controlled signals, not ensemble audio, all bowing styles or all devices. No vibrato analysis, reference-performer comparison, teacher dashboard, physical bow measurement or LLM mentoring is included.

## Preview and deployment acceptance

Run `npm ci`, `npm run dev`, then open `http://localhost:3000`. For a production preview use `npm run build && npm start`. The repository uses Next's supported Webpack production builder to bundle both workers.

After Vercel reports the new main-branch commit ready, open **https://stringmentor-ai.vercel.app/practice**:

1. Confirm existing recordings, playlists, notes, volume and instrument preferences remain. Load V2 locally or record a fresh cello take.
2. Choose **Analyse Tone**. Check progress/cancellation, actual graphs and the candidate breakdown. Nothing should request microphone permission merely to analyse a file.
3. Move the graph window, click a graph, use the keyboard timestamp inspector, and seek/play/pause/replay. Compare with the existing intonation graphs and raw/corrected diagnostics.
4. Select a detected sustained passage, keep it as a comparison, then select another of the same note. Check numerical units and the mixed/uncertain warning for unsuitable selections.
5. Confirm, reject and adjust candidate events, listen at adjusted times, and export JSON. Verify algorithm events are unchanged and manual reviews are separate. Export before leaving; reviews are session-only.
6. Cancel, switch recordings and navigate away mid-analysis. Try silence, a tiny/damaged file and violin-labelled recordings. Expect honest gaps, insufficient-data messages or useful errors.
7. Refresh and test a microphone take, playlist addition, instrument settings and existing uploads. Repeat at narrow mobile width in current Chrome and Safari over HTTPS.

Verification on 17 October 2026: `npm run typecheck`, `npm run lint`, `npm test` with both private-file variables (**54 passed, zero failed, zero skipped**), and `npm run build` all passed. Production HTTP smoke checks passed for all five pages and full navigation, the unknown-route 404, the existing Practice controls and the new Analyse Tone control. Both pitch and tone worker bundles were delivered with HTTP 200 and JavaScript MIME types. Protected pitch, intonation, player, microphone, provider and storage files were unchanged. Browser interaction, real microphone/device behaviour, mobile rendering and Vercel deployment completion must still be verified on the live site; HTTP and adapter checks alone do not establish them.
