-- Additive catalog: no changes to the official Meta Template table.
CREATE TABLE `LocalTemplate` (
  `id` VARCHAR(64) NOT NULL,
  `instanceId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(64) NOT NULL,
  `language` VARCHAR(16) NOT NULL,
  `components` JSON NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `version` INTEGER NOT NULL DEFAULT 1,
  `deletedAt` TIMESTAMP(3) NULL,
  `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` TIMESTAMP(3) NOT NULL,
  UNIQUE INDEX `LocalTemplate_instanceId_name_language_key` (`instanceId`, `name`, `language`),
  INDEX `LocalTemplate_instanceId_deletedAt_id_idx` (`instanceId`, `deletedAt`, `id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `LocalTemplate_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed once for existing instances; the unique key makes this insert idempotent.
INSERT INTO `LocalTemplate` (`id`, `instanceId`, `name`, `language`, `components`, `updatedAt`)
SELECT CONCAT('lt_', MD5(CONCAT('hello:pt_BR:', `id`))), `id`, 'hello', 'pt_BR',
  JSON_ARRAY(JSON_OBJECT('type', 'BODY', 'text', 'Olá! Como podemos ajudar?')), CURRENT_TIMESTAMP(3)
FROM `Instance` WHERE `integration` IN ('WHATSAPP-BAILEYS', 'WHATSAPP-ZAPO')
ON DUPLICATE KEY UPDATE `id` = `LocalTemplate`.`id`;
