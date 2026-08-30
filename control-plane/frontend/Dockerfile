ARG NODE_IMAGE=ghcr.io/wkarts/argws-platform-node:24-alpine
ARG NGINX_IMAGE=ghcr.io/wkarts/argws-platform-nginx:1.27-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build
FROM ${NGINX_IMAGE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
