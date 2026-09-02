ALTER TABLE "MetaCompatibility" ADD COLUMN "policyMode" VARCHAR(20) NOT NULL DEFAULT 'PERMISSIVE';
ALTER TABLE "MetaCompatibility" ADD COLUMN "windowSeconds" INTEGER NOT NULL DEFAULT 86400;
ALTER TABLE "MetaCompatibility" ADD COLUMN "templateRequiredOutsideWindow" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "TemplateInteractionSession" ADD COLUMN "strongBindingId" VARCHAR(255);
ALTER TABLE "TemplateInteractionSession" ADD COLUMN "strongInput" JSONB;
ALTER TABLE "TemplateInteractionSession" ADD COLUMN "strongRequestedAt" TIMESTAMP(3);
ALTER TABLE "TemplateInteractionSession" ADD COLUMN "strongDecisionAt" TIMESTAMP(3);
ALTER TABLE "TemplateInteractionSession" ADD COLUMN "strongDecisionBy" VARCHAR(255);
ALTER TABLE "TemplateInteractionSession" ADD COLUMN "strongDecisionReason" TEXT;

CREATE TABLE "MetaConversationWindow" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "remoteJid" VARCHAR(150) NOT NULL,
  "lastInboundAt" TIMESTAMP(3),
  "windowExpiresAt" TIMESTAMP(3),
  "lastOutboundAt" TIMESTAMP(3),
  "lastPolicyDecision" VARCHAR(100),
  "lastPolicyAt" TIMESTAMP(3),
  "violationCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetaConversationWindow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MetaConversationWindow_instanceId_remoteJid_key" ON "MetaConversationWindow"("instanceId", "remoteJid");
CREATE INDEX "MetaConversationWindow_instanceId_windowExpiresAt_idx" ON "MetaConversationWindow"("instanceId", "windowExpiresAt");
ALTER TABLE "MetaConversationWindow" ADD CONSTRAINT "MetaConversationWindow_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
