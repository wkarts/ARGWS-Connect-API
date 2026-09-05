FROM neilpang/acme.sh:3.1.1
RUN apk add --no-cache ca-certificates coreutils python3 py3-cryptography openssl
COPY infrastructure/tls_common.py /app/tls_common.py
COPY infrastructure/acme/service.py /app/service.py
COPY infrastructure/acme/cloudflare_dns.py /app/cloudflare_dns.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 AUTO_UPGRADE=0
HEALTHCHECK --interval=60s --timeout=5s --start-period=120s --retries=3 CMD ["python3", "/app/service.py", "health"]
ENTRYPOINT ["python3", "/app/service.py"]
