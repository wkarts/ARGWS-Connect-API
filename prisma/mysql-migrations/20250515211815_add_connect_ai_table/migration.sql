-- CreateTable
CREATE TABLE `ConnectAI` (
    `id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `description` VARCHAR(255),
    `agentUrl` VARCHAR(255),
    `apiKey` VARCHAR(255),
    `expire` INTEGER DEFAULT 0,
    `keywordFinish` VARCHAR(100),
    `delayMessage` INTEGER,
    `unknownMessage` VARCHAR(100),
    `listeningFromMe` BOOLEAN DEFAULT false,
    `stopBotFromMe` BOOLEAN DEFAULT false,
    `keepOpen` BOOLEAN DEFAULT false,
    `debounceTime` INTEGER,
    `ignoreJids` JSON,
    `splitMessages` BOOLEAN DEFAULT false,
    `timePerChar` INTEGER DEFAULT 50,
    `triggerType` ENUM('all', 'keyword', 'none') NULL,
    `triggerOperator` ENUM('contains', 'equals', 'startsWith', 'endsWith', 'regex') NULL,
    `triggerValue` VARCHAR(191) NULL,
    `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConnectAISetting` (
    `id` VARCHAR(191) NOT NULL,
    `expire` INTEGER DEFAULT 0,
    `keywordFinish` VARCHAR(100),
    `delayMessage` INTEGER,
    `unknownMessage` VARCHAR(100),
    `listeningFromMe` BOOLEAN DEFAULT false,
    `stopBotFromMe` BOOLEAN DEFAULT false,
    `keepOpen` BOOLEAN DEFAULT false,
    `debounceTime` INTEGER,
    `ignoreJids` JSON,
    `splitMessages` BOOLEAN DEFAULT false,
    `timePerChar` INTEGER DEFAULT 50,
    `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,
    `connectAIIdFallback` VARCHAR(100),
    `instanceId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `ConnectAISetting_instanceId_key` ON `ConnectAISetting`(`instanceId`);

-- AddForeignKey
ALTER TABLE `ConnectAI` ADD CONSTRAINT `ConnectAI_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConnectAISetting` ADD CONSTRAINT `ConnectAISetting_connectAIIdFallback_fkey` FOREIGN KEY (`connectAIIdFallback`) REFERENCES `ConnectAI`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConnectAISetting` ADD CONSTRAINT `ConnectAISetting_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
