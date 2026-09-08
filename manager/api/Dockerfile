ARG NODE_IMAGE=ghcr.io/wkarts/argws-connect-node:22-bookworm-slim
ARG APP_VERSION=1.0.0
FROM ${NODE_IMAGE}
ARG APP_VERSION
LABEL org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.title="Connect|API Manager API"
WORKDIR /app
COPY package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
RUN mkdir -p /data && chown -R node:node /app /data
ENV NODE_ENV=production \
    MANAGER_API_PORT=3100 \
    MANAGER_DATA_FILE=/data/manager-data.json \
    MANAGER_RUNTIME_UID=1000 \
    MANAGER_RUNTIME_GID=1000
EXPOSE 3100
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3100/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/bootstrap.mjs"]
