CREATE TABLE "ManagerEmbeddingSetting" (
    "id" INTEGER NOT NULL,
    "configured" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowedOrigins" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    CONSTRAINT "ManagerEmbeddingSetting_pkey" PRIMARY KEY ("id")
);
