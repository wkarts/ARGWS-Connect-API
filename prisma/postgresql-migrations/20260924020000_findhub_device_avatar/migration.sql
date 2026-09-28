-- User avatar belongs only to the Find Hub device; existing tables and credentials are preserved.
ALTER TABLE "FindHubDevice" ADD COLUMN "avatarData" TEXT;
