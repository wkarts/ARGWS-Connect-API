ALTER TABLE "MetaCompatibility" ALTER COLUMN "enabled" SET DEFAULT true;
UPDATE "MetaCompatibility" SET "enabled" = true WHERE "enabled" = false;
