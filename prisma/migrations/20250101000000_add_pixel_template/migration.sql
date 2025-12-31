

CREATE TABLE "PixelTemplate" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platforms" JSONB NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixelTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PixelTemplate_ownerId_idx" ON "PixelTemplate"("ownerId");

CREATE INDEX "PixelTemplate_isPublic_idx" ON "PixelTemplate"("isPublic");

