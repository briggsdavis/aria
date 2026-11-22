#!/bin/bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

if ! command -v node >/dev/null || ! node -e '
  const [major, minor] = process.versions.node.split(".").map(Number)
  process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)
'; then
  echo 'Install Node.js 22.12 or newer, then start Atropos again.' >&2
  exit 1
fi

works() {
  "$@" >/dev/null 2>&1
}

if ! works yt-dlp --version || ! works ffmpeg -version || ! works ffprobe -version; then
  if [[ "$(uname -s)" != Darwin ]] || ! command -v brew >/dev/null; then
    echo 'Install yt-dlp and FFmpeg (including ffprobe), then start Atropos again.' >&2
    exit 1
  fi

  if ! works ffmpeg -version || ! works ffprobe -version; then
    if brew list --versions ffmpeg >/dev/null; then
      echo 'Repairing FFmpeg…'
      brew reinstall ffmpeg
    else
      echo 'Installing FFmpeg…'
      brew install ffmpeg
    fi
  fi

  if ! works yt-dlp --version; then
    if brew list --versions yt-dlp >/dev/null; then
      echo 'Repairing yt-dlp…'
      brew reinstall yt-dlp
    else
      echo 'Installing yt-dlp…'
      brew install yt-dlp
    fi
  fi

  if ! works yt-dlp --version || ! works ffmpeg -version || ! works ffprobe -version; then
    echo 'Audio setup failed. The tools still do not start after Homebrew setup.' >&2
    exit 1
  fi
fi

exec node --env-file=.env.production server/index.js
