ARG NODE_IMAGE=ghcr.io/wkarts/argws-connect-node:22-bookworm-slim
ARG NGINX_IMAGE=ghcr.io/wkarts/argws-connect-nginx:1.27-alpine
ARG APP_VERSION=1.0.0
ARG MANAGER_BUILD_MODE=production

FROM ${NODE_IMAGE} AS builder
ARG MANAGER_BUILD_MODE
WORKDIR /app

COPY package.json ./package.json
COPY index.html ./index.html
COPY jsconfig.json ./jsconfig.json
COPY public ./public
COPY src ./src
COPY scripts ./scripts
COPY docker-entrypoint.d ./docker-entrypoint.d

# Development images are bundled with source maps. Release images use the
# production default and are bundled/minified without exposing the source tree.
RUN MANAGER_BUILD_MODE="${MANAGER_BUILD_MODE}" npm run test

FROM ${NGINX_IMAGE}
ARG APP_VERSION
LABEL org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.title="ARGWS Connect Manager" \
      org.opencontainers.image.description="ARGWS Connect API Manager" \
      org.opencontainers.image.source="https://github.com/wkarts/argws-connect-api"

COPY --from=builder /app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/40-manager-runtime-config.sh /docker-entrypoint.d/40-manager-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-manager-runtime-config.sh

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
