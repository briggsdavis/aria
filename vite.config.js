import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { strToU8, zipSync } from 'fflate'
import { createAudioHandler } from './server/audio.js'

function audioApi(convexUrl) {
  const handler = createAudioHandler({ convexUrl })
  return {
    name: 'atropos-local-audio',
    configureServer(server) { server.middlewares.use(handler) },
    configurePreviewServer(server) { server.middlewares.use(handler) },
  }
}

function helperDownload({ VITE_CONVEX_URL, ATROPOS_WEB_ORIGIN }) {
  return {
    name: 'atropos-helper-download',
    generateBundle() {
      const files = {}
      for (const path of ['Start-Atropos.command', 'server/index.js', 'server/audio.js', 'shared/audio-origin.js', 'shared/youtube.js']) {
        const data = readFileSync(new URL(path, import.meta.url))
        const mode = path.endsWith('.command') ? 0o100755 : 0o100644
        files[`Atropos Audio Helper/${path}`] = [data, { os: 3, attrs: mode << 16 }]
      }
      files['Atropos Audio Helper/package.json'] = strToU8('{"type":"module"}\n')
      files['Atropos Audio Helper/.env.production'] = strToU8(
        `VITE_CONVEX_URL=${JSON.stringify(VITE_CONVEX_URL || '')}\nATROPOS_WEB_ORIGIN=${JSON.stringify(ATROPOS_WEB_ORIGIN || '')}\n`,
      )
      this.emitFile({ type: 'asset', fileName: 'Atropos-Mac.zip', source: zipSync(files) })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'ATROPOS_'])
  const local = { host: '127.0.0.1', port: 5173, strictPort: true }
  return { plugins: [react(), audioApi(env.VITE_CONVEX_URL), helperDownload(env)], server: local, preview: local }
})
