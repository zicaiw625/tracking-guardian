-- P0: v1.0 版本移除所有 PCD/PII 相关字段
-- 迁移：remove_pii_fields
-- 日期：2025-01-15
-- 说明：v1.0 版本不包含任何 PCD/PII 处理，因此移除所有相关数据库字段

-- 删除 Shop 表中的 PII 相关字段
DO $$ 
BEGIN
    -- 删除 piiEnabled 字段（如果存在）
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'piiEnabled'
    ) THEN
        ALTER TABLE "Shop" DROP COLUMN "piiEnabled";
        RAISE NOTICE '已删除 Shop.piiEnabled 字段';
    END IF;

    -- 删除 pcdAcknowledged 字段（如果存在）
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'pcdAcknowledged'
    ) THEN
        ALTER TABLE "Shop" DROP COLUMN "pcdAcknowledged";
        RAISE NOTICE '已删除 Shop.pcdAcknowledged 字段';
    END IF;

    -- 删除 pcdAcknowledgedAt 字段（如果存在）
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'pcdAcknowledgedAt'
    ) THEN
        ALTER TABLE "Shop" DROP COLUMN "pcdAcknowledgedAt";
        RAISE NOTICE '已删除 Shop.pcdAcknowledgedAt 字段';
    END IF;

    -- 删除 AuditLog 表中的 ipAddress 字段（如果存在）
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'AuditLog' AND column_name = 'ipAddress'
    ) THEN
        ALTER TABLE "AuditLog" DROP COLUMN "ipAddress";
        RAISE NOTICE '已删除 AuditLog.ipAddress 字段';
    END IF;

    -- 删除 AuditLog 表中的 userAgent 字段（如果存在）
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'AuditLog' AND column_name = 'userAgent'
    ) THEN
        ALTER TABLE "AuditLog" DROP COLUMN "userAgent";
        RAISE NOTICE '已删除 AuditLog.userAgent 字段';
    END IF;
END $$;

