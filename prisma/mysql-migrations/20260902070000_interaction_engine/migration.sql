-- Connect|API Interaction Engine
CREATE TABLE `TemplateInteractionSession` (
  `id` VARCHAR(191) NOT NULL,
  `outboundMessageId` VARCHAR(255) NOT NULL,
  `inboundMessageId` VARCHAR(255) NULL,
  `remoteJid` VARCHAR(150) NOT NULL,
  `templateName` VARCHAR(255) NOT NULL,
  `language` VARCHAR(20) NOT NULL DEFAULT 'pt_BR',
  `variables` JSON NULL,
  `actions` JSON NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'OPEN',
  `expiresAt` TIMESTAMP(3) NULL,
  `lastError` TEXT NULL,
  `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` TIMESTAMP(3) NOT NULL,
  `instanceId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `TemplateInteractionSession_instanceId_outboundMessageId_key` (`instanceId`, `outboundMessageId`),
  INDEX `TemplateInteractionSession_instanceId_remoteJid_status_idx` (`instanceId`, `remoteJid`, `status`),
  CONSTRAINT `TemplateInteractionSession_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
