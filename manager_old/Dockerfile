ARG NGINX_IMAGE=ghcr.io/wkarts/argws-connect-nginx:1.27-alpine
FROM ${NGINX_IMAGE}
ARG APP_VERSION=1.0.0
LABEL org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.title="ARGWS Connect Manager" \
      org.opencontainers.image.description="ARGWS Connect API Manager" \
      org.opencontainers.image.source="https://github.com/wkarts/argws-connect-api"
COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
