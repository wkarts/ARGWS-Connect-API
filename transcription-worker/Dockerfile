ARG NODE_IMAGE=ghcr.io/wkarts/argws-connect-node:22-bookworm-slim

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production     NODE_OPTIONS=--enable-source-maps

WORKDIR /opt/argws-connect-transcription-worker

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

RUN mkdir -p /tmp && chown -R node:node /opt/argws-connect-transcription-worker
USER node

LABEL org.opencontainers.image.title="ARGWS Connect|API Transcription Worker"

ENTRYPOINT ["node", "src/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3   CMD test -f /tmp/transcription-worker.ready
