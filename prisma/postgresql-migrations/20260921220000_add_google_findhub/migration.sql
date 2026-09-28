CREATE TABLE "FindHubAccount" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "googleEmail" VARCHAR(320),
    "authState" VARCHAR(40) NOT NULL DEFAULT 'WAITING_AUTH',
    "encryptedCredentials" TEXT,
    "encryptedSharedKey" TEXT,
    "clientUuid" VARCHAR(64),
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    CONSTRAINT "FindHubAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FindHubAccount_instanceId_key" ON "FindHubAccount"("instanceId");
CREATE INDEX "FindHubAccount_instanceId_idx" ON "FindHubAccount"("instanceId");

CREATE TABLE "FindHubDevice" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "googleDeviceId" VARCHAR(512) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "identifierType" VARCHAR(32) NOT NULL,
    "deviceType" VARCHAR(32) NOT NULL,
    "manufacturer" VARCHAR(255),
    "model" VARCHAR(255),
    "imageUrl" VARCHAR(1000),
    "trackingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "trackingIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "lastLocationAt" TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    CONSTRAINT "FindHubDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FindHubDevice_instanceId_googleDeviceId_key" ON "FindHubDevice"("instanceId", "googleDeviceId");
CREATE INDEX "FindHubDevice_instanceId_idx" ON "FindHubDevice"("instanceId");
CREATE INDEX "FindHubDevice_accountId_idx" ON "FindHubDevice"("accountId");

CREATE TABLE "FindHubPosition" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "altitude" INTEGER,
    "accuracy" DOUBLE PRECISION,
    "source" VARCHAR(32) NOT NULL,
    "ownReport" BOOLEAN NOT NULL DEFAULT false,
    "semanticLocation" VARCHAR(500),
    "recordedAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FindHubPosition_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FindHubPosition_instanceId_idx" ON "FindHubPosition"("instanceId");
CREATE INDEX "FindHubPosition_deviceId_recordedAt_idx" ON "FindHubPosition"("deviceId", "recordedAt");

CREATE TABLE "FindHubTraccarBinding" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "url" VARCHAR(1000) NOT NULL,
    "traccarDeviceId" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    CONSTRAINT "FindHubTraccarBinding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FindHubTraccarBinding_deviceId_key" ON "FindHubTraccarBinding"("deviceId");
CREATE INDEX "FindHubTraccarBinding_instanceId_idx" ON "FindHubTraccarBinding"("instanceId");

ALTER TABLE "FindHubAccount" ADD CONSTRAINT "FindHubAccount_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FindHubDevice" ADD CONSTRAINT "FindHubDevice_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FindHubDevice" ADD CONSTRAINT "FindHubDevice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FindHubAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FindHubPosition" ADD CONSTRAINT "FindHubPosition_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FindHubPosition" ADD CONSTRAINT "FindHubPosition_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "FindHubDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FindHubTraccarBinding" ADD CONSTRAINT "FindHubTraccarBinding_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FindHubTraccarBinding" ADD CONSTRAINT "FindHubTraccarBinding_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "FindHubDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
