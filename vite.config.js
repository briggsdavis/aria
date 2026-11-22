import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createAudioHandler } from './server/audio.js'

function audioApi(convexUrl) {
  const handler = createAudioHandler({ convexUrl })
  return {
    name: 'atropos-local-audio',
    configureServer(server) { server.middlewares.use(handler) },
    configurePreviewServer(server) { server.middlewares.use(handler) },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const local = { host: '127.0.0.1', port: 5173, strictPort: true }
  return { plugins: [react(), audioApi(env.VITE_CONVEX_URL)], server: local, preview: local }
})
