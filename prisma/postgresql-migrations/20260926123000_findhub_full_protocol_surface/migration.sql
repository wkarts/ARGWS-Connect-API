-- Additive Google Find Hub protocol metadata and provider freshness counters.
ALTER TABLE "FindHubDevice"
  ADD COLUMN "fastPairModelId" VARCHAR(255),
  ADD COLUMN "pairedAt" TIMESTAMP,
  ADD COLUMN "canonicalIds" JSONB,
  ADD COLUMN "accessInformation" JSONB,
  ADD COLUMN "ownerKeyVersion" INTEGER,
  ADD COLUMN "identityKeyFingerprint" VARCHAR(64),
  ADD COLUMN "accountKeyFingerprint" VARCHAR(64),
  ADD COLUMN "publicAddressFingerprint" VARCHAR(64),
  ADD COLUMN "secretsCreatedAt" TIMESTAMP,
  ADD COLUMN "networkAggregationMinReports" INTEGER,
  ADD COLUMN "providerRequestCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "providerReportCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "providerRepeatedReportCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastProviderRequestAt" TIMESTAMP,
  ADD COLUMN "lastProviderReportAt" TIMESTAMP;
