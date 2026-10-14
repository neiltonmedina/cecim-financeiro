-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "metaMotivo" TEXT,
ADD COLUMN     "metaStatus" TEXT,
ADD COLUMN     "pendenteEnviadoEm" TIMESTAMP(3),
ADD COLUMN     "pendenteNome" TEXT,
ADD COLUMN     "pendenteParams" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "pendenteTexto" TEXT,
ADD COLUMN     "providerParams" TEXT[] DEFAULT ARRAY[]::TEXT[];
