# Phase 2E.2 — Independent CREPE visual comparison

Advanced Diagnostics → Hybrid Tiny → Analyse Intonation (or Analyse again) now displays three aligned pitch trajectories:

- Ivory dashed: unchanged Standard measurements.
- Amber dotted: raw CREPE Tiny candidates, eligible only when common-frame RMS ≥ 0.003, frequency is finite and within 55–1000 Hz, and neural activation is finite and between 0.50 and 1. These are **unverified candidate measurements**, not established correct notes.
- Teal solid: the existing guarded Hybrid accepted estimates.

Each trajectory has a checkbox to resolve visual overlap. Amber circles identify raw-eligible frames at which Hybrid has no accepted fundamental. A different accepted Hybrid frequency is a disagreement, not a missing Hybrid frame. Coverage uses the same full-recording frame denominator for all three paths. The cents graph remains the guarded Hybrid view.

Hover for frequencies and activation; click the pitch graph to inspect and seek, or use the keyboard-accessible timestamp slider and “Seek player to timestamp” button. The frame inspector reports basic CREPE eligibility failures, CREPE-minus-Standard cents (disagreement >35 cents when both estimates exist), the raw/Standard frequency ratio, existing acoustic harmonic alternatives, Hybrid source and Hybrid rejection requirements. Ratios/alternatives do not establish a correct fundamental or a causal explanation. Missing values remain gaps; no interpolation is introduced.

`src/lib/crepe-comparison.ts` is a pure display projection of the existing Standard frames and saved neural predictions. It applies no Hybrid harmonic or temporal gates. Changing the visible curves does not decode or infer again. No analysis engine, model, model activation threshold, arbitration policy, Practice Mentor input or saved audio is changed. The display's 0.50 basic gate matches the earlier standalone CREPE benchmark, not Hybrid's stricter recovery threshold. Existing Hybrid exports already contain the raw predictions and rejection evidence.

## Validation

Typecheck, lint, the automated suite (106 tests including private V1/V2 regressions), and production build pass. New unit tests verify independent display of rejected candidates, third-harmonic disagreements, basic eligibility boundaries, invalid/quiet/range gaps, alignment, empty coverage and input immutability.

The production Chromium workflow uses the original cello M4A and actual Tiny inference. It verifies three plotted series, raw coverage calculated independently from the worker response, visibility toggles without a new decode, a CREPE-eligible/Hybrid-withheld frame with rejection reasons, playback seeking, export, cancellation/cache/error handling and persistence. The separate existing browser test covers microphone recording, playlists and settings. These checks validate the diagnostic interface, not the musical correctness of the raw trajectory. No new correct-note accuracy claim is made.

Reproduce with `npm ci`, `npm run build`, `npm run start`, then in another terminal set `STRINGMENTOR_CELLO_SAMPLE_PATH` to the original M4A and run `npm run test:hybrid:browser`. See [the hybrid report](hybrid-crepe.md) for model provenance and computational limits. Standard remains the default; Hybrid/Tiny comparison retains the two-minute clip limit. Physical phones and Safari have not been validated here. This environment blocks direct live-domain access; deployment status is checked through GitHub/Vercel separately.
