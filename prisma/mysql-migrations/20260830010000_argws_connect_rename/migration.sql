-- ARGWS Connect API canonical rename.
-- Historical migrations are intentionally preserved; this migration moves existing databases forward.

RENAME TABLE `ConnectBot` TO `ConnectBot`,
             `ConnectBotSetting` TO `ConnectBotSetting`,
             `Connectai` TO `ConnectAI`,
             `ConnectaiSetting` TO `ConnectAISetting`;

ALTER TABLE `ConnectAISetting`
  CHANGE COLUMN `connectaiIdFallback` `connectAIIdFallback` VARCHAR(100) NULL;

ALTER TABLE `ConnectBotSetting`
  RENAME INDEX `ConnectBotSetting_instanceId_key` TO `ConnectBotSetting_instanceId_key`;
ALTER TABLE `ConnectAISetting`
  RENAME INDEX `ConnectaiSetting_instanceId_key` TO `ConnectAISetting_instanceId_key`;

ALTER TABLE `ConnectBot` DROP FOREIGN KEY `ConnectBot_instanceId_fkey`;
ALTER TABLE `ConnectBotSetting` DROP FOREIGN KEY `ConnectBotSetting_botIdFallback_fkey`;
ALTER TABLE `ConnectBotSetting` DROP FOREIGN KEY `ConnectBotSetting_instanceId_fkey`;
ALTER TABLE `ConnectAI` DROP FOREIGN KEY `Connectai_instanceId_fkey`;
ALTER TABLE `ConnectAISetting` DROP FOREIGN KEY `ConnectaiSetting_connectaiIdFallback_fkey`;
ALTER TABLE `ConnectAISetting` DROP FOREIGN KEY `ConnectaiSetting_instanceId_fkey`;

ALTER TABLE `ConnectBot`
  ADD CONSTRAINT `ConnectBot_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ConnectBotSetting`
  ADD CONSTRAINT `ConnectBotSetting_botIdFallback_fkey` FOREIGN KEY (`botIdFallback`) REFERENCES `ConnectBot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `ConnectBotSetting_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ConnectAI`
  ADD CONSTRAINT `ConnectAI_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ConnectAISetting`
  ADD CONSTRAINT `ConnectAISetting_connectAIIdFallback_fkey` FOREIGN KEY (`connectAIIdFallback`) REFERENCES `ConnectAI`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `ConnectAISetting_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE `Instance` SET `integration` = 'CONNECT' WHERE `integration` = 'CONNECT';
