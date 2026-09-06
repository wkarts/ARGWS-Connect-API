import fs from 'node:fs';
import path from 'node:path';

const [outputFile = 'manager-runtime-config.js'] = process.argv.slice(2);

const PRIMARY_LOCALE = 'pt-BR';
const KNOWN_EXTRA_LOCALES = ['en-US', 'es-ES', 'fr-FR'];

const parseBoolean = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const unique = (values) => [...new Set(values)];

const enableExtraLocales = parseBoolean(process.env.MANAGER_ENABLE_EXTRA_LOCALES, false);
const configuredExtras = unique(
  String(process.env.MANAGER_EXTRA_LOCALES ?? KNOWN_EXTRA_LOCALES.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => KNOWN_EXTRA_LOCALES.includes(value)),
);

const enabledLocales = enableExtraLocales
  ? unique([PRIMARY_LOCALE, ...configuredExtras])
  : [PRIMARY_LOCALE];

const requestedDefaultLocale = String(process.env.MANAGER_DEFAULT_LOCALE ?? PRIMARY_LOCALE).trim();
const defaultLocale = enabledLocales.includes(requestedDefaultLocale)
  ? requestedDefaultLocale
  : PRIMARY_LOCALE;

const runtimeConfig = {
  locale: {
    primaryLocale: PRIMARY_LOCALE,
    defaultLocale,
    extraLocalesEnabled: enableExtraLocales,
    enabledLocales,
    availableExtraLocales: KNOWN_EXTRA_LOCALES,
  },
};

const content = [
  '/* Generated at container/runtime startup. Do not edit manually. */',
  `window.__ARGWS_CONNECT_MANAGER_CONFIG__ = Object.freeze(${JSON.stringify(runtimeConfig, null, 2)});`,
  '',
].join('\n');

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, content);

console.log(`Manager runtime config written to ${outputFile}`);
console.log(`Default locale: ${defaultLocale}`);
console.log(`Enabled locales: ${enabledLocales.join(', ')}`);
