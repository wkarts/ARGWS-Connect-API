const allowedLocales = ['pt-BR', 'en-US', 'es-ES', 'fr-FR'];
const raw = window.__CONNECT_MANAGER_CONFIG__ || {};
const extraLocalesEnabled = raw.locale?.extraLocalesEnabled === true;
const requestedLocales = Array.isArray(raw.locale?.enabledLocales) ? raw.locale.enabledLocales : [];
const enabledLocales = extraLocalesEnabled
  ? [...new Set(['pt-BR', ...requestedLocales.filter((locale) => allowedLocales.includes(locale))])]
  : ['pt-BR'];
const requestedDefault = raw.locale?.defaultLocale;
const defaultLocale = extraLocalesEnabled && enabledLocales.includes(requestedDefault) ? requestedDefault : 'pt-BR';

export const runtimeConfig = Object.freeze({
  apiUrl: String(raw.apiUrl || '').trim().replace(/\/$/, ''),
  documentationUrl: String(raw.documentationUrl || '').trim(),
  locale: Object.freeze({ primaryLocale: 'pt-BR', defaultLocale, extraLocalesEnabled, enabledLocales }),
});
