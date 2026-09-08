ARG NODE_IMAGE=ghcr.io/wkarts/argws-connect-node:22-bookworm-slim
ARG NGINX_IMAGE=ghcr.io/wkarts/argws-connect-nginx:1.27-alpine
ARG APP_VERSION=1.0.0

FROM ${NODE_IMAGE} AS builder
WORKDIR /app

COPY package.json ./package.json
COPY index.html ./index.html
COPY jsconfig.json ./jsconfig.json
COPY public ./public
COPY src ./src
COPY scripts ./scripts
COPY docker-entrypoint.d ./docker-entrypoint.d

# O frontend usa ES Modules nativos. Dependências de browser ficam fixadas no
# package.json e são incorporadas ao dist; nenhuma dependência externa é
# carregada pelo navegador em produção.
RUN npm install --omit=dev --no-audit --no-fund
RUN npm run test

FROM ${NGINX_IMAGE}
ARG APP_VERSION
LABEL org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.title="Connect|API Manager" \
      org.opencontainers.image.description="Connect|API administration interface"

COPY --from=builder /app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/40-manager-runtime-config.sh /docker-entrypoint.d/40-manager-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-manager-runtime-config.sh

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1/health || exit 1
