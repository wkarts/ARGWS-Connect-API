CREATE TABLE "TranscriptionJob" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT,
    "messageId" TEXT,
    "sourceKey" VARCHAR(500) NOT NULL,
    "sourceMimeType" VARCHAR(100) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "language" VARCHAR(16),
    "status" VARCHAR(20) NOT NULL,
    "text" TEXT,
    "segments" JSONB,
    "detectedLanguage" VARCHAR(32),
    "durationMs" INTEGER,
    "errorCode" VARCHAR(64),
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptionJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TranscriptionJob_status_createdAt_idx" ON "TranscriptionJob"("status", "createdAt");
CREATE INDEX "TranscriptionJob_instanceId_createdAt_idx" ON "TranscriptionJob"("instanceId", "createdAt");
CREATE INDEX "TranscriptionJob_messageId_idx" ON "TranscriptionJob"("messageId");

ALTER TABLE "TranscriptionJob"
  ADD CONSTRAINT "TranscriptionJob_instanceId_fkey"
  FOREIGN KEY ("instanceId") REFERENCES "Instance"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TranscriptionJob"
  ADD CONSTRAINT "TranscriptionJob_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
