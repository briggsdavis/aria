import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createAudioHandler } from './server/audio.js'

function audioApi() {
  const handler = createAudioHandler()
  return {
    name: 'aria-audio-api',
    configureServer(server) { server.middlewares.use(handler) },
    configurePreviewServer(server) { server.middlewares.use(handler) },
  }
}

export default defineConfig({ plugins: [react(), audioApi()] })
