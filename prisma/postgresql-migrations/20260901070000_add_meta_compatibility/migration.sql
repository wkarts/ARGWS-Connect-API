CREATE TABLE "MetaCompatibility" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookUrl" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "instanceId" TEXT NOT NULL,
    CONSTRAINT "MetaCompatibility_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaCompatibility_instanceId_key" ON "MetaCompatibility"("instanceId");
CREATE INDEX "MetaCompatibility_instanceId_idx" ON "MetaCompatibility"("instanceId");
ALTER TABLE "MetaCompatibility" ADD CONSTRAINT "MetaCompatibility_instanceId_fkey"
FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
