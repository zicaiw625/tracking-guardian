-- 添加 settingsEncrypted 字段到 UiExtensionSetting 表
-- P0-8: 支持加密存储 UI 扩展设置
-- 
-- 这个迁移解决了以下错误：
-- The column `UiExtensionSetting.settingsEncrypted` does not exist in the current database.

ALTER TABLE "UiExtensionSetting" ADD COLUMN IF NOT EXISTS "settingsEncrypted" TEXT;

