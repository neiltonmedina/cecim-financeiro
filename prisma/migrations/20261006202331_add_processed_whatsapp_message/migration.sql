-- CreateTable
CREATE TABLE "ProcessedWhatsAppMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWhatsAppMessage_pkey" PRIMARY KEY ("id")
);
