-- Add settings column to Shop table if it doesn't exist
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "settings" JSONB;

