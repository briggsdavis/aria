import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { parseYouTubeUrl } from '../shared/youtube.js'

const maxJobs = 2
const maxStartsPerMinute = 8
const rateWindow = 60_000
const jobTimeout = 180_000
const maxDuration = 3600
const maxBytes = 150 * 1024 * 1024
const maxBodyBytes = 4096

class AudioError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function run(command, args, { cwd, signal } = {}) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32'
    const child = spawn(command, args, { cwd, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let diagnostics = ''
    const kill = () => {
      if (!child.pid) return
      try {
        if (grouped) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') child.kill('SIGKILL')
      }
    }
    signal?.addEventListener('abort', kill, { once: true })
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-8192) })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-8192) })
    child.once('error', reject)
    child.once('close', (code) => {
      signal?.removeEventListener('abort', kill)
      if (signal?.aborted) reject(signal.reason)
      else resolve({ code, output, diagnostics })
    })
  })
}

async function checkDependencies() {
  const options = { signal: AbortSignal.timeout(5000) }
  const tools = [['yt-dlp', ['--ignore-config', '--version']], ['ffmpeg', ['-version']], ['ffprobe', ['-version']]]
  const checks = await Promise.all(tools.map(async ([command, args]) => {
    try {
      const result = await run(command, args, options)
      return [command, result.code === 0]
    } catch {
      return [command, false]
    }
  }))
  const dependencies = Object.fromEntries([...checks, ['node', Number(process.versions.node.split('.')[0]) >= 22]])
  return { ok: Object.values(dependencies).every(Boolean), dependencies }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    const timer = setTimeout(() => finish(new AudioError(408, 'REQUEST_TIMEOUT', 'The request body took too long to arrive.')), 5000)
    function finish(error, value) {
      clearTimeout(timer)
      req.off('data', onData).off('end', onEnd).off('close', onClose).off('error', onError)
      if (error) {
        req.resume()
        reject(error)
      } else resolve(value)
    }
    function onData(chunk) {
      size += chunk.length
      if (size > maxBodyBytes) finish(new AudioError(413, 'REQUEST_TOO_LARGE', 'The request body is too large.'))
      else chunks.push(chunk)
    }
    function onEnd() {
      try {
        finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        finish(new AudioError(400, 'INVALID_JSON', 'Send a JSON object containing a YouTube URL.'))
      }
    }
    function onClose() {
      finish(new Error('Client disconnected.'))
    }
    function onError(error) {
      finish(error)
    }
    req.on('data', onData).once('end', onEnd).once('close', onClose).once('error', onError)
  })
}

