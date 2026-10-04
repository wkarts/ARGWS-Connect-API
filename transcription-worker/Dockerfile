ARG NODE_IMAGE=ghcr.io/wkarts/argws-connect-node:22-bookworm-slim
FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    TRANSFORMERS_CACHE=/tmp/argws-connect-transcription-model-cache \
    HF_HOME=/tmp/argws-connect-transcription-model-cache

WORKDIR /opt/argws-connect-transcription-worker

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /tmp/argws-connect-transcription-model-cache \
  && chown -R node:node /opt/argws-connect-transcription-worker /tmp/argws-connect-transcription-model-cache

USER node

LABEL org.opencontainers.image.title="ARGWS Connect|API Local Transcription Worker" \
      org.opencontainers.image.description="Private local Whisper transcription worker for ARGWS Connect|API" \
      org.opencontainers.image.source="https://github.com/wkarts/ARGWS-Connect-API"

ENTRYPOINT ["node", "src/index.js"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 CMD test -f /tmp/transcription-worker.ready
