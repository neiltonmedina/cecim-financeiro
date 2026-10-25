-- CreateTable
CREATE TABLE "MensagemRecebida" (
    "id" TEXT NOT NULL,
    "de" TEXT NOT NULL,
    "nomePerfil" TEXT,
    "tipo" TEXT NOT NULL,
    "texto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MensagemRecebida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MensagemRecebida_createdAt_idx" ON "MensagemRecebida"("createdAt");
