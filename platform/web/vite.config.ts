import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const appVersion = readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim()

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion)
  },
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/health': 'http://localhost:8000'
    }
  },
  build: {
    sourcemap: false,
    target: 'es2022',
    chunkSizeWarningLimit: 1000
  }
})
