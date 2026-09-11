#!/bin/sh
set -eu
# Public UI feature configuration only. Never interpolate secrets or free-form
# values into JavaScript. API-hosted Manager gets these flags from ViewsRouter.
boolean() {
  value=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [ -n "$value" ] || value=$2
  case "$value" in 1|true|yes|on) printf true ;; *) printf false ;; esac
}
template=${1:-/etc/connect/runtime-config.base.js}
output=${2:-/usr/share/nginx/html/assets/runtime-config.js}
tmp="${output}.tmp"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
cat "$template" > "$tmp"
printf '\nwindow.__CONNECT_WEB__ = Object.freeze({...window.__CONNECT_WEB__, features: Object.freeze({...window.__CONNECT_WEB__.features' >> "$tmp"
printf ',voice:%s' "$(boolean "${MANAGER_FEATURE_VOICE-}" "true")" >> "$tmp"
printf ',voiceExtensions:%s' "$(boolean "${MANAGER_FEATURE_VOICE_EXTENSIONS-}" "false")" >> "$tmp"
printf ',voiceQueues:%s' "$(boolean "${MANAGER_FEATURE_VOICE_QUEUES-}" "false")" >> "$tmp"
printf ',flows:%s' "$(boolean "${MANAGER_FEATURE_FLOWS-}" "false")" >> "$tmp"
printf ',automations:%s' "$(boolean "${MANAGER_FEATURE_AUTOMATIONS-}" "false")" >> "$tmp"
printf ',docs:%s' "$(boolean "${MANAGER_FEATURE_DOCS-}" "true")" >> "$tmp"
printf ',conversations:%s' "$(boolean "${MANAGER_FEATURE_CONVERSATIONS-}" "false")" >> "$tmp"
printf ',contacts:%s' "$(boolean "${MANAGER_FEATURE_CONTACTS-}" "false")" >> "$tmp"
printf ',messages:%s' "$(boolean "${MANAGER_FEATURE_MESSAGES-}" "false")" >> "$tmp"
printf ',instanceTestMessage:%s' "$(boolean "${MANAGER_FEATURE_INSTANCE_TEST_MESSAGE-}" "true")" >> "$tmp"
printf ',testMessageContacts:%s' "$(boolean "${MANAGER_FEATURE_TEST_MESSAGE_CONTACTS-}" "false")" >> "$tmp"
printf ',users:%s' "$(boolean "${MANAGER_FEATURE_USERS-}" "false")" >> "$tmp"
printf ',permissions:%s' "$(boolean "${MANAGER_FEATURE_PERMISSIONS-}" "false")" >> "$tmp"
printf ',audit:%s' "$(boolean "${MANAGER_FEATURE_AUDIT-}" "false")" >> "$tmp"
printf ',security:%s' "$(boolean "${MANAGER_FEATURE_SECURITY-}" "false")" >> "$tmp"
printf ',updates:%s' "$(boolean "${MANAGER_FEATURE_UPDATES-}" "true")" >> "$tmp"
printf ',settings:%s' "$(boolean "${MANAGER_FEATURE_SETTINGS-}" "true")" >> "$tmp"
printf '})});\n' >> "$tmp"
mv "$tmp" "$output"
