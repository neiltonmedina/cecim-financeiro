-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "pendenteBotoes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "providerBotoes" TEXT[] DEFAULT ARRAY[]::TEXT[];
