-- CreateTable
CREATE TABLE "RegistroAcao" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "acao" TEXT NOT NULL,
    "detalhe" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistroAcao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistroAcao_createdAt_idx" ON "RegistroAcao"("createdAt");
