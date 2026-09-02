CREATE TABLE `MetaCompatibility` (
    `id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `webhookUrl` VARCHAR(500) NULL,
    `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` TIMESTAMP(3) NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,
    UNIQUE INDEX `MetaCompatibility_instanceId_key`(`instanceId`),
    INDEX `MetaCompatibility_instanceId_idx`(`instanceId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `MetaCompatibility_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
