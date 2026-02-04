#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..");
const VERSION_PATTERN = /^\d{4}-\d{2}$/;

function extractTomlApiVersion(filePath) {
  const fullPath = path.join(PROJECT_ROOT, filePath);
  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^api_version\s*=\s*"([^"]+)"/);
      if (match) {
        return {
          file: filePath,
          version: match[1],
          line: i + 1,
        };
      }
    }
    return { file: filePath, version: null };
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return { file: filePath, version: null };
  }
}

function extractServerApiVersion(filePath) {
  const fullPath = path.join(PROJECT_ROOT, filePath);
  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/apiVersion:\s*ApiVersion\.(\w+)/);
      if (match) {
        const enumValue = match[1];
        const version = convertEnumToVersion(enumValue);
        return {
          file: filePath,
          version,
          line: i + 1,
        };
      }
    }
    return { file: filePath, version: null };
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return { file: filePath, version: null };
  }
}

function convertEnumToVersion(enumValue) {
  const match = enumValue.match(/^(\w+)(\d{2})$/);
  if (!match) return null;
  const [, month, year] = match;
  const monthMap = {
    January: "01",
    February: "02",
    March: "03",
    April: "04",
    May: "05",
    June: "06",
    July: "07",
    August: "08",
    September: "09",
    October: "10",
    November: "11",
    December: "12",
  };
  const monthNum = monthMap[month];
  if (!monthNum) return null;
  return `20${year}-${monthNum}`;
}

const RELEASE_SCHEDULE_URL =
  "https://shopify.dev/docs/api/admin-graphql/latest";

function checkVersionAge(version) {
  const match = version.match(/^(\d{4})-(\d{2})$/);
  if (!match) return;
  const [, year, month] = match;
  const versionDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1);
  const now = new Date();
  const monthsOld =
    (now.getFullYear() - versionDate.getFullYear()) * 12 +
    (now.getMonth() - versionDate.getMonth());
  if (monthsOld >= 9) {
    [
      `⚠️  Warning: API version ${version} is ${monthsOld} months old.`,
      "   Consider upgrading to a newer version before it's deprecated.",
      `   Check: ${RELEASE_SCHEDULE_URL}`,
    ].forEach((message) => console.warn(message));
  } else if (monthsOld >= 6) {
    [
      `ℹ️  Note: API version ${version} is ${monthsOld} months old.`,
      "   Plan to upgrade within the next quarter.",
    ].forEach((message) => console.log(message));
  }
}

function main() {
  console.log("🔍 Checking Shopify API version consistency...\n");
  const sources = [
    extractTomlApiVersion("shopify.app.toml"),
    extractTomlApiVersion("shopify.app.toml.template"),
    extractServerApiVersion("app/services/shopify/app-config.server.ts"),
    extractTomlApiVersion("extensions/tracking-pixel/shopify.extension.toml"),
    // extractTomlApiVersion("extensions/post-checkout-badge/shopify.extension.toml"), // Allow different version for UI extension (React compatibility)
  ];
  const hasReadErrors = sources.some((source) => source.version === null);
  if (hasReadErrors) {
    console.error("❌ Could not read version from some files:");
    sources
      .filter((source) => source.version === null)
      .forEach((source) => {
        console.error(`   - ${source.file}`);
      });
    return 2;
  }
  console.log("📋 Found versions:");
  sources.forEach((source) => {
    console.log(`   ${source.file}:${source.line} → ${source.version}`);
  });
  console.log("");
  const versions = new Set(sources.map((source) => source.version));
  if (versions.size === 1) {
    const version = sources[0].version;
    console.log(`✅ All files use API version: ${version}`);
    if (!version || !VERSION_PATTERN.test(version)) {
      console.warn(
        `⚠️  Warning: Version format "${version}" doesn't match expected YYYY-MM pattern`,
      );
    }
    if (version) {
      checkVersionAge(version);
    }
    return 0;
  }
  console.error("❌ API version mismatch detected!");
  console.error("");
  console.error("   All Shopify API versions must be identical across:");
  console.error("   - shopify.app.toml [webhooks] api_version");
  console.error("   - app/services/shopify/app-config.server.ts apiVersion");
  console.error("   - extensions/tracking-pixel/shopify.extension.toml api_version");
  console.error("   - extensions/post-checkout-badge/shopify.extension.toml api_version");
  console.error("");
  console.error("   Found different versions:");
  sources.forEach((source) => {
    console.error(`   - ${source.file}: ${source.version}`);
  });
  console.error("");
  console.error("   Fix: Update all files to use the same version.");
  return 1;
}

process.exit(main());
