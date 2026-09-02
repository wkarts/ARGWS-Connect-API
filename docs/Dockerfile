FROM scalarapi/api-reference:latest

LABEL org.opencontainers.image.title="Connect|API DOCs"
LABEL org.opencontainers.image.description="Scalar API Reference for Connect|API REST, Meta Compatible and Events contracts"

COPY docs/openapi/connect-api.openapi.json /docs/connect-api.openapi.json
COPY docs/openapi/meta-compatible.openapi.json /docs/meta-compatible.openapi.json
COPY docs/asyncapi/connect-api-events.asyncapi.json /docs/connect-api-events.asyncapi.json
COPY public/branding/connect-api/core /docs/branding/core
COPY public/branding/connect-api/docs /docs/branding/docs
