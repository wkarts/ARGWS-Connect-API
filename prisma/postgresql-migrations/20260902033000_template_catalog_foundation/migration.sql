-- Connect|API canonical template catalog foundation
DROP INDEX IF EXISTS "Template_templateId_key";
DROP INDEX IF EXISTS "Template_name_key";

ALTER TABLE "Template"
  ADD COLUMN "externalTemplateId" VARCHAR(255),
  ADD COLUMN "language" VARCHAR(20) NOT NULL DEFAULT 'pt_BR',
  ADD COLUMN "category" VARCHAR(30) NOT NULL DEFAULT 'UTILITY',
  ADD COLUMN "status" VARCHAR(30) NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "origin" VARCHAR(30) NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "actions" JSONB,
  ADD COLUMN "policy" JSONB;

-- Existing rows were historically created from the Meta Business template endpoint.
UPDATE "Template"
SET "externalTemplateId" = "templateId", "origin" = 'META'
WHERE "externalTemplateId" IS NULL;

CREATE UNIQUE INDEX "Template_instanceId_templateId_key"
  ON "Template"("instanceId", "templateId");
CREATE UNIQUE INDEX "Template_instanceId_name_language_key"
  ON "Template"("instanceId", "name", "language");
CREATE INDEX "Template_instanceId_category_status_idx"
  ON "Template"("instanceId", "category", "status");
