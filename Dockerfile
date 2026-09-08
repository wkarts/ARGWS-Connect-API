ARG NODE_IMAGE=ghcr.io/wkarts/argws-connect-node:22-bookworm-slim
ARG APP_VERSION=1.0.0
ARG MANAGER_BUILD_MODE=production
FROM ${NODE_IMAGE} AS builder
ARG APP_VERSION
ARG MANAGER_BUILD_MODE

# Zapo VOIP uses @roamhq/wrtc, whose Linux prebuilt is glibc-based.
# Debian Bookworm + Node 22 is the supported production base for the voice-enabled API.
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ffmpeg wget curl bash openssl ca-certificates dos2unix && \
    rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="ARGWS Connect API" \
      org.opencontainers.image.description="Communication & Integration Platform" \
      org.opencontainers.image.source="https://github.com/wkarts/argws-connect-api"

WORKDIR /argws-connect

COPY ./package*.json ./
COPY ./tsconfig.json ./
COPY ./tsup.config.ts ./

# A versão do package.json é materializada pelo pipeline antes do docker build.
# O Dockerfile não tenta versionar novamente: apenas instala exatamente o lockfile.
RUN npm ci --silent

COPY ./src ./src
COPY ./public ./public
COPY ./prisma ./prisma
COPY ./manager ./manager
COPY ./scripts ./scripts
COPY ./.env.example ./.env
COPY ./runWithProvider.js ./
COPY ./Docker ./Docker

# The principal web interface is delivered by the same image under /manager/.
# Install its pinned build dependencies before the deterministic validation/build.
RUN npm --prefix manager install --no-audit --no-fund
RUN MANAGER_BUILD_MODE="${MANAGER_BUILD_MODE}" npm --prefix manager run test

RUN chmod +x ./Docker/scripts/* && dos2unix ./Docker/scripts/*
RUN ./Docker/scripts/generate_database.sh
RUN npm run build

FROM ${NODE_IMAGE} AS final

ARG APP_VERSION=1.0.0
LABEL org.opencontainers.image.version="${APP_VERSION}"

RUN apt-get update && \
    apt-get install -y --no-install-recommends tzdata ffmpeg bash openssl curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ENV TZ=America/Bahia
ENV DOCKER_ENV=true
ENV NODE_ENV=PROD

WORKDIR /argws-connect

COPY --from=builder /argws-connect/package.json ./package.json
COPY --from=builder /argws-connect/package-lock.json ./package-lock.json
COPY --from=builder /argws-connect/node_modules ./node_modules
COPY --from=builder /argws-connect/dist ./dist
COPY --from=builder /argws-connect/prisma ./prisma
COPY --from=builder /argws-connect/manager/dist ./manager/dist
COPY --from=builder /argws-connect/public ./public
COPY --from=builder /argws-connect/scripts ./scripts
COPY --from=builder /argws-connect/Docker ./Docker
COPY --from=builder /argws-connect/runWithProvider.js ./runWithProvider.js
COPY --from=builder /argws-connect/tsup.config.ts ./tsup.config.ts

# Validate the exact Zapo module path required by the published stores/VOIP packages
# in the same final filesystem that will run in production.
RUN npm run runtime:deps:check

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1

ENTRYPOINT ["/bin/bash", "-c", ". ./Docker/scripts/deploy_database.sh && npm run start:prod" ]
