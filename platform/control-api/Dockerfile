ARG PYTHON_IMAGE=ghcr.io/wkarts/argws-connect-python:3.13-slim
FROM ${PYTHON_IMAGE} AS runtime

ARG APP_VERSION=dev
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_VERSION=${APP_VERSION}

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates postgresql-client zstd rclone age tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY VERSION /app/VERSION
COPY platform/control-api/requirements.txt ./requirements.txt
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY platform/control-api/ ./
COPY platform/scripts/ /workspace/scripts/

RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data/backups /data/runtime /var/lib/celery \
    && chown -R appuser:root /app /data /workspace /var/lib/celery \
    && chmod 0770 /data/backups /data/runtime /var/lib/celery

USER 10001:0
EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["gunicorn", "app.main:app", "--worker-class", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "120", "--graceful-timeout", "30", "--access-logfile", "-"]
