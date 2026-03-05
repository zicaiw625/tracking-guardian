CREATE TABLE "BillingAttempt" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "confirmationUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BillingAttempt_shopDomain_planId_status_expiresAt_idx"
ON "BillingAttempt"("shopDomain", "planId", "status", "expiresAt");

CREATE INDEX "BillingAttempt_subscriptionId_idx"
ON "BillingAttempt"("subscriptionId");

CREATE INDEX "BillingAttempt_shopId_idx"
ON "BillingAttempt"("shopId");

ALTER TABLE "BillingAttempt"
ADD CONSTRAINT "BillingAttempt_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
