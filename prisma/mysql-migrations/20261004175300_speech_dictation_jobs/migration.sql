ALTER TABLE `TranscriptionJob`
  ADD COLUMN `mode` VARCHAR(20) NOT NULL DEFAULT 'transcription',
  ADD COLUMN `sourceType` VARCHAR(24) NOT NULL DEFAULT 'upload',
  ADD COLUMN `originalFilename` VARCHAR(255) NULL,
  ADD COLUMN `sizeBytes` INT NULL,
  ADD COLUMN `audioHash` VARCHAR(64) NULL,
  ADD COLUMN `idempotencyKey` VARCHAR(128) NULL,
  ADD COLUMN `stage` VARCHAR(32) NULL,
  ADD COLUMN `progressPercent` INT NOT NULL DEFAULT 0,
  ADD COLUMN `processedDurationMs` INT NOT NULL DEFAULT 0,
  ADD COLUMN `heartbeatAt` DATETIME(3) NULL,
  ADD INDEX `TranscriptionJob_mode_status_createdAt_idx` (`mode`, `status`, `createdAt`),
  ADD UNIQUE INDEX `TranscriptionJob_instanceId_mode_audioHash_model_language_key` (`instanceId`, `mode`, `audioHash`, `model`, `language`),
  ADD UNIQUE INDEX `TranscriptionJob_instanceId_mode_idempotencyKey_key` (`instanceId`, `mode`, `idempotencyKey`);
