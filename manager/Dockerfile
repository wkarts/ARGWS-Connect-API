FROM node:20-alpine AS manager-builder
WORKDIR /app
COPY package.json ./
COPY index.html ./
COPY jsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN npm run test

ARG NGINX_IMAGE=ghcr.io/wkarts/argws-connect-nginx:1.27-alpine
FROM ${NGINX_IMAGE}
ARG APP_VERSION=1.0.0
LABEL org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.title="Connect|API Manager" \
      org.opencontainers.image.description="Connect|API Manager" \
      org.opencontainers.image.source="https://github.com/wkarts/argws-connect-api"
COPY --from=manager-builder /app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/40-manager-runtime-config.sh /docker-entrypoint.d/40-manager-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-manager-runtime-config.sh
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1
