ARG NODE_IMAGE=ghcr.io/wkarts/argws-connect-node:22-bookworm-slim
ARG NGINX_IMAGE=ghcr.io/wkarts/argws-connect-nginx:1.27-alpine
ARG APP_VERSION=1.0.0
ARG MANAGER_BUILD_MODE=production

FROM ${NODE_IMAGE} AS builder
ARG MANAGER_BUILD_MODE
WORKDIR /app

COPY package.json ./package.json
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run test

FROM ${NGINX_IMAGE}
ARG APP_VERSION
LABEL org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.title="Connect|API Web" \
      org.opencontainers.image.description="Connect|API interface" \
      org.opencontainers.image.source="https://github.com/wkarts/argws-connect-api"

COPY --from=builder /app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1/health || exit 1
