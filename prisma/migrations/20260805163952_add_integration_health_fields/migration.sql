-- DropIndex
DROP INDEX "integrations_userId_idx";

-- AlterTable
ALTER TABLE "integration_statuses" ADD COLUMN     "apiStatus" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "quota" JSONB;
