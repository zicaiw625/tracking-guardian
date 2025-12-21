import { PrismaClient } from "@prisma/client";
import { encryptJson } from "../app/utils/crypto";

const prisma = new PrismaClient();

interface MigrationResult {
  total: number;
  migrated: number;
  skipped: number;
  errors: number;
  details: Array<{
    id: string;
    status: "migrated" | "skipped" | "error";
    reason?: string;
  }>;
}

async function migrateAlertSettings(): Promise<MigrationResult> {
  console.log("=== P0-2: Alert Settings Encryption Migration ===\n");
  
  const result: MigrationResult = {
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  try {
    const alertConfigs = await prisma.alertConfig.findMany({
      where: {
        settingsEncrypted: null,
        settings: { not: null },
      },
      select: {
        id: true,
        channel: true,
        settings: true,
      },
    });

    result.total = alertConfigs.length;
    console.log(`Found ${alertConfigs.length} AlertConfigs to migrate\n`);

    for (const config of alertConfigs) {
      try {
        const settings = config.settings as Record<string, unknown> | null;
        
        if (!settings || Object.keys(settings).length === 0) {
          result.skipped++;
          result.details.push({
            id: config.id,
            status: "skipped",
            reason: "Empty settings",
          });
          continue;
        }

        const sensitiveSettings: Record<string, unknown> = {};
        const nonSensitiveSettings: Record<string, unknown> = {
          channel: config.channel,
        };

        if (config.channel === "slack" && settings.webhookUrl) {
          sensitiveSettings.webhookUrl = settings.webhookUrl;
          nonSensitiveSettings.configured = true;
        } else if (config.channel === "telegram") {
          if (settings.botToken) {
            sensitiveSettings.botToken = settings.botToken;
            nonSensitiveSettings.botTokenMasked = 
              String(settings.botToken).slice(0, 8) + "****";
          }
          if (settings.chatId) {
            sensitiveSettings.chatId = settings.chatId;
            nonSensitiveSettings.chatId = settings.chatId;
          }
        } else if (config.channel === "email" && settings.email) {
          sensitiveSettings.email = settings.email;
          nonSensitiveSettings.emailMasked = 
            String(settings.email).replace(/(.{2}).*(@.*)/, "$1***$2");
        }

        if (Object.keys(sensitiveSettings).length === 0) {
          result.skipped++;
          result.details.push({
            id: config.id,
            status: "skipped",
            reason: "No sensitive settings found",
          });
          continue;
        }

        const encryptedSettings = encryptJson(sensitiveSettings);

        await prisma.alertConfig.update({
          where: { id: config.id },
          data: {
            settingsEncrypted: encryptedSettings,
            settings: nonSensitiveSettings,
          },
        });

        result.migrated++;
        result.details.push({
          id: config.id,
          status: "migrated",
        });

        console.log(`✅ Migrated: ${config.id} (${config.channel})`);
      } catch (error) {
        result.errors++;
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        result.details.push({
          id: config.id,
          status: "error",
          reason: errorMsg,
        });
        console.error(`❌ Error migrating ${config.id}: ${errorMsg}`);
      }
    }
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }

  return result;
}

async function main() {
  if (!process.env.ENCRYPTION_SECRET && process.env.NODE_ENV === "production") {
    console.error("❌ ENCRYPTION_SECRET must be set for migration");
    process.exit(1);
  }

  try {
    const result = await migrateAlertSettings();

    console.log("\n=== Migration Summary ===");
    console.log(`Total:    ${result.total}`);
    console.log(`Migrated: ${result.migrated}`);
    console.log(`Skipped:  ${result.skipped}`);
    console.log(`Errors:   ${result.errors}`);

    if (result.errors > 0) {
      console.log("\n❌ Migration completed with errors");
      process.exit(1);
    } else {
      console.log("\n✅ Migration completed successfully");
      process.exit(0);
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
