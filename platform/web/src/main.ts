import { applyBranding, bootBranding } from './config/runtimeBranding'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { installFrontendTelemetry } from './frontend-telemetry'
import './styles/main.css'

applyBranding(bootBranding())

const host = window.location.hostname.toLowerCase()

installFrontendTelemetry()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined))
}
