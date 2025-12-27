-- Add AppliedRecipe model for migration recipe tracking
CREATE TABLE IF NOT EXISTS "AppliedRecipe" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "recipeVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "config" JSONB,
    "completedSteps" JSONB,
    "validationResults" JSONB,
    "sourceIdentifier" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AppliedRecipe_pkey" PRIMARY KEY ("id")
);

-- Add ShopGroup model for agency multi-shop management
CREATE TABLE IF NOT EXISTS "ShopGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopGroup_pkey" PRIMARY KEY ("id")
);

-- Add ShopGroupMember model for shop group membership
CREATE TABLE IF NOT EXISTS "ShopGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "canEditSettings" BOOLEAN NOT NULL DEFAULT false,
    "canViewReports" BOOLEAN NOT NULL DEFAULT true,
    "canManageBilling" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopGroupMember_pkey" PRIMARY KEY ("id")
);

-- Add PlatformEnvironment model for multi-environment support
CREATE TABLE IF NOT EXISTS "PlatformEnvironment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "credentialsEncrypted" TEXT,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformEnvironment_pkey" PRIMARY KEY ("id")
);

-- Create indexes for AppliedRecipe
CREATE INDEX IF NOT EXISTS "AppliedRecipe_shopId_idx" ON "AppliedRecipe"("shopId");
CREATE INDEX IF NOT EXISTS "AppliedRecipe_recipeId_idx" ON "AppliedRecipe"("recipeId");
CREATE INDEX IF NOT EXISTS "AppliedRecipe_status_idx" ON "AppliedRecipe"("status");
CREATE INDEX IF NOT EXISTS "AppliedRecipe_shopId_status_idx" ON "AppliedRecipe"("shopId", "status");

-- Create indexes for ShopGroup
CREATE INDEX IF NOT EXISTS "ShopGroup_ownerId_idx" ON "ShopGroup"("ownerId");

-- Create indexes and unique constraint for ShopGroupMember
CREATE UNIQUE INDEX IF NOT EXISTS "ShopGroupMember_groupId_shopId_key" ON "ShopGroupMember"("groupId", "shopId");
CREATE INDEX IF NOT EXISTS "ShopGroupMember_groupId_idx" ON "ShopGroupMember"("groupId");
CREATE INDEX IF NOT EXISTS "ShopGroupMember_shopId_idx" ON "ShopGroupMember"("shopId");

-- Create indexes and unique constraint for PlatformEnvironment
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformEnvironment_shopId_platform_environment_key" ON "PlatformEnvironment"("shopId", "platform", "environment");
CREATE INDEX IF NOT EXISTS "PlatformEnvironment_shopId_idx" ON "PlatformEnvironment"("shopId");
CREATE INDEX IF NOT EXISTS "PlatformEnvironment_shopId_platform_idx" ON "PlatformEnvironment"("shopId", "platform");

-- Add foreign key for AppliedRecipe
ALTER TABLE "AppliedRecipe" ADD CONSTRAINT "AppliedRecipe_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add foreign key for ShopGroupMember
ALTER TABLE "ShopGroupMember" ADD CONSTRAINT "ShopGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ShopGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

