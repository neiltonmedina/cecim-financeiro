-- CreateTable
CREATE TABLE "DisparoAgendado" (
    "id" TEXT NOT NULL,
    "chargeIds" TEXT[],
    "intervalDays" INTEGER NOT NULL,
    "executarEm" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGENDADO',
    "resultado" TEXT,
    "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executadoEm" TIMESTAMP(3),

    CONSTRAINT "DisparoAgendado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisparoAgendado_status_executarEm_idx" ON "DisparoAgendado"("status", "executarEm");
