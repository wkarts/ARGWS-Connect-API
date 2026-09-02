-- Connect|API Recipe / Action Engine foundation
CREATE TABLE "IntegrationAction" (
  "id" TEXT NOT NULL,
  "actionKey" VARCHAR(150) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "method" VARCHAR(10) NOT NULL,
  "baseUrl" VARCHAR(500) NOT NULL,
  "path" VARCHAR(500) NOT NULL,
  "credentialRef" VARCHAR(100),
  "headers" JSONB,
  "requestTemplate" JSONB,
  "inputSchema" JSONB,
  "outputMapping" JSONB,
  "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
  "confirmation" VARCHAR(20) NOT NULL DEFAULT 'NONE',
  "allowPrivateNetwork" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "instanceId" TEXT NOT NULL,
  CONSTRAINT "IntegrationAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Recipe" (
  "id" TEXT NOT NULL,
  "recipeKey" VARCHAR(150) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "steps" JSONB NOT NULL,
  "inputSchema" JSONB,
  "outputTemplate" JSONB,
  "confirmation" VARCHAR(20) NOT NULL DEFAULT 'NONE',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "instanceId" TEXT NOT NULL,
  CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActionExecution" (
  "id" TEXT NOT NULL,
  "actionKey" VARCHAR(150) NOT NULL,
  "recipeKey" VARCHAR(150),
  "status" VARCHAR(30) NOT NULL,
  "requestMeta" JSONB,
  "responseMeta" JSONB,
  "errorMeta" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "instanceId" TEXT NOT NULL,
  CONSTRAINT "ActionExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationAction_instanceId_actionKey_key" ON "IntegrationAction"("instanceId", "actionKey");
CREATE INDEX "IntegrationAction_instanceId_enabled_idx" ON "IntegrationAction"("instanceId", "enabled");
CREATE UNIQUE INDEX "Recipe_instanceId_recipeKey_key" ON "Recipe"("instanceId", "recipeKey");
CREATE INDEX "Recipe_instanceId_enabled_idx" ON "Recipe"("instanceId", "enabled");
CREATE INDEX "ActionExecution_instanceId_actionKey_startedAt_idx" ON "ActionExecution"("instanceId", "actionKey", "startedAt");

ALTER TABLE "IntegrationAction" ADD CONSTRAINT "IntegrationAction_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionExecution" ADD CONSTRAINT "ActionExecution_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