async function extractMp3(video, range, directory, signal) {
  const result = await run('yt-dlp', [
    '--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--no-progress',
    '--no-js-runtimes', '--js-runtimes', `node:${process.execPath}`,
    '--socket-timeout', '15', '--retries', '1', '--extractor-retries', '1', '--fragment-retries', '1',
    '--match-filter', `!is_live & duration <= ${maxDuration}`, '--max-filesize', String(maxBytes),
    '--format', 'bestaudio',
    ...(!range ? ['--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K'] : []),
    '--output', 'source.%(ext)s', '--', video.url,
  ], { cwd: directory, signal })

  if (result.code !== 0) {
    if (/postprocess|ffmpeg|ffprobe|conversion failed/i.test(result.diagnostics)) {
      throw new AudioError(502, 'CONVERSION_FAILED', 'FFmpeg could not convert the source audio to MP3.')
    }
    if (/connection|network|timed? out|name resolution|resolve host|certificate|HTTP Error (?:429|5\d\d)/i.test(result.diagnostics)) {
      throw new AudioError(502, 'YOUTUBE_NETWORK_ERROR', 'The server could not download audio from YouTube. Try again later.')
    }
    throw new AudioError(422, 'EXTRACTION_FAILED', 'YouTube audio could not be extracted. Check that the video is public and available.')
  }

  let path = join(directory, 'source.mp3')
  if (range) {
    const files = await readdir(directory)
    const sourceFile = files.find((file) => /^source\.[a-z\d]+$/i.test(file))
    if (!sourceFile) throw new AudioError(422, 'NO_AUDIO', 'Choose a completed video with audio that is at most 60 minutes long and under 150 MiB.')
    const source = join(directory, sourceFile)
    const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', source], { signal })
    const duration = Number.parseFloat(probe.output)
    if (probe.code !== 0 || !Number.isFinite(duration) || duration <= 0) {
      throw new AudioError(422, 'INVALID_AUDIO', 'The source audio length could not be determined.')
    }
    if (range.start >= duration || range.end > duration + 0.05) {
      throw new AudioError(422, 'RANGE_OUTSIDE_AUDIO', `Choose a timestamp range within the source audio (${Math.round(duration * 10) / 10} seconds).`)
    }
    path = join(directory, 'clip.mp3')
    const conversion = await run('ffmpeg', [
      '-nostdin', '-v', 'error', '-ss', String(range.start), '-i', source,
      '-t', String(range.end - range.start), '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '192k', path,
    ], { signal })
    if (conversion.code !== 0) throw new AudioError(502, 'CONVERSION_FAILED', 'FFmpeg could not convert the selected audio to MP3.')
  }
  const file = await stat(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (!file?.size) {
    throw new AudioError(422, 'NO_AUDIO', 'No MP3 was produced. Choose a completed video with audio that is at most 60 minutes long and under 150 MiB.')
  }
  return { path, size: file.size }
}

export function createAudioHandler({ frontendOrigin } = {}) {
  let activeJobs = 0
  let starts = []
  let dependencyCheck
  let checkAgainAt = 0

  function dependencies() {
    if (!dependencyCheck || Date.now() >= checkAgainAt) {
      checkAgainAt = Infinity
      dependencyCheck = checkDependencies().then((result) => {
        checkAgainAt = Date.now() + (result.ok ? 60_000 : 5000)
        return result
      })
    }
    return dependencyCheck
  }

  return async function audioHandler(req, res, next) {
    const route = req.url?.split('?')[0]
    if (route !== '/api/audio/extract' && route !== '/api/audio/health') {
      if (next) return next()
      return json(res, 404, { error: 'Endpoint not found.' })
    }

    if (frontendOrigin) res.setHeader('Vary', 'Origin')
    if (frontendOrigin && req.headers.origin) {
      if (req.headers.origin !== frontendOrigin) return json(res, 403, { error: 'Origin is not allowed.' })
      res.setHeader('Access-Control-Allow-Origin', frontendOrigin)
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Retry-After')
    }
    if (req.method === 'OPTIONS' && frontendOrigin) {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' })
      return res.end()
    }

    let directory
    let acquired = false
    let cancel
    try {
      if (route === '/api/audio/health' && req.method === 'GET') {
        const status = await dependencies()
        return json(res, status.ok ? 200 : 503, status)
      }
      if (route !== '/api/audio/extract' || req.method !== 'POST') {
        res.setHeader('Allow', route === '/api/audio/health' ? 'GET' : 'POST')
        throw new AudioError(405, 'METHOD_NOT_ALLOWED', 'This endpoint does not accept that method.')
      }
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new AudioError(415, 'INVALID_CONTENT_TYPE', 'Send the YouTube URL as JSON.')
      }
      const body = await readJson(req)
      const video = parseYouTubeUrl(body?.url)
      if (!video) throw new AudioError(400, 'INVALID_URL', 'Enter a valid YouTube watch, Shorts, or youtu.be URL.')
      const { start, end } = body
      const range = start === undefined && end === undefined ? null : { start, end }
      if (range && (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > maxDuration)) {
        throw new AudioError(400, 'INVALID_RANGE', 'Send whole-second timestamps with 0 ≤ start < end ≤ 3600.')
      }

      const health = await dependencies()
      if (res.destroyed) return
      if (!health.ok) {
        const missing = Object.keys(health.dependencies).filter((name) => !health.dependencies[name])
        throw new AudioError(503, 'MISSING_DEPENDENCIES', `Audio extraction is unavailable. Check these server dependencies: ${missing.join(', ')}.`)
      }

      const now = Date.now()
      starts = starts.filter((time) => now - time < rateWindow)
      if (starts.length >= maxStartsPerMinute || activeJobs >= maxJobs) {
        const retry = starts.length >= maxStartsPerMinute ? Math.ceil((starts[0] + rateWindow - now) / 1000) : 10
        res.setHeader('Retry-After', retry)
        throw new AudioError(429, 'AUDIO_BUSY', `The audio service is busy. Try again in ${retry} seconds.`)
      }
      starts.push(now)
      activeJobs++
      acquired = true

      const disconnected = new AbortController()
      cancel = () => disconnected.abort()
      res.once('close', cancel)
      const timeout = AbortSignal.timeout(jobTimeout)
      const signal = AbortSignal.any([timeout, disconnected.signal])
      directory = await mkdtemp(join(tmpdir(), 'aria-audio-'))
      let mp3
      try {
        mp3 = await extractMp3(video, range, directory, signal)
        signal.throwIfAborted()
      } catch (error) {
        if (timeout.aborted) throw new AudioError(504, 'EXTRACTION_TIMEOUT', 'Audio extraction took too long. Try a shorter video.')
        throw error
      }
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': range
          ? `inline; filename="youtube-${video.id}-${start}-${end}.mp3"`
          : `attachment; filename="youtube-${video.id}.mp3"`,
        'Content-Length': mp3.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      await pipeline(createReadStream(mp3.path), res, { signal })
    } catch (error) {
      if (res.destroyed) return
      if (res.headersSent) return res.destroy()
      if (error instanceof AudioError) return json(res, error.status, { error: error.message, code: error.code })
      if (error.code === 'ENOENT') return json(res, 503, { error: 'An audio extraction dependency is unavailable.', code: 'MISSING_DEPENDENCIES' })
      console.error('Aria audio request failed', error.code || error.name)
      return json(res, 500, { error: 'The server could not prepare the MP3.', code: 'AUDIO_ERROR' })
    } finally {
      if (cancel) res.off('close', cancel)
      if (directory) {
        await rm(directory, { recursive: true, force: true, maxRetries: 2 }).catch((error) => {
          console.error('Aria could not remove a temporary audio directory', error.code)
        })
      }
      if (acquired) activeJobs--
    }
  }
}
