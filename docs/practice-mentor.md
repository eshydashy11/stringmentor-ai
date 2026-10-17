# Phase 2C: intention-aware Practice Mentor

17 October 2026. The mentor is a local deterministic rule engine, not an LLM, performance grader or replacement for instrumental teaching. It connects measured evidence to a user-selected analytical goal. That goal does not establish what the original performer intended.

## Practice Studio hierarchy

Existing upload, microphone, player and notes controls remain intact. The analytical experience has three levels:

1. **Your Practice Mentor**: five musical goals, up to three sufficiently supported findings, a shared interval selector, concrete practice investigations, listening and graph-highlight actions, simple bow-change review, useful/not-useful responses, and local JSON export. There is no requirement to fill all three cards.
2. **Explore Your Performance**: tracked pitch trajectory, cents deviation, dynamic contour, brightness and level-stability graphs; timestamp seeking; sustained-passage selection; same-note comparisons. These remain available without opening Advanced Diagnostics.
3. **Advanced Diagnostics**: expandable raw/corrected pitch graphs, harmonic candidates, rejection reasons, spectral flux/flatness/harmonic support, exact frame readings, clipping evidence, the full articulation-candidate list and all previous confirm/reject/adjust controls, methods, thresholds and JSON export.

Feedback highlights the relevant pitch or tone interval, moves the shared graph window and focuses the graph section. A selected comparison can be listened to separately. Graph controls retain labelled keyboard inputs. Responsive cards and controls wrap at narrow widths, and automatic scrolling respects reduced-motion preferences. Component tests verify hierarchy and control labels; actual touch layout and browser rendering still require device checks.

The microphone and player stay outside the recording-keyed analysis subtree. Changing the selected recording resets analysis and mentor state **without remounting those existing controls**. The persistent audio element remains owned by StudioProvider.

## Shared analysis and lifecycle

- `PracticeAnalysisSession` owns one recording ID, one cancellable job and one validated `AnalysisBundle` containing existing pitch and tone results.
- The existing tone worker already computed pitch for context. It now returns that same pitch result along with tone data. Mentor, Explore and Advanced all consume it; the app no longer runs separate pitch passes for each view.
- Goal, interval, comparison and review changes reuse this bundle. Only an explicit reanalysis runs DSP again. Concurrent requests for one session share the same job.
- Validation checks recording identity, finite and matching durations, ordered in-range timestamps, and usable numeric measurements. A mismatched or late result cannot populate the current recording.
- Cancel, reanalysis, recording changes and unmount preserve the original audio and discard stale work. Native decoding still cannot be interrupted midway; its late results are ignored.
- Feedback generation runs in a **separate persistent Web Worker**, caching the measured bundle once. Subsequent messages contain only goals, intervals, conditions and reviews. Request IDs and React result keys suppress superseded replies. The worker is disposed on unmount/pagehide, and recreated after a persisted pageshow.
- This separation matters for long files: a 16-times-repeated V2 measurement set (~587 s) took roughly 122–795 ms per goal in an exploratory Node benchmark before moving feedback off the UI thread. Those numbers are not browser/device guarantees. No extra pitch or tone estimation is performed when changing goals.

Pitch and tone estimator implementations and thresholds are unchanged. Player, microphone controller, provider, IndexedDB schema, recording files, instrument metadata, playlists and preferences are unchanged. No audio, measurements or reviews are uploaded; no API key or external model is used.

## Typed evidence and feedback

`src/lib/practice-feedback.ts` accepts recording ID, validated measurements, selected goal and interval, optional kept comparison, separate articulation reviews and the user's statement about recording conditions. It returns typed findings with stable IDs, interval(s), observation, relevance, numeric measurements with units, uncertainty, exercise group, exact evidence references, and transparent priority/reason fields.

The engine does not infer intended notes, phrase boundaries, physical technique or a universal ideal tone. It distinguishes numerical differences from audibility and musical relevance. The optional “consistent recording settings” checkbox records a user statement; it is not verification or calibration. Every comparison still explains microphone, room, gain-control and compression confounds.

### Conservative configurable gates

`FEEDBACK_RULES` is exported, documented in Advanced Diagnostics and accepted as an optional typed engine argument. Initial defaults:

