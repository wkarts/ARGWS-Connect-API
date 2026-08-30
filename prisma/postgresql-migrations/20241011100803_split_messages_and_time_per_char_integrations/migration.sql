-- AlterTable
ALTER TABLE "Dify" ADD COLUMN     "splitMessages" BOOLEAN DEFAULT false,
ADD COLUMN     "timePerChar" INTEGER DEFAULT 50;

-- AlterTable
ALTER TABLE "DifySetting" ADD COLUMN     "splitMessages" BOOLEAN DEFAULT false,
ADD COLUMN     "timePerChar" INTEGER DEFAULT 50;

-- AlterTable
ALTER TABLE "ConnectBot" ADD COLUMN     "splitMessages" BOOLEAN DEFAULT false,
ADD COLUMN     "timePerChar" INTEGER DEFAULT 50;

-- AlterTable
ALTER TABLE "ConnectBotSetting" ADD COLUMN     "splitMessages" BOOLEAN DEFAULT false,
ADD COLUMN     "timePerChar" INTEGER DEFAULT 50;

-- AlterTable
ALTER TABLE "Flowise" ADD COLUMN     "splitMessages" BOOLEAN DEFAULT false,
ADD COLUMN     "timePerChar" INTEGER DEFAULT 50;

-- AlterTable
ALTER TABLE "FlowiseSetting" ADD COLUMN     "splitMessages" BOOLEAN DEFAULT false,
ADD COLUMN     "timePerChar" INTEGER DEFAULT 50;

-- AlterTable
ALTER TABLE "OpenaiBot" ADD COLUMN     "splitMessages" BOOLEAN DEFAULT false,
ADD COLUMN     "timePerChar" INTEGER DEFAULT 50;

-- AlterTable
ALTER TABLE "OpenaiSetting" ADD COLUMN     "splitMessages" BOOLEAN DEFAULT false,
ADD COLUMN     "timePerChar" INTEGER DEFAULT 50;
