-- CreateEnum
CREATE TYPE "public.OfferStatus" AS ENUM ('DRAFT','SENT','ACCEPTED','DECLINED');

-- CreateTable: offers
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "leadId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "components" JSONB DEFAULT '[]'::jsonb,
    "suggestedPrice" DECIMAL(12,2),
    "minimumPrice" DECIMAL(12,2),
    "targetMargin" INTEGER NOT NULL DEFAULT 30,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "deliveryEstimate" TEXT,
    "validDays" INTEGER NOT NULL DEFAULT 30,
    "status" "public.OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offers_userId_idx" ON "offers"("userId");

-- CreateIndex
CREATE INDEX "offers_opportunityId_idx" ON "offers"("opportunityId");

-- CreateIndex
CREATE INDEX "offers_leadId_idx" ON "offers"("leadId");

-- AddForeignKey
ALTER TABLE "offers"
    ADD CONSTRAINT "offers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers"
    ADD CONSTRAINT "offers_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers"
    ADD CONSTRAINT "offers_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
