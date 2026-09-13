import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { installDiagnosticsErrors } from './services/diagnostics'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/integrations.css'
import './styles/responsive.css'

if (location.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(location.hostname)) {
  location.replace(`https://${location.host}${location.pathname}${location.search}${location.hash}`)
} else {
  const app = createApp(App).use(createPinia()).use(router)
  installDiagnosticsErrors(app, router)
  app.mount('#app')
}
