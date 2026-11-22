# Atropos

Paste a YouTube link and choose start and end timestamps. Atropos runs `yt-dlp` and FFmpeg on your computer. The browser uploads the finished MP3 to Convex and saves it in the Library. Each saved video can be used for multiple splices. Previously uploaded sources can still be opened and spliced from the Library.

## Use the Vercel site with local audio processing

1. Open [Atropos on Vercel](https://aria-plum-beta.vercel.app/) in Chrome. Choose **One-time setup** in the bottom left. If the helper is unavailable, choose **Download for Mac**.
2. Unzip the download and open `Start-Atropos.command` from the extracted folder. The launcher needs Node.js 22.12 or newer. When Homebrew is available, it installs or repairs the local audio tools on demand.
3. Allow local network access when Chrome prompts. Atropos checks the helper and shows a check mark when audio is ready. Leave the helper window open while saving splices.

From a source checkout, `npm run audio` starts the same helper. On other platforms, install `yt-dlp` and FFmpeg (including `ffprobe`) first. Check [local audio health](http://127.0.0.1:8787/api/audio/health) if the helper has trouble finding the tools.

## Local audio processing

Vercel serves the frontend. The browser sends the link and timestamps directly to the Node helper at `127.0.0.1:8787`. `yt-dlp` requests the selected audio range from YouTube and uses FFmpeg to create an MP3 in a temporary directory on your computer. The browser uploads that MP3 to Convex. Audio extraction uses the existing Atropos sign-in. Atropos uses the current Node executable as yt-dlp's JavaScript runtime. See the [yt-dlp EJS setup guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

For frontend development, run `npm start` and open `http://127.0.0.1:5173`. Vite handles audio processing on the same port in this mode. Use a development Convex deployment in `.env.local` with `SITE_URL=http://127.0.0.1:5173`.

- `GET /api/audio/health` reports executable availability and returns `503` when a dependency is missing.
- `POST /api/audio/extract` requires a bearer token from the signed-in frontend. It takes `{"url":"https://www.youtube.com/watch?v=VIDEO_ID","start":42,"end":57}` and streams the selected range as an MP3. Timestamps are whole seconds. Requests without timestamps return the full audio. Videos must be completed, at most 60 minutes long, and under the 150 MiB download limit. Each API process allows two concurrent jobs and eight starts per minute, with a three-minute job timeout. Jobs use isolated temporary directories and remove their files when finished, interrupted, or failed.

## Configure sign-in

Set these environment variables on the **Convex deployment** before deploying the auth code. Use production values on production and development values on development.

| Variable | Value |
| --- | --- |
| `SITE_URL` | Hosted frontend origin, `https://aria-plum-beta.vercel.app` for production |
| `BETTER_AUTH_SECRET` | A persistent secret generated with `openssl rand -base64 32` |
| `ADMIN_EMAILS` | Comma-separated addresses, such as `owner@example.com,editor@example.com` |

For custom Convex hosts, set `VITE_CONVEX_SITE_URL` to the deployment's HTTP actions origin. The frontend derives it from `VITE_CONVEX_URL` for `*.convex.cloud` deployments.

Users on the allowlist can create an account with their email address and a password. All approved accounts share the existing Library. Removing an address from the allowlist removes its access to the library and audio API.

Atropos stores YouTube links and splice MP3s in Convex. Deleting a source also deletes its splices and any previously uploaded source audio.
