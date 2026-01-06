-- CreateTable
CREATE TABLE "ShopifyOrderSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "totalValue" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "financialStatus" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyOrderSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopifyOrderSnapshot_shopId_createdAt_idx" ON "ShopifyOrderSnapshot"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "ShopifyOrderSnapshot_shopId_orderId_idx" ON "ShopifyOrderSnapshot"("shopId", "orderId");

-- CreateIndex
CREATE INDEX "ShopifyOrderSnapshot_orderId_idx" ON "ShopifyOrderSnapshot"("orderId");

-- CreateIndex
CREATE INDEX "ShopifyOrderSnapshot_cancelledAt_idx" ON "ShopifyOrderSnapshot"("cancelledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOrderSnapshot_shopId_orderId_key" ON "ShopifyOrderSnapshot"("shopId", "orderId");

-- CreateIndex
CREATE INDEX "RefundSnapshot_shopId_createdAt_idx" ON "RefundSnapshot"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "RefundSnapshot_shopId_orderId_idx" ON "RefundSnapshot"("shopId", "orderId");

-- CreateIndex
CREATE INDEX "RefundSnapshot_orderId_idx" ON "RefundSnapshot"("orderId");

-- CreateIndex
CREATE INDEX "RefundSnapshot_refundId_idx" ON "RefundSnapshot"("refundId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundSnapshot_shopId_refundId_key" ON "RefundSnapshot"("shopId", "refundId");

-- AddForeignKey
ALTER TABLE "ShopifyOrderSnapshot" ADD CONSTRAINT "ShopifyOrderSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundSnapshot" ADD CONSTRAINT "RefundSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
