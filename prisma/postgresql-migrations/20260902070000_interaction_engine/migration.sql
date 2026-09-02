-- Connect|API Interaction Engine
CREATE TABLE "TemplateInteractionSession" (
  "id" TEXT NOT NULL,
  "outboundMessageId" VARCHAR(255) NOT NULL,
  "inboundMessageId" VARCHAR(255),
  "remoteJid" VARCHAR(150) NOT NULL,
  "templateName" VARCHAR(255) NOT NULL,
  "language" VARCHAR(20) NOT NULL DEFAULT 'pt_BR',
  "variables" JSONB,
  "actions" JSONB,
  "status" VARCHAR(40) NOT NULL DEFAULT 'OPEN',
  "expiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "instanceId" TEXT NOT NULL,
  CONSTRAINT "TemplateInteractionSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TemplateInteractionSession_instanceId_outboundMessageId_key" ON "TemplateInteractionSession"("instanceId", "outboundMessageId");
CREATE INDEX "TemplateInteractionSession_instanceId_remoteJid_status_idx" ON "TemplateInteractionSession"("instanceId", "remoteJid", "status");
ALTER TABLE "TemplateInteractionSession" ADD CONSTRAINT "TemplateInteractionSession_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
