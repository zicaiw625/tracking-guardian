-- CreateTable
CREATE TABLE "MigrationTask" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "assetId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedToShopId" TEXT,
    "assignedByShopId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorShopId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isSystemMessage" BOOLEAN NOT NULL DEFAULT false,
    "parentCommentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceComment" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "authorShopId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "groupId" TEXT,
    "parentCommentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationTask_shopId_idx" ON "MigrationTask"("shopId");

-- CreateIndex
CREATE INDEX "MigrationTask_assetId_idx" ON "MigrationTask"("assetId");

-- CreateIndex
CREATE INDEX "MigrationTask_assignedToShopId_idx" ON "MigrationTask"("assignedToShopId");

-- CreateIndex
CREATE INDEX "MigrationTask_groupId_idx" ON "MigrationTask"("groupId");

-- CreateIndex
CREATE INDEX "MigrationTask_status_idx" ON "MigrationTask"("status");

-- CreateIndex
CREATE INDEX "TaskComment_taskId_idx" ON "TaskComment"("taskId");

-- CreateIndex
CREATE INDEX "TaskComment_authorShopId_idx" ON "TaskComment"("authorShopId");

-- CreateIndex
CREATE INDEX "TaskComment_parentCommentId_idx" ON "TaskComment"("parentCommentId");

-- CreateIndex
CREATE INDEX "WorkspaceComment_targetType_targetId_idx" ON "WorkspaceComment"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "WorkspaceComment_authorShopId_idx" ON "WorkspaceComment"("authorShopId");

-- CreateIndex
CREATE INDEX "WorkspaceComment_groupId_idx" ON "WorkspaceComment"("groupId");

-- CreateIndex
CREATE INDEX "WorkspaceComment_parentCommentId_idx" ON "WorkspaceComment"("parentCommentId");

-- AddForeignKey
ALTER TABLE "MigrationTask" ADD CONSTRAINT "MigrationTask_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationTask" ADD CONSTRAINT "MigrationTask_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AuditAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationTask" ADD CONSTRAINT "MigrationTask_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ShopGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MigrationTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "TaskComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceComment" ADD CONSTRAINT "WorkspaceComment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ShopGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceComment" ADD CONSTRAINT "WorkspaceComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "WorkspaceComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

