import { createServer } from 'node:http'
import { createAudioHandler } from './audio.js'

const port = Number(process.env.PORT || 8787)
const frontendOrigin = process.env.ARIA_FRONTEND_ORIGIN
createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, createAudioHandler({ frontendOrigin }))
  .listen(port, () => console.log(`Aria audio API listening on port ${port}`))