| Gate                           | Initial rule                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Sustained interval             | At least 0.7 s for feedback; tone's existing same-note selection rules also apply                                              |
| Tone passage coverage          | At least 90% above the level floor and 80% usable pitch                                                                        |
| Harmonic support               | At least 0.75 in qualifying tone summaries or accepted pitch candidates                                                        |
| Pitch candidate margin         | At least 0.06 for pitch findings                                                                                               |
| Same-note level contrast       | Absolute difference at least 3 dB                                                                                              |
| Within-passage level variation | At least 2 dB SD for a listening investigation                                                                                 |
| Expressive brightness contrast | Larger/smaller centroid ratio at least 1.25; does not imply better or worse tone                                               |
| Transition evidence            | Dip at least 3 dB, flux at least the existing adaptive tone threshold, and before/after pitch difference no more than 35 cents |
| Articulation comparison        | Two qualifying proposals with comparable same-note flanks and dip-depth difference at least 2 dB                               |
| Pitch offset / drift           | Mean nearest-reference offset at least 8 cents, or final-third minus first-third drift at least 12 cents                       |
| Pitch region                   | Contiguous reliable same-nearest-note frames; spread no more than 35 cents; no gap filling                                     |
| Primary output                 | At most three findings; overlapping descriptions of the same passage suppressed                                                |

Base ordering priorities: same-note comparison 85; musician-identified event 90; unconfirmed event 75; pitch drift 80; pitch offset 70; sustained level variation 65; dynamic contour 80. Articulation-pair comparisons add 2 to comparison priority. Reviewed negative events subtract 20; dynamic-goal event findings subtract 15 so whole-passage dynamics take precedence. Equal priorities use timestamp and stable ID order. Priority values are **ordering rules, not quality scores or confidence percentages**. Findings overlapping more than 60% of the shorter primary interval are not repeated.

These thresholds are empirical investigation gates, not validated perceptibility thresholds or standards for good/bad performance. A quiet/uniform passage may simply produce no finding; that is not a grade. Pitch feedback distinguishes insufficient evidence from measurements with no qualifying pattern, as detailed below. Other goals retain their existing insufficient/threshold messaging.

### Pitch evidence outcomes

The typed `pitchAssessment` field (also included in review JSON) separates three outcomes:

- `insufficient-evidence`: no reliable contiguous same-detected-note region meets the existing minimum duration and local coverage requirements. The UI reports actual missing-pitch/candidate, harmonic-support, candidate-margin and short-region failures, including counts. Multiple gates can reject one frame, so gate counts need not sum to rejected frames. Gaps, rejected frames and detected note changes break continuity; a high overall reliable-frame percentage alone is insufficient.
- `no-qualifying-pattern`: sustained measurements exist, but no supported mean offset or first-to-last-third drift meets the investigation thresholds. This produces a neutral measured summary, not an insufficient-evidence warning or practice exercise. Reliable regions wider than the existing spread limit can still supply a factual variation summary, but are excluded from offset/drift interpretation and explicitly **not** described as below threshold.
- `notable-pattern`: supported offset/drift findings retain their timestamps, measurements, uncertainty, playback links and investigations.

Reliability gates and interpretation thresholds are unchanged: harmonic support ≥ 0.75, candidate margin ≥ 0.06, duration ≥ 0.7 s, within-region coverage ≥ 80%, spread ≤ 35 cents for offset/drift interpretation, and absolute mean offset ≥ 8 cents or absolute drift ≥ 12 cents. Overall selected-frame coverage is descriptive, not an additional global rejection gate.

The summary reports reliable selected-frame counts, the number and combined duration of qualifying sustained regions, their fraction of the selected interval, and the minimum/maximum peak-to-peak variation **within** those regions. It never pools different notes into one cents range. Duration uses first/last frame centres without padding or filling gaps; overlapping analysis windows can smooth rapid variation. Region intervals and numerical values are included in the exported assessment. No finding establishes intended notes, correct intonation or musical quality.

### How goals change findings

