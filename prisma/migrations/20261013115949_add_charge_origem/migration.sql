-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "origem" TEXT NOT NULL DEFAULT 'PAINEL';

-- Cobranças importadas do Inter antes deste campo existir: criadas pela
-- importação (sem usuário) com a descrição padrão "Mensalidade MM/AAAA".
UPDATE "Charge" SET "origem" = 'INTER'
WHERE "createdBy" IS NULL AND "description" ~ '^Mensalidade [0-9]{2}/[0-9]{4}$';
