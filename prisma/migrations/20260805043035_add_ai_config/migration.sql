-- CreateTable
CREATE TABLE "ai_config" (
    "id" TEXT NOT NULL,
    "providerId" TEXT,
    "model" TEXT,
    "apiKey" TEXT,
    "lastStatus" TEXT,
    "lastMessage" TEXT,
    "lastLatencyMs" INTEGER,
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_config_pkey" PRIMARY KEY ("id")
);
