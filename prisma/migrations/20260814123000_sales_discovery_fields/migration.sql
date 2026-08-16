-- AlterTable: add discovery and normalization fields to opportunities
ALTER TABLE "opportunities"
    ADD COLUMN "companyWebsite" TEXT,
    ADD COLUMN "location" TEXT,
    ADD COLUMN "remote" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "compensation" TEXT,
    ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
    ADD COLUMN "employmentType" TEXT,
    ADD COLUMN "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "companySize" TEXT,
    ADD COLUMN "clientName" TEXT,
    ADD COLUMN "clientRole" TEXT,
    ADD COLUMN "postedAt" TIMESTAMP(3),
    ADD COLUMN "deadline" TIMESTAMP(3),
    ADD COLUMN "recurringPotential" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "sourceReliability" TEXT,
    ADD COLUMN "rawContent" TEXT;

-- Deduplication: prevent the same discovered opportunity from being saved twice.
CREATE UNIQUE INDEX "opportunities_userId_source_sourceUrl_key"
    ON "opportunities"("userId", "source", "sourceUrl");
