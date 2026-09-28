-- Additive Google Find Hub protocol metadata and provider freshness counters.
ALTER TABLE `FindHubDevice`
  ADD COLUMN `fastPairModelId` VARCHAR(255) NULL,
  ADD COLUMN `pairedAt` TIMESTAMP NULL,
  ADD COLUMN `canonicalIds` JSON NULL,
  ADD COLUMN `accessInformation` JSON NULL,
  ADD COLUMN `ownerKeyVersion` INT NULL,
  ADD COLUMN `identityKeyFingerprint` VARCHAR(64) NULL,
  ADD COLUMN `accountKeyFingerprint` VARCHAR(64) NULL,
  ADD COLUMN `publicAddressFingerprint` VARCHAR(64) NULL,
  ADD COLUMN `secretsCreatedAt` TIMESTAMP NULL,
  ADD COLUMN `networkAggregationMinReports` INT NULL,
  ADD COLUMN `providerRequestCount` INT NOT NULL DEFAULT 0,
  ADD COLUMN `providerReportCount` INT NOT NULL DEFAULT 0,
  ADD COLUMN `providerRepeatedReportCount` INT NOT NULL DEFAULT 0,
  ADD COLUMN `lastProviderRequestAt` TIMESTAMP NULL,
  ADD COLUMN `lastProviderReportAt` TIMESTAMP NULL;
