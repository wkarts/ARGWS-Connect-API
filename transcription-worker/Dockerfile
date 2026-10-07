ARG NODE_IMAGE=ghcr.io/wkarts/argws-connect-node:22-bookworm-slim
ARG APP_VERSION=1.0.0

FROM ${NODE_IMAGE} AS native-builder
# v1.8.2; verified against ggml-org/whisper.cpp refs/tags/v1.8.2.
ARG WHISPER_CPP_COMMIT=4979e04f5dcaccb36057e059bbaed8a2f5288315
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY scripts/build-whisper.sh /usr/local/bin/build-whisper
RUN git init /src/whisper.cpp \
  && git -C /src/whisper.cpp remote add origin https://github.com/ggml-org/whisper.cpp.git \
  && git -C /src/whisper.cpp fetch --depth 1 origin "${WHISPER_CPP_COMMIT}" \
  && git -C /src/whisper.cpp checkout --detach FETCH_HEAD \
  && test "$(git -C /src/whisper.cpp rev-parse HEAD)" = "${WHISPER_CPP_COMMIT}" \
  && sh /usr/local/bin/build-whisper /src/whisper.cpp /build \
  && mkdir /native \
  && cp -a /build/bin/whisper-server /build/bin/*.so* /native/ \
  && strip /native/whisper-server

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION
ARG WHISPER_CPP_COMMIT=4979e04f5dcaccb36057e059bbaed8a2f5288315

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    ONNXRUNTIME_NODE_INSTALL_CUDA=skip \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OMP_WAIT_POLICY=PASSIVE \
    SPEECH_WHISPER_CPP_BINARY=/usr/local/bin/whisper-server \
    CONNECT_API_VERSION=${APP_VERSION}

WORKDIR /opt/connect-speech

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates libstdc++6 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# CPU-only installation avoids fetching the unrelated ONNX CUDA distribution.
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force \
  && node -e "require('onnxruntime-node'); require('amqplib'); require('minio')"
COPY --from=native-builder /native/ ./native/
COPY --from=native-builder /src/whisper.cpp/LICENSE /usr/share/doc/whisper.cpp/LICENSE
COPY --from=native-builder /src/whisper.cpp/samples/jfk.wav ./native/jfk.wav
COPY src ./src
COPY scripts ./scripts
RUN ln -s /opt/connect-speech/native/whisper-server /usr/local/bin/whisper-server \
  && /usr/local/bin/whisper-server --help >/dev/null 2>&1 \
  && chown -R node:node /opt/connect-speech

USER node

LABEL org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.title="Connect|API Speech Pool" \
      org.opencontainers.image.description="Private persistent speech pool with bounded native execution" \
      org.opencontainers.image.source="https://github.com/wkarts/ARGWS-Connect-API" \
      io.connect.speech.whisper-cpp-revision="${WHISPER_CPP_COMMIT}"

ENTRYPOINT ["node", "src/index.js"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD test -f /tmp/transcription-worker.ready