- **Consistent dynamics** prioritises comparable same-note level contrasts, within-note contours and sufficiently large level variation. Brief articulation dips are distinguished from whole-passage contrasts. Exercises investigate sustained sound and explicitly intended dynamics.
- **Smooth bow transitions** prioritises combined dip, spectral and same-pitch evidence. Unreviewed reversals remain hypotheses; musician identifications change wording and priority, not acoustic truth. Exercises use slow transitions and listening comparisons.
- **Pitch stability / intonation awareness** describes qualified same-note reference offsets or drift. Cents are relative to the nearest equal-tempered semitone at A4 = 440 Hz, not a known intended note. Wider motion, weak harmonics and note transitions are withheld rather than graded. The engine does not classify or grade vibrato/glissando; deliberate motion, tuning and uncertain estimates remain possible explanations.
- **Consistent articulation** compares same-register acoustic dip depths and comparable passage profiles, with confirmations labelled separately. Whole-passage averages do not isolate note attacks, and acoustic proposals are not verified stroke boundaries. Exercises investigate repeated notes at a steady tempo and deliberate articulation.
- **Expressive variation** describes dynamic and brightness contrasts and changing contours without preferring uniformity. Exercises invite deliberate crescendo/diminuendo and contrasting phrase versions.

The exercise library contains two relevant alternatives per finding group. “Another supported investigation” switches between these finite choices; it does not invent a diagnosis. No exercise is generated merely to fill an unsupported result.

## One articulation review model

`articulation-review.ts` owns the mapping between simple and advanced decisions. Raw event IDs, classifications, timestamps, dips, flux and pitch evidence are never overwritten.

| User action                                            | Stored manual state                                                   | Simple bow answer |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ----------------- |
| Yes                                                    | `confirmed`, interpretation `candidate-bow-reversal`, source `simple` | yes               |
| No                                                     | `not-bow`, interpretation uncertain, source `simple`                  | no                |
| Not sure                                               | `unsure`, interpretation uncertain, source `simple`                   | unsure            |
| Advanced confirm/adjust as bow reversal                | confirmed/adjusted bow interpretation, source `advanced`              | yes               |
| Advanced confirm/adjust as another definite event type | confirmed/adjusted chosen interpretation                              | no                |
| Advanced uncertain interpretation                      | original advanced status, uncertain interpretation                    | unsure            |
| Advanced reject a bow-reversal suggestion              | rejected                                                              | no                |
| Advanced reject another event type                     | rejected; no positive bow inference                                   | unsure            |
| Clear review                                           | annotation removed                                                    | unreviewed        |

Simple answers retain a previously adjusted timestamp, and every new answer replaces the one annotation for that event. Advanced editing can revisit it. The full UI displays both the original algorithm event and current manual review.

If an annotation moves more than 80 ms from the algorithm timestamp, mentor text explicitly separates the musician's timestamp from the original measured dip. **Measurements are not recalculated or relocated by dragging/typing a boundary.** Both sources appear in evidence references.

Review state, practice goals, recording-condition statements, finding usefulness and investigation choices are separate from source measurements. They are session-only and reset on reanalysis, recording change, refresh or departure. Export before leaving. Confirmations are not automatically treated as teacher-validated labels; no model learns from them.

## Export and compatibility

`stringmentor-practice-review-v2` JSON retains original algorithm events and manual reviews, adds current goal/interval, structured feedback/rules, usefulness responses and investigation choices, and includes recording metadata without the Blob or audio samples. The export can still save original event reviews if feedback is pending or unavailable; in that case `feedback` is null and `feedbackStatus` explains why. Existing full event-review capabilities are preserved. No import or persistent annotation database is introduced.

## Validation

Verified on 17 October 2026 after the pitch-outcome improvement: `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` passed. The full suite passed **80 tests with no failures or skips**, with both private cello recordings supplied for their regressions. New cases cover all three pitch outcomes, gate failures, fragmented data, threshold boundaries, wider motion, interval scope, export and UI transitions without repeating DSP. The V2 regression now asserts the neutral outcome and sustained measurement coverage. All five goals' V2 finding arrays also matched the previous implementation exactly. A production-server HTTP smoke check passed for Dashboard, Practice Studio, Recordings, Playlists and Settings, the unknown-route 404, and delivery of the tone and feedback worker JavaScript. These checks do not establish browser rendering, mobile touch behaviour, microphone hardware compatibility or live Vercel deployment; use the acceptance steps below for those checks.

Automated tests cover:

