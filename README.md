# Atropos

Paste a YouTube link and choose start and end timestamps. Atropos runs `yt-dlp` and FFmpeg on your computer. The browser uploads the finished MP3 to Convex and saves it in the Library. Each saved video can be used for multiple splices. Previously uploaded sources can still be opened and spliced from the Library.

## Use the Vercel site with local audio processing

1. Install Node.js 22.12 or newer. On macOS run `brew install ffmpeg yt-dlp`. Verify `ffmpeg -version`, `ffprobe -version`, and `yt-dlp --version`.
2. Run `npm ci`, then `npm run audio` in this directory. Keep the terminal open while using the app. The helper uses the production Convex URL and trusted Vercel origin in `.env.production`.
3. Check [local audio health](http://127.0.0.1:8787/api/audio/health). It returns `"ok":true` when the required executables work.
4. Open [Atropos on Vercel](https://aria-plum-beta.vercel.app/) in Chrome, sign in, and save a splice. Allow local network access when Chrome prompts.

## Local audio processing

Vercel serves the frontend. The browser sends the link and timestamps directly to the Node helper at `127.0.0.1:8787`. `yt-dlp` fetches the source into a temporary directory on your computer. FFmpeg cuts the requested range, and the browser uploads that MP3 to Convex. Audio extraction uses the existing Atropos sign-in. Atropos uses the current Node executable as yt-dlp's JavaScript runtime. See the [yt-dlp EJS setup guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

For frontend development, run `npm start` and open `http://127.0.0.1:5173`. Vite handles audio processing on the same port in this mode. Use a development Convex deployment in `.env.local` with `SITE_URL=http://127.0.0.1:5173`.

- `GET /api/audio/health` reports executable availability and returns `503` when a dependency is missing.
- `POST /api/audio/extract` requires a bearer token from the signed-in frontend. It takes `{"url":"https://www.youtube.com/watch?v=VIDEO_ID","start":42,"end":57}` and streams the selected range as an MP3. Timestamps are whole seconds. Requests without timestamps return the full audio. Videos must be completed, at most 60 minutes long, and under the 150 MiB download limit. Each API process allows two concurrent jobs and eight starts per minute, with a three-minute job timeout. Jobs use isolated temporary directories and remove their files when finished, interrupted, or failed.

## Configure sign-in

Set these environment variables on the **Convex deployment** before deploying the auth code. Use production values on production and development values on development.

| Variable | Value |
| --- | --- |
| `SITE_URL` | Hosted frontend origin, `https://aria-plum-beta.vercel.app` for production |
| `BETTER_AUTH_SECRET` | A persistent secret generated with `openssl rand -base64 32` |
| `APPROVED_SIGNUP_EMAILS` | Comma-separated addresses, such as `owner@example.com,editor@example.com` |
| `RESEND_API_KEY` | Resend API key used only for signup verification emails |
| `AUTH_EMAIL_FROM` | Sender from a verified Resend domain, such as `Atropos <accounts@example.com>` |

For custom Convex hosts, set `VITE_CONVEX_SITE_URL` to the deployment's HTTP actions origin. The frontend derives it from `VITE_CONVEX_URL` for `*.convex.cloud` deployments.

Users create an account with their approved address and a password, verify the email, then sign in. All approved accounts share the existing Library. Removing an address from the allowlist also removes its access to the library and audio API.

Atropos stores YouTube links and splice MP3s in Convex. Deleting a source also deletes its splices and any previously uploaded source audio.
