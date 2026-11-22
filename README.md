# Aria

Aria is a small audio-splicing app with two views: **Splicer** and **Library**. It embeds the YouTube video for playback, accepts an audio file the user owns or is authorized to edit, creates MP3 clips in the browser, and stores source records, splice records, and audio files in Convex.

## Start locally

1. Install Node.js 20.19+ or 22.12+.
2. Run `npm install`.
3. Run `npx convex dev` and follow the prompts to create or select a Convex deployment.
4. Copy `.env.example` to `.env.local` and set `VITE_CONVEX_URL` to the deployment URL printed by Convex.
5. Run `npm run dev`.

Convex generates `convex/_generated` during `npx convex dev`. Keep that generated directory out of source control if you prefer regenerating it during setup.

## Why audio is uploaded separately

Aria uses the YouTube embed for playback and timestamps. It does not extract or download audio from YouTube. The user uploads an authorized source audio file, and Aria cuts and encodes the selected range as MP3 in the browser. This keeps the app on a supported path while preserving the YouTube link alongside the splice.

## Stored data

- `sources`: YouTube URL and ID, display title, source audio file name and Convex Storage ID.
- `splices`: source relation, title, start/end seconds, generated MP3 Storage ID.
- Deleting a source removes its splices and stored audio files.
