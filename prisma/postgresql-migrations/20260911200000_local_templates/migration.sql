-- Additive catalog: no changes to the official Meta Template table.
CREATE TABLE "LocalTemplate" (
  "id" VARCHAR(64) NOT NULL,
  "instanceId" TEXT NOT NULL,
  "name" VARCHAR(64) NOT NULL,
  "language" VARCHAR(16) NOT NULL,
  "components" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LocalTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LocalTemplate_instanceId_name_language_key" ON "LocalTemplate"("instanceId", "name", "language");
CREATE INDEX "LocalTemplate_instanceId_deletedAt_id_idx" ON "LocalTemplate"("instanceId", "deletedAt", "id");
ALTER TABLE "LocalTemplate" ADD CONSTRAINT "LocalTemplate_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed once for existing instances. Reads never create/re-enable missing models.
INSERT INTO "LocalTemplate" ("id", "instanceId", "name", "language", "components", "updatedAt")
SELECT 'lt_' || md5('hello:pt_BR:' || "id"), "id", 'hello', 'pt_BR',
  '[{"type":"BODY","text":"Olá! Como podemos ajudar?"}]'::jsonb, CURRENT_TIMESTAMP
FROM "Instance" WHERE "integration" IN ('WHATSAPP-BAILEYS', 'WHATSAPP-ZAPO')
ON CONFLICT ("instanceId", "name", "language") DO NOTHING;
