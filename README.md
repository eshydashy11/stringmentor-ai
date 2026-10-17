# StringMentor AI

A responsive music practice studio built with **Next.js App Router, TypeScript, React, and Tailwind CSS 4**. The first version begins with cello, with violin available in the instrument selector.
**Live website:** https://stringmentor-ai.vercel.app

## Preview locally

Use **Node.js 22.18 or later** and npm.

```bash
git clone https://github.com/eshydashy11/stringmentor-ai.git
cd stringmentor-ai
git checkout main
npm ci
npm run dev
```

Open **http://localhost:3000**. Stop the server with Ctrl+C.

For a production preview:

```bash
npm run build
npm start
```

The production build uses Next.js’s supported Webpack builder, including its Web Worker bundling. This avoids a Turbopack build-worker port restriction in the managed development environment.

No API keys, environment variables, accounts, or external services are required.

## What works

- Dashboard with StringMentor AI branding and real library/playlist counts.
- Practice Studio with audio upload (file picker or drag and drop), live microphone recording, and local cello pitch analysis.
- Play, pause, seek, replay from the beginning, loop, and volume control.
- A persistent audio element keeps playback running during client-side navigation.
- Recordings library with uploaded audio, load-to-player, and delete controls.
- Create and delete playlists; add, load, and remove recordings within them. Playlists are collections; automatic queue playback is not implemented.
- Settings for cello/violin and volume. Cello is the initial default.
- Practice notes, files, playlists, and preferences saved in the current browser with IndexedDB.
- Responsive navigation, keyboard focus states, accessible control names, a skip link, and reduced-motion support.

Upload your own MP3, WAV, M4A, OGG, AAC, FLAC, WebM, or Opus files (100 MB per file maximum). Playback depends on browser codec support; MP3 and WAV are the safest choices. Uploading loads the first file without autoplay. Use the play button to start. An unsupported or damaged file displays an error.

## Microphone recording

In **Practice Studio**, click **Record Audio** beside **Choose file**, grant microphone access, then play your instrument. The visible status and timer show when the microphone is on. Click **Stop Recording**, or let the five-minute limit stop the take. Press Play in the existing player to listen, seek, or replay it.

Completed takes use the existing `StudioProvider.upload(files)` validation, save, and load flow. They appear in Recordings, persist in IndexedDB, and can be added to playlists. The instrument and date are captured when the take starts, with names such as `Cello Practice — 16 Oct 2026 — 14.30.00.webm`. Changing instruments mid-take does not relabel it.

Recording requires **HTTPS or localhost**, microphone permission, and a supported MediaRecorder implementation. The app detects available formats (WebM/Opus, MP4/AAC, or Ogg/Opus), with a browser-default fallback. The file extension follows the actual recorded MIME type; Safari MP4 audio uses `.m4a`. WebM duration metadata is repaired locally so the player can seek after a reload. Browser and device codec support still varies.

Microphone access is requested only after clicking Record Audio. Tracks are released on stop, error, cancellation, page exit, or component disposal, including when a delayed permission grant arrives after cancellation. Leaving Practice Studio discards an unfinished take. Browser scheduling may delay automatic stopping in a suspended/background tab; keep the studio open while recording. The existing 100 MB validation limit applies to all takes. If storage is unavailable or full, the existing storage warning appears and the take remains playable for the current session.

## Local cello intonation analysis

Load an existing **cello** recording from the library, upload solo cello audio, or finish a microphone take. In **Practice Studio**, click **Analyse Intonation**. Decoding and progress are shown; **Cancel analysis** stops processing. No microphone permission is needed to analyse an existing file.

The two graphs show actual detected note height and cents relative to the **nearest equal-tempered semitone**, using A4 = 440 Hz. Positive cents means sharp and negative means flat **relative to that reference**, not necessarily incorrect musical intonation. There is no verified score or intended-note target. Chords, accompaniment, background noise, and very quiet recordings are unsuitable; low-confidence frames leave gaps. Musical tuning choices, transitions, and vibrato are not judged as mistakes.

Graphs show a movable 20-second window. Drag the graph-window slider to explore a long recording. Click a graph to inspect the measured frequency, note, cents, and clarity and seek the existing player. The timestamp inspector also supports keyboard arrows and a **Seek player to timestamp** button. Clarity is a periodicity measure, not a calibrated probability. Coverage includes quiet and rejected frames in its denominator.

The small observation panel uses deterministic thresholds on actual measurements. Stable same-note regions lasting at least one second with a total spread of at most 12 cents may be described as averaging 8–35 cents above or below the nearest reference. Low-clarity observations require at least 25% of non-quiet frames to be rejected for clarity. Observations are withheld unless there are at least 0.5 seconds of usable frame hops and ten usable frames. No LLM or paid service is involved.

