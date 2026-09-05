ARG PYTHON_IMAGE=ghcr.io/wkarts/argws-connect-python:3.13-slim
FROM ${PYTHON_IMAGE} AS builder
ARG PGBOUNCER_VERSION=1.25.2
ARG PGBOUNCER_SHA256=924ad35113fd0a71c8e2dbe85b5d03445532e2b7b37a9f8a48983beea238b332
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libevent-dev libssl-dev pkg-config curl ca-certificates pandoc && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# Pin the upstream release and verify its published checksum during the build.
RUN curl --fail --show-error --location --retry 3 -O https://www.pgbouncer.org/downloads/files/${PGBOUNCER_VERSION}/pgbouncer-${PGBOUNCER_VERSION}.tar.gz \
    && echo "${PGBOUNCER_SHA256}  pgbouncer-${PGBOUNCER_VERSION}.tar.gz" | sha256sum -c - \
    && tar -xzf pgbouncer-${PGBOUNCER_VERSION}.tar.gz \
    && cd pgbouncer-${PGBOUNCER_VERSION} && ./configure --prefix=/usr/local --with-openssl && make -j2 && make install
FROM ${PYTHON_IMAGE}
ARG APP_VERSION=1.0.16
LABEL org.opencontainers.image.title="ARGWS Connect PgBouncer" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/wkarts/ARGWS-Connect-API"
RUN apt-get update && apt-get install -y --no-install-recommends libevent-dev libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir 'psycopg[binary]>=3.2,<4' \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin pooler
COPY --from=builder /usr/local/bin/pgbouncer /usr/local/bin/pgbouncer
COPY platform/infrastructure/pgbouncer/service.py /app/service.py
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 6432
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD ["python", "/app/service.py", "health"]
ENTRYPOINT ["python", "/app/service.py"]
