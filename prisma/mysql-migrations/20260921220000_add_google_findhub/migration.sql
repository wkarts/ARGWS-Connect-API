CREATE TABLE `FindHubAccount` (
  `id` VARCHAR(191) NOT NULL,
  `instanceId` VARCHAR(191) NOT NULL,
  `googleEmail` VARCHAR(320) NULL,
  `authState` VARCHAR(40) NOT NULL DEFAULT 'WAITING_AUTH',
  `encryptedCredentials` LONGTEXT NULL,
  `encryptedSharedKey` LONGTEXT NULL,
  `clientUuid` VARCHAR(64) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `FindHubAccount_instanceId_key` (`instanceId`), INDEX `FindHubAccount_instanceId_idx` (`instanceId`),
  CONSTRAINT `FindHubAccount_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FindHubDevice` (
  `id` VARCHAR(191) NOT NULL,
  `instanceId` VARCHAR(191) NOT NULL,
  `accountId` VARCHAR(191) NOT NULL,
  `googleDeviceId` VARCHAR(512) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `identifierType` VARCHAR(32) NOT NULL,
  `deviceType` VARCHAR(32) NOT NULL,
  `manufacturer` VARCHAR(255) NULL,
  `model` VARCHAR(255) NULL,
  `imageUrl` TEXT NULL,
  `trackingEnabled` BOOLEAN NOT NULL DEFAULT false,
  `trackingIntervalSeconds` INTEGER NOT NULL DEFAULT 60,
  `lastLocationAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `FindHubDevice_instanceId_googleDeviceId_key` (`instanceId`, `googleDeviceId`), INDEX `FindHubDevice_instanceId_idx` (`instanceId`), INDEX `FindHubDevice_accountId_idx` (`accountId`),
  CONSTRAINT `FindHubDevice_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `FindHubDevice_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `FindHubAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FindHubPosition` (
  `id` VARCHAR(191) NOT NULL,
  `instanceId` VARCHAR(191) NOT NULL,
  `deviceId` VARCHAR(191) NOT NULL,
  `latitude` DOUBLE NOT NULL,
  `longitude` DOUBLE NOT NULL,
  `altitude` INTEGER NULL,
  `accuracy` DOUBLE NULL,
  `source` VARCHAR(32) NOT NULL,
  `ownReport` BOOLEAN NOT NULL DEFAULT false,
  `semanticLocation` VARCHAR(500) NULL,
  `recordedAt` TIMESTAMP NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), INDEX `FindHubPosition_instanceId_idx` (`instanceId`), INDEX `FindHubPosition_deviceId_recordedAt_idx` (`deviceId`, `recordedAt`),
  CONSTRAINT `FindHubPosition_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `FindHubPosition_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `FindHubDevice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FindHubTraccarBinding` (
  `id` VARCHAR(191) NOT NULL,
  `instanceId` VARCHAR(191) NOT NULL,
  `deviceId` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `url` TEXT NOT NULL,
  `traccarDeviceId` VARCHAR(255) NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `FindHubTraccarBinding_deviceId_key` (`deviceId`), INDEX `FindHubTraccarBinding_instanceId_idx` (`instanceId`),
  CONSTRAINT `FindHubTraccarBinding_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `FindHubTraccarBinding_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `FindHubDevice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
