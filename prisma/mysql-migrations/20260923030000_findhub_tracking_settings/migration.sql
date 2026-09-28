-- Additive tracking data; existing Google/WhatsApp credentials are unchanged.
ALTER TABLE `FindHubAccount` ADD COLUMN `trackingSettings` JSON NULL;
ALTER TABLE `FindHubAccount` ADD COLUMN `encryptedTraccar` TEXT NULL;
ALTER TABLE `FindHubDevice` ADD COLUMN `latestPosition` JSON NULL;
ALTER TABLE `FindHubDevice` ADD COLUMN `lastReceivedAt` DATETIME(3) NULL;
ALTER TABLE `FindHubDevice` ADD COLUMN `lastAttemptAt` DATETIME(3) NULL;
ALTER TABLE `FindHubDevice` ADD COLUMN `lastErrorCode` VARCHAR(64) NULL;
ALTER TABLE `FindHubDevice` ADD COLUMN `providerStatus` VARCHAR(32) NULL;
ALTER TABLE `FindHubDevice` ADD COLUMN `locationTimeoutMs` INTEGER NULL;
ALTER TABLE `FindHubPosition` ADD COLUMN `fingerprint` VARCHAR(64) NULL;
ALTER TABLE `FindHubTraccarBinding` ADD COLUMN `traccarNumericId` INTEGER NULL;
CREATE INDEX `FindHubPosition_instanceId_recordedAt_idx` ON `FindHubPosition` (`instanceId`, `recordedAt`);
CREATE UNIQUE INDEX `FindHubPosition_instanceId_deviceId_fingerprint_key` ON `FindHubPosition` (`instanceId`, `deviceId`, `fingerprint`);
