ALTER TABLE "Shop"
ADD COLUMN "billingLastSyncedAt" TIMESTAMP(3);

ALTER TABLE "BillingAttempt"
ADD COLUMN "confirmedAt" TIMESTAMP(3);
