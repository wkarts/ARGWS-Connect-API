ALTER TABLE `MetaCompatibility` ADD COLUMN `policyMode` VARCHAR(20) NOT NULL DEFAULT 'PERMISSIVE';
ALTER TABLE `MetaCompatibility` ADD COLUMN `windowSeconds` INTEGER NOT NULL DEFAULT 86400;
ALTER TABLE `MetaCompatibility` ADD COLUMN `templateRequiredOutsideWindow` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `TemplateInteractionSession` ADD COLUMN `strongBindingId` VARCHAR(255) NULL;
ALTER TABLE `TemplateInteractionSession` ADD COLUMN `strongInput` JSON NULL;
ALTER TABLE `TemplateInteractionSession` ADD COLUMN `strongRequestedAt` DATETIME(3) NULL;
ALTER TABLE `TemplateInteractionSession` ADD COLUMN `strongDecisionAt` DATETIME(3) NULL;
ALTER TABLE `TemplateInteractionSession` ADD COLUMN `strongDecisionBy` VARCHAR(255) NULL;
ALTER TABLE `TemplateInteractionSession` ADD COLUMN `strongDecisionReason` TEXT NULL;

CREATE TABLE `MetaConversationWindow` (
  `id` VARCHAR(191) NOT NULL,
  `instanceId` VARCHAR(191) NOT NULL,
  `remoteJid` VARCHAR(150) NOT NULL,
  `lastInboundAt` DATETIME(3) NULL,
  `windowExpiresAt` DATETIME(3) NULL,
  `lastOutboundAt` DATETIME(3) NULL,
  `lastPolicyDecision` VARCHAR(100) NULL,
  `lastPolicyAt` DATETIME(3) NULL,
  `violationCount` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `MetaConversationWindow_instanceId_remoteJid_key` (`instanceId`, `remoteJid`),
  INDEX `MetaConversationWindow_instanceId_windowExpiresAt_idx` (`instanceId`, `windowExpiresAt`),
  CONSTRAINT `MetaConversationWindow_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
