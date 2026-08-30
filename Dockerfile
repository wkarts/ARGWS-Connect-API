FROM alpine:latest

LABEL org.opencontainers.image.source="https://github.com/wkarts/ARGWS-Connect-API"
LABEL org.opencontainers.image.description="Imagem Docker inicial do projeto"
LABEL org.opencontainers.image.licenses="Proprietary"

CMD ["sh", "-c", "echo Repository preconfigured for GHCR && sleep 5"]
