-- 添加 settingsEncrypted 字段到 UiExtensionSetting 表
-- P0-8: 支持加密存储 UI 扩展设置

ALTER TABLE "UiExtensionSetting" ADD COLUMN IF NOT EXISTS "settingsEncrypted" TEXT;

