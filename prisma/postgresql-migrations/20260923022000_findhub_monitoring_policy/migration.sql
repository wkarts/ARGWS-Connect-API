-- Additive Find Hub monitoring policy. Never change credentials or WhatsApp tables.
ALTER TABLE "FindHubAccount" ADD COLUMN "settings" JSONB, ADD COLUMN "catalogStatus" JSONB;
ALTER TABLE "FindHubDevice" ADD COLUMN "catalogMetadata" JSONB, ADD COLUMN "lastPosition" JSONB,
  ADD COLUMN "lastReceivedAt" TIMESTAMP(3), ADD COLUMN "locationTimeoutMs" INTEGER;
ALTER TABLE "FindHubPosition" ADD COLUMN "deduplicationKey" VARCHAR(64);
CREATE UNIQUE INDEX "FindHubPosition_deduplicationKey_key" ON "FindHubPosition"("deduplicationKey");
CREATE INDEX "FindHubPosition_instanceId_recordedAt_idx" ON "FindHubPosition" ("instanceId", "recordedAt");
