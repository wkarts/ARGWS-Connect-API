FROM scalarapi/api-reference:latest

LABEL org.opencontainers.image.title="Connect|API DOCs"
LABEL org.opencontainers.image.description="Scalar API Reference for Connect|API REST, Meta Compatible and Events contracts"

COPY docs/openapi/connect-api.openapi.json /docs/connect-api.openapi.json
COPY docs/openapi/meta-compatible.openapi.json /docs/meta-compatible.openapi.json
COPY docs/asyncapi/connect-api-events.asyncapi.json /docs/connect-api-events.asyncapi.json
COPY public/branding/connect-api/core /docs/branding/core
COPY public/branding/connect-api/docs /docs/branding/docs

# Connect|API DOCs application shell / PWA
COPY docs/pwa/index.html /usr/share/caddy/index.html
COPY docs/pwa/manifest.webmanifest /usr/share/caddy/manifest.webmanifest
COPY docs/pwa/sw.js /usr/share/caddy/sw.js
COPY docs/pwa/icons /usr/share/caddy/icons
COPY docs/pwa/icons/apple-touch-icon.png /usr/share/caddy/apple-touch-icon.png

# Canonical branding exposed directly by the docs application shell.
COPY public/branding/connect-api/core/favicon.ico /usr/share/caddy/favicon.ico
COPY public/branding/connect-api/core/favicon.svg /usr/share/caddy/favicon.svg
COPY public/branding/connect-api/docs/connect-api-docs-light.png /usr/share/caddy/branding/connect-api-docs-light.png
COPY public/branding/connect-api/docs/connect-api-docs-dark.png /usr/share/caddy/branding/connect-api-docs-dark.png
