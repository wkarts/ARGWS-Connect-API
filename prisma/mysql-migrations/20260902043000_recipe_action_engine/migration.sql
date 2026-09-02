-- Connect|API Recipe / Action Engine foundation
CREATE TABLE `IntegrationAction` (
  `id` VARCHAR(191) NOT NULL,
  `actionKey` VARCHAR(150) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `method` VARCHAR(10) NOT NULL,
  `baseUrl` VARCHAR(500) NOT NULL,
  `path` VARCHAR(500) NOT NULL,
  `credentialRef` VARCHAR(100) NULL,
  `headers` JSON NULL,
  `requestTemplate` JSON NULL,
  `inputSchema` JSON NULL,
  `outputMapping` JSON NULL,
  `timeoutMs` INTEGER NOT NULL DEFAULT 10000,
  `confirmation` VARCHAR(20) NOT NULL DEFAULT 'NONE',
  `allowPrivateNetwork` BOOLEAN NOT NULL DEFAULT false,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` TIMESTAMP(3) NOT NULL,
  `instanceId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `IntegrationAction_instanceId_actionKey_key` (`instanceId`, `actionKey`),
  INDEX `IntegrationAction_instanceId_enabled_idx` (`instanceId`, `enabled`),
  CONSTRAINT `IntegrationAction_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Recipe` (
  `id` VARCHAR(191) NOT NULL,
  `recipeKey` VARCHAR(150) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `steps` JSON NOT NULL,
  `inputSchema` JSON NULL,
  `outputTemplate` JSON NULL,
  `confirmation` VARCHAR(20) NOT NULL DEFAULT 'NONE',
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` TIMESTAMP(3) NOT NULL,
  `instanceId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Recipe_instanceId_recipeKey_key` (`instanceId`, `recipeKey`),
  INDEX `Recipe_instanceId_enabled_idx` (`instanceId`, `enabled`),
  CONSTRAINT `Recipe_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ActionExecution` (
  `id` VARCHAR(191) NOT NULL,
  `actionKey` VARCHAR(150) NOT NULL,
  `recipeKey` VARCHAR(150) NULL,
  `status` VARCHAR(30) NOT NULL,
  `requestMeta` JSON NULL,
  `responseMeta` JSON NULL,
  `errorMeta` JSON NULL,
  `startedAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` TIMESTAMP(3) NULL,
  `instanceId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ActionExecution_instanceId_actionKey_startedAt_idx` (`instanceId`, `actionKey`, `startedAt`),
  CONSTRAINT `ActionExecution_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
