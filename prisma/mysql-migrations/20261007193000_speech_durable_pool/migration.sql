-- DropForeignKey
ALTER TABLE `TranscriptionJob` DROP FOREIGN KEY `TranscriptionJob_instanceId_fkey`;

-- DropIndex
DROP INDEX `TranscriptionJob_instanceId_mode_audioHash_model_language_key` ON `TranscriptionJob`;

-- DropIndex
DROP INDEX `TranscriptionJob_instanceId_mode_idempotencyKey_key` ON `TranscriptionJob`;

-- AlterTable
ALTER TABLE `TranscriptionJob` ADD COLUMN `cancelRequestedAt` TIMESTAMP NULL,
    ADD COLUMN `checkpoint` JSON NULL,
    ADD COLUMN `controlHeartbeatAt` TIMESTAMP NULL,
    ADD COLUMN `deadlineAt` TIMESTAMP NULL,
    ADD COLUMN `dedupKey` VARCHAR(64) NULL,
    ADD COLUMN `effectiveModel` VARCHAR(100) NULL,
    ADD COLUMN `engine` VARCHAR(32) NULL,
    ADD COLUMN `engineProgressAt` TIMESTAMP NULL,
    ADD COLUMN `executionId` VARCHAR(64) NULL,
    ADD COLUMN `generation` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `idempotencyHash` VARCHAR(64) NULL,
    ADD COLUMN `leaseExpiresAt` TIMESTAMP NULL,
    ADD COLUMN `modelRevision` VARCHAR(128) NULL,
    ADD COLUMN `poolId` VARCHAR(100) NOT NULL DEFAULT 'argws_connect',
    ADD COLUMN `protocolVersion` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `requestedModel` VARCHAR(100) NULL,
    ADD COLUMN `reservedBytes` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `reservedDurationMs` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `scopeKey` VARCHAR(160) NOT NULL DEFAULT 'admin:global',
    ADD COLUMN `sourceDeletedAt` TIMESTAMP NULL,
    ADD COLUMN `sourceExpiresAt` TIMESTAMP NULL;

-- Preserve existing jobs and isolate historical duplicates; never replay v1 automatically.
UPDATE `TranscriptionJob` SET
  `dedupKey` = SHA2(CONCAT('legacy:', `id`), 256),
  `scopeKey` = CASE WHEN `instanceId` IS NULL THEN 'admin:global' ELSE CONCAT('instance:', `instanceId`) END,
  `requestedModel` = `model`, `reservedBytes` = COALESCE(`sizeBytes`, 26214400),
  `reservedDurationMs` = CASE WHEN `mode` = 'dictation' THEN 60000 ELSE 3600000 END;
ALTER TABLE `TranscriptionJob` MODIFY `dedupKey` VARCHAR(64) NOT NULL;
ALTER TABLE `TranscriptionJob` ALTER COLUMN `protocolVersion` SET DEFAULT 2;

-- Execution identity and crash-recoverable source deletion fencing.
ALTER TABLE `TranscriptionJob`
  ADD COLUMN `requestedEngine` VARCHAR(32),
  ADD COLUMN `requestedRevision` VARCHAR(128),
  ADD COLUMN `sourceDeletionStartedAt` TIMESTAMP(3) NULL,
  ADD COLUMN `sourceDeletionToken` VARCHAR(64) NULL,
  ADD COLUMN `sourceBucket` VARCHAR(63) NULL;
CREATE INDEX `TranscriptionJob_poolId_sourceDeletedAt_completedAt_idx`
  ON `TranscriptionJob`(`poolId`, `sourceDeletedAt`, `completedAt`);

-- CreateTable
CREATE TABLE `SpeechPool` (
    `id` VARCHAR(100) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpeechUploadReservation` (
    `id` VARCHAR(64) NOT NULL,
    `poolId` VARCHAR(100) NOT NULL,
    `scopeKey` VARCHAR(160) NOT NULL,
    `reservedBytes` INTEGER NOT NULL,
    `sourceBucket` VARCHAR(63),
    `sourceKey` VARCHAR(500) NULL,
    `expiresAt` TIMESTAMP NOT NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX `SpeechUploadReservation_poolId_expiresAt_idx`(`poolId`, `expiresAt`),
    INDEX `SpeechUploadReservation_poolId_scopeKey_expiresAt_idx`(`poolId`, `scopeKey`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpeechOutbox` (
    `id` VARCHAR(64) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `poolId` VARCHAR(100) NOT NULL,
    `mode` VARCHAR(20) NOT NULL,
    `generation` INTEGER NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `availableAt` TIMESTAMP NOT NULL,
    `dispatchToken` VARCHAR(64) NULL,
    `lockedUntil` TIMESTAMP NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` VARCHAR(500) NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `publishedAt` TIMESTAMP NULL,

    INDEX `SpeechOutbox_poolId_status_availableAt_idx`(`poolId`, `status`, `availableAt`),
    INDEX `SpeechOutbox_status_publishedAt_idx`(`status`, `publishedAt`),
    UNIQUE INDEX `SpeechOutbox_jobId_generation_key`(`jobId`, `generation`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpeechWorker` (
    `id` VARCHAR(128) NOT NULL,
    `poolId` VARCHAR(100) NOT NULL,
    `modes` JSON NOT NULL,
    `health` JSON NOT NULL,
    `heartbeatAt` TIMESTAMP NOT NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL,

    INDEX `SpeechWorker_poolId_heartbeatAt_idx`(`poolId`, `heartbeatAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `TranscriptionJob_dedupKey_key` ON `TranscriptionJob`(`dedupKey`);

-- CreateIndex
CREATE UNIQUE INDEX `TranscriptionJob_idempotencyHash_key` ON `TranscriptionJob`(`idempotencyHash`);

-- CreateIndex
CREATE INDEX `TranscriptionJob_poolId_status_leaseExpiresAt_idx` ON `TranscriptionJob`(`poolId`, `status`, `leaseExpiresAt`);

-- CreateIndex
CREATE INDEX `TranscriptionJob_poolId_scopeKey_status_idx` ON `TranscriptionJob`(`poolId`, `scopeKey`, `status`);

-- CreateIndex
CREATE INDEX `TranscriptionJob_sourceExpiresAt_sourceDeletedAt_idx` ON `TranscriptionJob`(`sourceExpiresAt`, `sourceDeletedAt`);

-- CreateIndex
CREATE INDEX `TranscriptionJob_sourceKey_idx` ON `TranscriptionJob`(`sourceKey`);

-- AddForeignKey
ALTER TABLE `TranscriptionJob` ADD CONSTRAINT `TranscriptionJob_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
