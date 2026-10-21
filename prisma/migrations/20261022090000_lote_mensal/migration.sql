-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "diasAgenda" INTEGER,
ADD COLUMN     "loteId" TEXT,
ADD COLUMN     "seuNumero" TEXT;

-- CreateTable
CREATE TABLE "LoteMensal" (
    "id" TEXT NOT NULL,
    "mes" TEXT NOT NULL,
    "nomeArquivo" TEXT,
    "diasAntes" INTEGER NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "envioAutomatico" BOOLEAN NOT NULL DEFAULT true,
    "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoteMensal_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteMensal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
