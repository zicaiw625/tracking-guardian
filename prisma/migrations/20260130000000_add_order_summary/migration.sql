CREATE TABLE "OrderSummary" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderSummary_shopId_orderId_key" ON "OrderSummary"("shopId", "orderId");

CREATE INDEX "OrderSummary_shopId_idx" ON "OrderSummary"("shopId");

CREATE INDEX "OrderSummary_shopId_orderId_idx" ON "OrderSummary"("shopId", "orderId");

ALTER TABLE "OrderSummary" ADD CONSTRAINT "OrderSummary_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
