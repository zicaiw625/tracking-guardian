-- 修复 AuditAsset.rawSnippetEncrypted 列缺失问题
-- 执行方式: psql $DATABASE_URL -f fix_raw_snippet_encrypted_column.sql

-- 添加缺失的列
ALTER TABLE "AuditAsset" ADD COLUMN IF NOT EXISTS "rawSnippetEncrypted" TEXT;

-- 验证列是否添加成功
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'AuditAsset'
    AND column_name = 'rawSnippetEncrypted';
