-- Add OAuth token rotation and revocation tracking to integrations.
ALTER TABLE "integrations"
  ADD COLUMN "refreshTokenHash" TEXT,
  ADD COLUMN "lastRefreshedAt" TIMESTAMP(3),
  ADD COLUMN "refreshCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedReason" TEXT;