- All five goals changing priorities, language and exercises; actual numeric source values; deterministic identical inputs; bounded timestamps and evidence references; unsupported-input suppression; small differences and expression safeguards.
- Reference offsets versus broad pitch motion, note changes and weak harmonic evidence; same-note/overlap comparison gates; measured articulation-pair differences.
- Distinct Yes/No/Not sure states, advanced edits, unchanged original events, shifted-timestamp wording, and JSON separation of annotations and measurements.
- Shared worker response, one DSP job per session, cached result reuse, explicit reanalysis, cancellation, stale responses, wrong recording IDs and malformed measurement scopes.
- Persistent feedback-worker initialisation, small goal requests, superseded replies, errors and disposal.
- React component interactions: core graphs rendered outside Advanced; technical charts and full review inside it; synchronised simple/advanced decisions; alternative investigations; usefulness controls; labelled inputs; unique IDs; recording switches that reset mentor state without remounting player/microphone controls.

`tsx` and `react-test-renderer` are development-only test dependencies. Renderer tests exercise component structure and callbacks, not real DOM sizing, browser codecs, touch interaction or microphone hardware. React emits its renderer deprecation warning; this is not an assertion failure. Existing synthetic DSP, real pitch/tone regressions, microphone, WebM duration, storage, playlist-reference, decoding and lifecycle tests remain in the suite.

### V2 development check

The same private V2 measurements documented in [tone-validation.md](tone-validation.md) were passed to the new engine with no manual confirmations, the whole recording selected, and recording conditions unknown. No original audio or PCM is committed. These checks establish provenance and rule behaviour, not educational efficacy or correctness of interpretation.

| Goal                    | Primary findings on V2                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consistent dynamics     | 3: a same-note C2 recorded-level contrast (~5.0 dB) and two qualifying rising C2 contours (~7.3 and 8.8 dB final-third differences)                |
| Smooth bow transitions  | 1: the existing tentative dip at ~3.506 s, with pitch continuity and spectral evidence; still not a confirmed bow reversal                         |
| Pitch awareness         | 0 notable findings, with a neutral measured summary: 1,178/1,574 reliable frames (74.8%), 24 sustained regions spanning 22.08 s (60.1% of the selected interval), and within-region peak-to-peak variation of 1.1–13.2 cents. None meets the supported offset/drift thresholds. |
| Consistent articulation | 1: the comparable C2 passage profile; too few eligible same-register dip pairs for the stricter articulation-pair finding                          |
| Expressive variation    | 3: the C2 contrast, another qualifying brightness contrast, and a changing level contour, without penalising variation                             |

The original 32-stroke count is never used by the runtime feedback rules. Independently timed stroke labels and independent teachers' judgments are still missing. We do not report mentor accuracy, benefit percentages, tone scores, or real-event precision/recall. The previous limitations of harmonic pitch tracking and conservative articulation detection still apply.

## Live acceptance steps

After Vercel marks the new main-branch commit ready, open **https://stringmentor-ai.vercel.app/practice**:

1. Confirm stored recordings, playlists, preferences and notes remain. Upload or select cello audio, or make a new microphone take. Verify playback, pause, seeking and replay.
2. Click **Analyse for my goal**. Both pitch and tone graphs should populate from one run. Change all five goals; feedback should change without a new decoding or pitch-analysis progress cycle.
3. In Pitch awareness, try a short/noisy interval: expect insufficient evidence with specific gates. Load the supplied V2 sample: expect measured coverage and variation with no qualifying pattern. A reliably sustained offset or drift that meets the thresholds should retain its finding cards. No outcome should claim correct intonation. Compare two non-overlapping passages of the same note in Explore.
4. Use Listen here and Highlight on graph. Verify the correct passage is sought/highlighted and graphs are accessible before Advanced is opened. Try keyboard inputs and narrow phone/tablet layouts.
5. For Smooth bow transitions, answer Yes, No and Not sure. Open Advanced and verify the same review state. Adjust the timestamp/type there and check the mentor wording distinguishes annotations from original evidence.
6. Mark a finding useful/not useful and request another investigation. Export JSON; inspect separate `algorithmEvents`, `manualReviews`, feedback and responses. No audio should appear.
7. Cancel mid-analysis, switch recordings and navigate away. Old findings must disappear. Confirm microphone/player controls still work, and test current Chrome and Safari over HTTPS.

Local preview: `npm ci`, `npm run dev`, then `http://localhost:3000`. Production preview: `npm run build && npm start`. Run typecheck, lint, tests and build before pushing. Both original private audio regressions require their existing environment variables and FFmpeg; they are explicitly skipped when files are absent. Production HTTP and worker delivery checks do not prove live Vercel completion or browser interaction.
