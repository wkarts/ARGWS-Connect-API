#!/bin/sh
set -eu
ROOT=${MANAGER_RUNTIME_ROOT:-/usr/share/nginx/html}
OUT="$ROOT/assets/runtime-config.js"
mkdir -p "$(dirname "$OUT")"
escape_js(){ printf '%s' "$1" | sed 's/\\/\\\\/g; s/'"'"'/\\'"'"'/g; s/\r//g; :a;N;$!ba;s/\n/\\n/g'; }
API_URL=$(escape_js "${MANAGER_API_URL:-}")
DOCS_URL=$(escape_js "${ARGWS_CONNECT_DOCS_PUBLIC_URL:-${MANAGER_DOCUMENTATION_URL:-}}")
DEFAULT_LOCALE=${MANAGER_DEFAULT_LOCALE:-pt-BR}
ENABLE_EXTRA=${MANAGER_ENABLE_EXTRA_LOCALES:-false}
EXTRA=${MANAGER_EXTRA_LOCALES:-en-US,es-ES,fr-FR}
case "$ENABLE_EXTRA" in 1|true|TRUE|yes|YES) ENABLE_EXTRA=true;; *) ENABLE_EXTRA=false;; esac
if [ "$ENABLE_EXTRA" = false ]; then DEFAULT_LOCALE=pt-BR; ENABLED="'pt-BR'"; else ENABLED="'pt-BR'"; OLDIFS=$IFS; IFS=','; for lang in $EXTRA; do case "$lang" in en-US|es-ES|fr-FR) ENABLED="$ENABLED,'$lang'";; esac; done; IFS=$OLDIFS; case "$DEFAULT_LOCALE" in pt-BR|en-US|es-ES|fr-FR) :;; *) DEFAULT_LOCALE=pt-BR;; esac; fi
cat > "$OUT" <<JS
window.__CONNECT_MANAGER_CONFIG__ = Object.freeze({
  apiUrl: '$API_URL',
  documentationUrl: '$DOCS_URL',
  locale: { primaryLocale: 'pt-BR', defaultLocale: '$DEFAULT_LOCALE', extraLocalesEnabled: $ENABLE_EXTRA, enabledLocales: [$ENABLED] }
});
JS