The analysis uses **Pitchy 4 / McLeod Pitch Method** in a dedicated Web Worker and Recharts for visualisation. Web Audio decodes and resamples a copy of the selected Blob to 22,050 Hz. Channels are averaged; if they strongly cancel, the highest-energy channel is used. Pitchy uses 4,096-sample windows (~186 ms), 512-sample hops (~23 ms), minimum RMS 0.003, minimum clarity 0.90, a relative peak threshold of 0.97, and a 55–1,000 Hz cello range. These settings are explicit and configurable in `CELLO_CONFIG` in `src/lib/pitch.ts`. The relatively long window supports low C2, trading temporal precision for periodicity evidence. Frame times refer to window centres. A stricter relative peak threshold helps favour full periods in harmonic-rich signals; isolated single-frame octave spikes are excluded, not replaced with invented pitches. Octave errors remain possible.

Initially analysis accepts recordings up to **ten minutes**, with the existing **100 MB** file limit. Selecting another recording, leaving Practice Studio, or cancelling terminates the worker. Native `decodeAudioData` cannot be interrupted mid-decode; a cancelled decode's eventual result is discarded. Results are temporary and recalculated on demand. No original audio, playlists, preferences, or IndexedDB schema are changed. Violin playback and recording remain available; analysis is disabled for violin-labelled recordings because this configuration is not validated for violin.

### Test the updated website

After the new main-branch commit is deployed to your existing Vercel site (or using the local preview above):

1. Open Practice Studio in a current Chrome or Safari browser. Confirm your existing library, playlists, instrument, volume, and notes remain intact.
2. Load a clear solo cello recording or record a few seconds of each open string, then analyse it. Expect usable notes near C2, G2, D3, or A3 when those pitches are present; do not treat these as guaranteed ground truth.
3. Inspect both graphs, move the time window, use the keyboard timestamp inspector, and seek/play/replay the selected passage. Check at desktop and narrow mobile widths.
4. Try silence, quiet/noisy audio, a very short recording, and a damaged audio file. Expect insufficient data or a useful error, never fabricated results.
5. Cancel during analysis, switch recordings, and navigate away. Reopen the studio and analyse another file; stale results must not appear.
6. Refresh; the original recordings and playlists should remain. Add a microphone take to a playlist and verify upload, recording, playback, and settings still work. Violin recordings should show the unvalidated-analysis explanation.

Real-browser codec, microphone, touch-layout, and real-cello accuracy checks are still required on your devices. Automated decoder/lifecycle tests use controlled adapters; they do not certify Chrome/Safari decoding or acoustic accuracy. A successful Git push alone does not confirm that Vercel finished deploying.

## Not yet implemented

**Tone analysis and AI feedback remain explicitly labelled “Not yet implemented.”** Cello pitch measurements use real audio; there are no invented analysis results, wrong-note scores, or technique diagnoses. There is no commercial streaming catalogue, authentication, cloud sync, or AI API integration.

## Storage and privacy

Audio is processed for playback and pitch analysis on the device and never uploaded to a backend. Browser storage is tied to this site origin, device, and browser profile. Clearing site data removes the library. Keep original files separately. If IndexedDB is unavailable or full, new uploads remain playable for the current session and a storage warning appears. Uploaded files retain the instrument selected at upload time; changing your default instrument does not relabel existing recordings.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The automated tests cover upload validation, playback time formatting, microphone lifecycle/format handling, IndexedDB persistence and playlist references, pitch estimation, decoding failure handling, and analysis cancellation. See [the synthetic accuracy report](docs/intonation-validation.md) for tolerances and measured results. To verify on real devices, use HTTPS or localhost in Chrome and Safari: allow and deny microphone permission, record and stop, seek/replay, reload the library, add a take to a playlist, switch instruments during a take, navigate away while recording or awaiting permission, and let a take reach five minutes. Also check existing audio uploads and playback, playlist editing, and desktop/mobile layouts.

## Project structure

```text
src/app/                 Dashboard and four feature routes, layout, styles
src/components/          Studio state, player, recording, intonation UI, placeholders
src/lib/                 Audio validation, pitch engine, decoding, IndexedDB
src/workers/             Background pitch analysis
tests/                   Automated checks
```

Deploy as a standard Next.js application on a compatible Node.js host (for example Vercel). `npm run build` produces `.next`; `npm start` serves the production application. No deployment or AI-service credentials are included in the repository.
