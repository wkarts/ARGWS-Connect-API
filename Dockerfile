ARG NODE_IMAGE=ghcr.io/wkarts/argws-connect-node:24-alpine
ARG APP_VERSION=1.0.0
FROM ${NODE_IMAGE} AS builder
ARG APP_VERSION

RUN apk update && \
    apk add --no-cache git ffmpeg wget curl bash openssl

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
COPY ./.env.example ./.env
COPY ./runWithProvider.js ./
COPY ./Docker ./Docker

RUN chmod +x ./Docker/scripts/* && dos2unix ./Docker/scripts/*
RUN ./Docker/scripts/generate_database.sh
RUN npm run build

FROM ${NODE_IMAGE} AS final

ARG APP_VERSION=1.0.0
LABEL org.opencontainers.image.version="${APP_VERSION}"

RUN apk update && \
    apk add --no-cache tzdata ffmpeg bash openssl curl

ENV TZ=America/Bahia
ENV DOCKER_ENV=true
ENV NODE_ENV=PROD

WORKDIR /argws-connect

COPY --from=builder /argws-connect/package.json ./package.json
COPY --from=builder /argws-connect/package-lock.json ./package-lock.json
COPY --from=builder /argws-connect/node_modules ./node_modules
COPY --from=builder /argws-connect/dist ./dist
COPY --from=builder /argws-connect/prisma ./prisma
COPY --from=builder /argws-connect/manager ./manager
COPY --from=builder /argws-connect/public ./public
COPY --from=builder /argws-connect/Docker ./Docker
COPY --from=builder /argws-connect/runWithProvider.js ./runWithProvider.js
COPY --from=builder /argws-connect/tsup.config.ts ./tsup.config.ts

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1

ENTRYPOINT ["/bin/bash", "-c", ". ./Docker/scripts/deploy_database.sh && npm run start:prod" ]
