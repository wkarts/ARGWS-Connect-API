ARG NGINX_IMAGE=ghcr.io/wkarts/argws-connect-nginx:1.27-alpine
FROM ${NGINX_IMAGE}
COPY platform/gateway/default.conf.template /etc/nginx/templates/default.conf.template
ENV PLATFORM_DOMAIN=connect.example.com \
    CONTROL_PLANE_HOST=control.connect.example.com \
    ADMIN_HOST=admin.connect.example.com \
    PARTNER_PLANE_HOST=partner.connect.example.com \
    API_HOST=api.connect.example.com \
    DOCS_HOST=docs.connect.example.com \
    DEMO_HOST=demo.connect.example.com \
    TENANT_DOMAIN_ROOT=connect.example.com
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=20 CMD wget -q --spider --header="Host: ${PLATFORM_DOMAIN}" http://127.0.0.1/ || exit 1
