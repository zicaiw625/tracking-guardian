

DO $$
BEGIN

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Shop' AND column_name = 'piiEnabled'
    ) THEN
        ALTER TABLE "Shop" DROP COLUMN "piiEnabled";
        RAISE NOTICE '已删除 Shop.piiEnabled 字段';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Shop' AND column_name = 'pcdAcknowledged'
    ) THEN
        ALTER TABLE "Shop" DROP COLUMN "pcdAcknowledged";
        RAISE NOTICE '已删除 Shop.pcdAcknowledged 字段';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Shop' AND column_name = 'pcdAcknowledgedAt'
    ) THEN
        ALTER TABLE "Shop" DROP COLUMN "pcdAcknowledgedAt";
        RAISE NOTICE '已删除 Shop.pcdAcknowledgedAt 字段';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'AuditLog' AND column_name = 'ipAddress'
    ) THEN
        ALTER TABLE "AuditLog" DROP COLUMN "ipAddress";
        RAISE NOTICE '已删除 AuditLog.ipAddress 字段';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'AuditLog' AND column_name = 'userAgent'
    ) THEN
        ALTER TABLE "AuditLog" DROP COLUMN "userAgent";
        RAISE NOTICE '已删除 AuditLog.userAgent 字段';
    END IF;
END $$;

