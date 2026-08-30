-- ARGWS Connect API canonical rename.
-- Historical migrations are intentionally preserved; this migration moves existing databases forward.

ALTER TABLE "ConnectBot" RENAME TO "ConnectBot";
ALTER TABLE "ConnectBotSetting" RENAME TO "ConnectBotSetting";
ALTER TABLE "Connectai" RENAME TO "ConnectAI";
ALTER TABLE "ConnectaiSetting" RENAME TO "ConnectAISetting";

ALTER TABLE "ConnectAISetting" RENAME COLUMN "connectaiIdFallback" TO "connectAIIdFallback";

ALTER TABLE "ConnectBot" RENAME CONSTRAINT "ConnectBot_pkey" TO "ConnectBot_pkey";
ALTER TABLE "ConnectBotSetting" RENAME CONSTRAINT "ConnectBotSetting_pkey" TO "ConnectBotSetting_pkey";
ALTER TABLE "ConnectBot" RENAME CONSTRAINT "ConnectBot_instanceId_fkey" TO "ConnectBot_instanceId_fkey";
ALTER TABLE "ConnectBotSetting" RENAME CONSTRAINT "ConnectBotSetting_botIdFallback_fkey" TO "ConnectBotSetting_botIdFallback_fkey";
ALTER TABLE "ConnectBotSetting" RENAME CONSTRAINT "ConnectBotSetting_instanceId_fkey" TO "ConnectBotSetting_instanceId_fkey";
ALTER INDEX "ConnectBotSetting_instanceId_key" RENAME TO "ConnectBotSetting_instanceId_key";

ALTER TABLE "ConnectAI" RENAME CONSTRAINT "Connectai_pkey" TO "ConnectAI_pkey";
ALTER TABLE "ConnectAISetting" RENAME CONSTRAINT "ConnectaiSetting_pkey" TO "ConnectAISetting_pkey";
ALTER TABLE "ConnectAI" RENAME CONSTRAINT "Connectai_instanceId_fkey" TO "ConnectAI_instanceId_fkey";
ALTER TABLE "ConnectAISetting" RENAME CONSTRAINT "ConnectaiSetting_connectaiIdFallback_fkey" TO "ConnectAISetting_connectAIIdFallback_fkey";
ALTER TABLE "ConnectAISetting" RENAME CONSTRAINT "ConnectaiSetting_instanceId_fkey" TO "ConnectAISetting_instanceId_fkey";
ALTER INDEX "ConnectaiSetting_instanceId_key" RENAME TO "ConnectAISetting_instanceId_key";

UPDATE "Instance" SET "integration" = 'CONNECT' WHERE "integration" = 'CONNECT';
