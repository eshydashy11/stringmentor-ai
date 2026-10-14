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
- Practice Studio with audio upload (file picker or drag and drop).
- Play, pause, seek, replay from the beginning, loop, and volume control.
- A persistent audio element keeps playback running during client-side navigation.
- Recordings library with uploaded audio, load-to-player, and delete controls.
- Create and delete playlists; add, load, and remove recordings within them. Playlists are collections; automatic queue playback is not implemented.
- Settings for cello/violin and volume. Cello is the initial default.
- Practice notes, files, playlists, and preferences saved in the current browser with IndexedDB.
- Responsive navigation, keyboard focus states, accessible control names, a skip link, and reduced-motion support.

Upload your own MP3, WAV, M4A, OGG, AAC, FLAC, WebM, or Opus files (100 MB per file maximum). Playback depends on browser codec support; MP3 and WAV are the safest choices. Uploading loads the first file without autoplay. Use the play button to start. An unsupported or damaged file displays an error.

## Not yet implemented

**Intonation analysis, tone analysis, and AI feedback are explicitly labelled “Not yet implemented.”** This version displays no invented analysis, scores, or feedback. There is no commercial streaming catalogue, microphone recording, authentication, cloud sync, or AI API integration.

## Storage and privacy

Audio is processed for playback on the device and never uploaded to a backend. Browser storage is tied to this site origin, device, and browser profile. Clearing site data removes the library. Keep original files separately. If IndexedDB is unavailable or full, new uploads remain playable for the current session and a storage warning appears. Uploaded files retain the instrument selected at upload time; changing your default instrument does not relabel existing recordings.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The automated tests cover upload validation and playback time formatting. Before release, also check a real audio upload, play/pause, seeking, replay, loop, navigation during playback, playlist editing, persistence after reload, and layout on desktop and mobile.

## Project structure

```text
src/app/                 Dashboard and four feature routes, layout, styles
src/components/          Persistent studio state, navigation, player, placeholders
src/lib/                 Audio validation and IndexedDB persistence
tests/                   Automated checks
```

Deploy as a standard Next.js application on a compatible Node.js host (for example Vercel). `npm run build` produces `.next`; `npm start` serves the production application. No deployment or AI-service credentials are included in the repository.
