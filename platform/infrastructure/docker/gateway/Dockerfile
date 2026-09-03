FROM nginx:1.27-alpine
COPY infrastructure/nginx/gateway.conf.template /etc/nginx/templates/default.conf.template
COPY infrastructure/docker/gateway/landing/ /usr/share/nginx/landing/
ENV PLATFORM_DOMAIN=connect-api.example.com \
    CONTROL_PLANE_HOST=control.connect-api.example.com \
    ADMIN_HOST=admin.connect-api.example.com \
    API_HOST=api.connect-api.example.com \
    DEMO_HOST=demo.connect-api.example.com \
    TENANT_DOMAIN_ROOT=connect-api.example.com
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=20 CMD wget -q --spider --header="Host: ${API_HOST}" http://127.0.0.1/health/live || exit 1
