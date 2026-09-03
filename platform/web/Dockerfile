ARG NODE_IMAGE=ghcr.io/wkarts/argws-connect-node:24-alpine
ARG NGINX_IMAGE=ghcr.io/wkarts/argws-connect-nginx:1.27-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ARG APP_VERSION=dev
ARG VITE_APP_NAME="Connect|API Platform"
ARG VITE_CONTROL_PLANE_HOST="control.connect-api.example.com"
ARG VITE_PARTNER_PLANE_HOST="partner.connect-api.example.com"
ARG VITE_API_BASE_URL="/api"
ENV VITE_APP_NAME=$VITE_APP_NAME \
    VITE_APP_VERSION=$APP_VERSION \
    VITE_CONTROL_PLANE_HOST=$VITE_CONTROL_PLANE_HOST \
    VITE_PARTNER_PLANE_HOST=$VITE_PARTNER_PLANE_HOST \
    VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY VERSION /VERSION
COPY platform/web/package.json platform/web/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY platform/web/ ./
RUN npm run build

FROM ${NGINX_IMAGE}
COPY platform/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=20s --timeout=5s --retries=10 CMD wget -q --spider http://127.0.0.1/ || exit 1
