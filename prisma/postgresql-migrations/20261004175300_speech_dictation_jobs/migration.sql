ALTER TABLE "TranscriptionJob"
  ADD COLUMN "mode" VARCHAR(20) NOT NULL DEFAULT 'transcription',
  ADD COLUMN "sourceType" VARCHAR(24) NOT NULL DEFAULT 'upload',
  ADD COLUMN "originalFilename" VARCHAR(255),
  ADD COLUMN "sizeBytes" INTEGER,
  ADD COLUMN "audioHash" VARCHAR(64),
  ADD COLUMN "idempotencyKey" VARCHAR(128),
  ADD COLUMN "stage" VARCHAR(32),
  ADD COLUMN "progressPercent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processedDurationMs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "heartbeatAt" TIMESTAMP(3);

CREATE INDEX "TranscriptionJob_mode_status_createdAt_idx"
  ON "TranscriptionJob"("mode", "status", "createdAt");
CREATE UNIQUE INDEX "TranscriptionJob_instanceId_mode_audioHash_model_language_key"
  ON "TranscriptionJob"("instanceId", "mode", "audioHash", "model", "language");
CREATE UNIQUE INDEX "TranscriptionJob_instanceId_mode_idempotencyKey_key"
  ON "TranscriptionJob"("instanceId", "mode", "idempotencyKey");
