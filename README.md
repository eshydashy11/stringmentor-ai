# StringMentor AI

A responsive music practice studio built with **Next.js App Router, TypeScript, React, and Tailwind CSS 4**. The first version begins with cello, with violin available in the instrument selector.

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

No API keys, environment variables, accounts, or external services are required.

## What works

- Dashboard with StringMentor AI branding and real library/playlist counts.
- Practice Studio with audio upload (file picker or drag and drop) and live microphone recording.
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

## Not yet implemented

**Intonation analysis, tone analysis, and AI feedback are explicitly labelled “Not yet implemented.”** This version displays no invented analysis, scores, or feedback. There is no commercial streaming catalogue, authentication, cloud sync, or AI API integration.

## Storage and privacy

Audio is processed for playback on the device and never uploaded to a backend. Browser storage is tied to this site origin, device, and browser profile. Clearing site data removes the library. Keep original files separately. If IndexedDB is unavailable or full, new uploads remain playable for the current session and a storage warning appears. Uploaded files retain the instrument selected at upload time; changing your default instrument does not relabel existing recordings.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The automated tests cover upload validation, playback time formatting, and microphone lifecycle/format handling. To verify on real devices, use HTTPS or localhost in Chrome and Safari: allow and deny microphone permission, record and stop, seek/replay, reload the library, add a take to a playlist, switch instruments during a take, navigate away while recording or awaiting permission, and let a take reach five minutes. Also check existing audio uploads and playback, playlist editing, and desktop/mobile layouts.

## Project structure

```text
src/app/                 Dashboard and four feature routes, layout, styles
src/components/          Persistent studio state, navigation, player, placeholders
src/lib/                 Audio validation and IndexedDB persistence
tests/                   Automated checks
```

Deploy as a standard Next.js application on a compatible Node.js host (for example Vercel). `npm run build` produces `.next`; `npm start` serves the production application. No deployment or AI-service credentials are included in the repository.
