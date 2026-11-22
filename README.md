# Aria

Paste a YouTube link, choose start and end timestamps, and create a splice. Aria fetches the audio on the server and saves the selected range as an MP3 in Convex. Each saved video can be used for multiple splices. Previously uploaded sources can be opened and spliced from the Library.

## Start locally

1. Install Node.js 22.12 or newer and make sure `ffmpeg` and `ffprobe` are on `PATH`. On macOS, `brew install ffmpeg` installs both.
2. Put `yt-dlp` on `PATH` using an official executable with EJS bundled, or install it using `pipx install 'yt-dlp[default]'` and `pipx ensurepath`. The `default` extras include `yt-dlp-ejs`. Aria uses the current Node executable as yt-dlp's JavaScript runtime. See the [yt-dlp EJS setup guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS).
3. Run `npm ci`, then run `npx convex dev` and select or create a Convex deployment.
4. Copy `.env.example` to `.env.local` and set `VITE_CONVEX_URL` to the Convex deployment URL.
5. Run `npm run dev`. Vite handles the audio API on the same port as the frontend. Open `/api/audio/health` on that origin to verify the executables.

## Deploy the audio API

Run `npm start` on a Node host with those same dependencies on `PATH` and outbound access to YouTube. The API listens on `PORT`, defaulting to `8787`. Use HTTPS for the public endpoint. A Vercel frontend can use this API by building with `VITE_AUDIO_API_URL` set to the API origin and starting the API with `ARIA_FRONTEND_ORIGIN` set to the exact frontend origin, such as `https://aria.example.com`. A same-origin reverse proxy can also route `/api/audio/` to the service. Keep `VITE_CONVEX_URL` configured for the frontend build.

- `GET /api/audio/health` reports executable availability and returns `503` when a dependency is missing.
- `POST /api/audio/extract` takes `{"url":"https://www.youtube.com/watch?v=VIDEO_ID","start":42,"end":57}` and streams the selected range as an MP3. Timestamps are whole seconds. Requests without timestamps return the full audio. Videos must be completed, at most 60 minutes long, and under the 150 MiB download limit. Each API process allows two concurrent jobs and eight starts per minute, with a three-minute job timeout. Jobs use isolated temporary directories and remove their files when finished, interrupted, or failed.

Aria stores YouTube links and splice MP3s in Convex. Deleting a source also deletes its splices and any previously uploaded source audio.
