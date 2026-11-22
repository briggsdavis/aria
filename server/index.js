import { createServer } from 'node:http'
import { localAudioOrigin } from '../shared/audio-origin.js'
import { createAudioHandler } from './audio.js'

const { hostname, port } = new URL(localAudioOrigin)
const { ATROPOS_WEB_ORIGIN: webOrigin, VITE_CONVEX_URL: convexUrl } = process.env

if (!webOrigin || new URL(webOrigin).origin !== webOrigin || !webOrigin.startsWith('https://')) {
  throw new Error('Set ATROPOS_WEB_ORIGIN to the exact HTTPS origin of your Atropos site.')
}
if (!convexUrl) throw new Error('Set VITE_CONVEX_URL to the Convex deployment used by your Atropos site.')

const handler = createAudioHandler({ convexUrl, webOrigin })
const server = createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, handler)
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : error.message)
  process.exitCode = 1
})
server.listen(Number(port), hostname, () => {
  console.log(`Atropos audio helper is running at ${localAudioOrigin} for ${webOrigin}`)
})
