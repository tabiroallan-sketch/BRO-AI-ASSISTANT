-- AlterTable: add multi-account support to integrations
ALTER TABLE "integrations" ADD COLUMN "accountKey" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "integrations" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- Existing connections are the primary (and only) account for their provider.
UPDATE "integrations" SET "isPrimary" = true;

-- DropIndex
DROP INDEX "integrations_userId_provider_key";

-- CreateIndex
CREATE UNIQUE INDEX "integrations_userId_provider_accountKey_key" ON "integrations"("userId", "provider", "accountKey");

-- CreateIndex
CREATE INDEX "integrations_userId_provider_idx" ON "integrations"("userId", "provider");

-- CreateTable
CREATE TABLE "integration_statuses" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "latencyMs" INTEGER,
    "lastMessage" TEXT,
    "lastHealthCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_sets" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "permissionIds" JSONB NOT NULL DEFAULT '[]',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permission_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_history" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'health',
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "itemCount" INTEGER,
    "error" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_statuses_integrationId_key" ON "integration_statuses"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "permission_sets_integrationId_key" ON "permission_sets"("integrationId");

-- CreateIndex
CREATE INDEX "sync_history_integrationId_idx" ON "sync_history"("integrationId");

-- CreateIndex
CREATE INDEX "sync_history_createdAt_idx" ON "sync_history"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "integration_statuses" ADD CONSTRAINT "integration_statuses_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_sets" ADD CONSTRAINT "permission_sets_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_history" ADD CONSTRAINT "sync_history_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
