-- AlterTable
ALTER TABLE "users" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "notifications"
    ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'medium',
    ADD COLUMN "kind" TEXT,
    ADD COLUMN "metadata" JSONB;

-- CreateIndex
CREATE INDEX "notifications_userId_priority_idx" ON "notifications"("userId", "priority");

-- CreateIndex
CREATE INDEX "notifications_kind_idx" ON "notifications"("kind");
