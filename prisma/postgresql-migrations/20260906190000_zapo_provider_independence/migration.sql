-- Connect|API provider independence: retire the legacy CONNECT bridge.
-- Existing CONNECT instances are moved to the native Zapo provider and forced
-- closed so the operator explicitly pairs the WhatsApp account with Zapo.
UPDATE "Instance"
SET "integration" = 'WHATSAPP-ZAPO', "connectionStatus" = 'close'
WHERE "integration" = 'CONNECT';

-- WavoIP is no longer part of Connect|API voice architecture.
ALTER TABLE "Setting" DROP COLUMN IF EXISTS "wavoipToken";
