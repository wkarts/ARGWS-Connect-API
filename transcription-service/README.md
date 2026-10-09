# Optional transcription service

This is the only speech runtime. `node src/service.js` loads a single native
whisper.cpp engine on demand; `SPEECH_ENABLED=false` starts no dependencies,
consumer or model. There is no Transformers/ONNX executor or separate dictation
container. The crash-safe coordinator retains the existing v2 job contracts.

See `../docs/guides/optional-transcription-service.md` for deployment, supported
inputs, bounded normalization, verified model provisioning, migration and limits.

```sh
npm ci --ignore-scripts
npm test
SPEECH_ENABLED=false npm start
```

The Docker build compiles the pinned whisper.cpp revision, includes FFmpeg only
for the requested speech operation and bundles no model. Runtime inference needs
no external AI API; models can be provisioned before moving to an offline host.
