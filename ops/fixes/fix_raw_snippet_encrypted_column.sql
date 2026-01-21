



ALTER TABLE "AuditAsset" ADD COLUMN IF NOT EXISTS "rawSnippetEncrypted" TEXT;


SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'AuditAsset'
    AND column_name = 'rawSnippetEncrypted';
