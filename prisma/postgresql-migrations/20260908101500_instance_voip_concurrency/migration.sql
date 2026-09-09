-- Per-instance WhatsApp VoIP concurrency limit.
-- Additive and nullable for safe upgrades from 1.0.21.
ALTER TABLE "Setting"
ADD COLUMN IF NOT EXISTS "voipMaxConcurrentCalls" INTEGER;
