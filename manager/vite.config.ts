import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// Local copy is intentional: the standalone image builds with manager/ as its
// Docker context. A regression test keeps it in parity with API feature defaults.
const featureDefaults = JSON.parse(readFileSync(new URL('./public/assets/feature-defaults.json', import.meta.url), 'utf8')) as Record<string, [string, boolean]>
const managerFeatures = (env: Record<string, string | undefined>) => Object.fromEntries(
  Object.entries(featureDefaults).map(([feature, [name, fallback]]) => {
    const value = env[name]?.trim().toLowerCase()
    return [feature, value ? ['1', 'true', 'yes', 'on'].includes(value) : fallback]
  }),
)

export default defineConfig(({ mode }) => ({
  base: '/manager/',
  plugins: [vue(), {
    name: 'connect-runtime-features-development',
    apply: 'serve' as const,
    configureServer(server) {
      const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
      const features = managerFeatures({
        MANAGER_FEATURE_CONVERSATIONS: 'true',
        MANAGER_FEATURE_MESSAGES: 'true',
        MANAGER_FEATURE_CONTACTS: 'true',
        MANAGER_FEATURE_TEST_MESSAGE_CONTACTS: 'true',
        ...env,
      })
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/manager/assets/runtime-config.js') return next()
        res.setHeader('Content-Type', 'application/javascript')
        res.setHeader('Cache-Control', 'no-store')
        res.end(`window.__CONNECT_WEB__ = ${JSON.stringify({ compatibility: 'current', apiBaseUrl: env.MANAGER_API_BASE_URL || '', features }).replace(/</g, '\\u003c')};`)
      })
    },
  }],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: true,
    reportCompressedSize: true,
  },
}))
