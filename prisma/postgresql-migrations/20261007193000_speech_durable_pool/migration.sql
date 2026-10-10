-- DropIndex
DROP INDEX "TranscriptionJob_instanceId_mode_audioHash_model_language_key";

-- DropIndex
DROP INDEX "TranscriptionJob_instanceId_mode_idempotencyKey_key";

-- AlterTable
ALTER TABLE "TranscriptionJob" ADD COLUMN     "cancelRequestedAt" TIMESTAMP,
ADD COLUMN     "checkpoint" JSONB,
ADD COLUMN     "controlHeartbeatAt" TIMESTAMP,
ADD COLUMN     "deadlineAt" TIMESTAMP,
ADD COLUMN     "dedupKey" VARCHAR(64),
ADD COLUMN     "effectiveModel" VARCHAR(100),
ADD COLUMN     "engine" VARCHAR(32),
ADD COLUMN     "engineProgressAt" TIMESTAMP,
ADD COLUMN     "executionId" VARCHAR(64),
ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "idempotencyHash" VARCHAR(64),
ADD COLUMN     "leaseExpiresAt" TIMESTAMP,
ADD COLUMN     "modelRevision" VARCHAR(128),
ADD COLUMN     "poolId" VARCHAR(100) NOT NULL DEFAULT 'argws_connect',
ADD COLUMN     "protocolVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "requestedModel" VARCHAR(100),
ADD COLUMN     "reservedBytes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reservedDurationMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scopeKey" VARCHAR(160) NOT NULL DEFAULT 'admin:global',
ADD COLUMN     "sourceDeletedAt" TIMESTAMP,
ADD COLUMN     "sourceExpiresAt" TIMESTAMP;

-- Preserve existing jobs and isolate historical duplicates; never replay v1 automatically.
UPDATE "TranscriptionJob" SET
  "dedupKey" = md5('legacy:' || "id") || md5('speech:' || "id"),
  "scopeKey" = CASE WHEN "instanceId" IS NULL THEN 'admin:global' ELSE 'instance:' || "instanceId" END,
  "requestedModel" = "model", "reservedBytes" = COALESCE("sizeBytes", 26214400),
  "reservedDurationMs" = CASE WHEN "mode" = 'dictation' THEN 60000 ELSE 3600000 END;
ALTER TABLE "TranscriptionJob" ALTER COLUMN "dedupKey" SET NOT NULL;
ALTER TABLE "TranscriptionJob" ALTER COLUMN "protocolVersion" SET DEFAULT 2;

-- Execution identity and crash-recoverable source deletion fencing.
ALTER TABLE "TranscriptionJob"
  ADD COLUMN "requestedEngine" VARCHAR(32),
  ADD COLUMN "requestedRevision" VARCHAR(128),
  ADD COLUMN "sourceDeletionStartedAt" TIMESTAMP(3) NULL,
  ADD COLUMN "sourceDeletionToken" VARCHAR(64) NULL,
  ADD COLUMN "sourceBucket" VARCHAR(63) NULL;
CREATE INDEX "TranscriptionJob_poolId_sourceDeletedAt_completedAt_idx"
  ON "TranscriptionJob"("poolId", "sourceDeletedAt", "completedAt");

-- CreateTable
CREATE TABLE "SpeechPool" (
    "id" VARCHAR(100) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,

    CONSTRAINT "SpeechPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeechUploadReservation" (
    "id" VARCHAR(64) NOT NULL,
    "poolId" VARCHAR(100) NOT NULL,
    "scopeKey" VARCHAR(160) NOT NULL,
    "reservedBytes" INTEGER NOT NULL,
    "sourceBucket" VARCHAR(63),
    "sourceKey" VARCHAR(500),
    "expiresAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeechUploadReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeechOutbox" (
    "id" VARCHAR(64) NOT NULL,
    "jobId" VARCHAR(191) NOT NULL,
    "poolId" VARCHAR(100) NOT NULL,
    "mode" VARCHAR(20) NOT NULL,
    "generation" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "availableAt" TIMESTAMP NOT NULL,
    "dispatchToken" VARCHAR(64),
    "lockedUntil" TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP,

    CONSTRAINT "SpeechOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeechWorker" (
    "id" VARCHAR(128) NOT NULL,
    "poolId" VARCHAR(100) NOT NULL,
    "modes" JSONB NOT NULL,
    "health" JSONB NOT NULL,
    "heartbeatAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,

    CONSTRAINT "SpeechWorker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpeechUploadReservation_poolId_expiresAt_idx" ON "SpeechUploadReservation"("poolId", "expiresAt");

-- CreateIndex
CREATE INDEX "SpeechUploadReservation_poolId_scopeKey_expiresAt_idx" ON "SpeechUploadReservation"("poolId", "scopeKey", "expiresAt");

-- CreateIndex
CREATE INDEX "SpeechOutbox_poolId_status_availableAt_idx" ON "SpeechOutbox"("poolId", "status", "availableAt");

-- CreateIndex
CREATE INDEX "SpeechOutbox_status_publishedAt_idx" ON "SpeechOutbox"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpeechOutbox_jobId_generation_key" ON "SpeechOutbox"("jobId", "generation");

-- CreateIndex
CREATE INDEX "SpeechWorker_poolId_heartbeatAt_idx" ON "SpeechWorker"("poolId", "heartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptionJob_dedupKey_key" ON "TranscriptionJob"("dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptionJob_idempotencyHash_key" ON "TranscriptionJob"("idempotencyHash");

-- CreateIndex
CREATE INDEX "TranscriptionJob_poolId_status_leaseExpiresAt_idx" ON "TranscriptionJob"("poolId", "status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "TranscriptionJob_poolId_scopeKey_status_idx" ON "TranscriptionJob"("poolId", "scopeKey", "status");

-- CreateIndex
CREATE INDEX "TranscriptionJob_sourceExpiresAt_sourceDeletedAt_idx" ON "TranscriptionJob"("sourceExpiresAt", "sourceDeletedAt");

-- CreateIndex
CREATE INDEX "TranscriptionJob_sourceKey_idx" ON "TranscriptionJob"("sourceKey");
