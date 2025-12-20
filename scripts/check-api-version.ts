#!/usr/bin/env npx ts-node
/**
 * P0-4: API Version Consistency Check
 * 
 * This script ensures all Shopify API version declarations are consistent across:
 * 1. shopify.app.toml - [webhooks] api_version
 * 2. shopify.server.ts - apiVersion constant
 * 3. extensions/tracking-pixel/shopify.extension.toml - api_version
 * 
 * Run this in CI to prevent "forgot to update one file" issues.
 * 
 * Usage:
 *   npx ts-node scripts/check-api-version.ts
 *   # or
 *   npm run check:api-version
 * 
 * Exit codes:
 *   0 - All versions match
 *   1 - Version mismatch detected
 *   2 - File read error
 */

import * as fs from "fs";
import * as path from "path";

interface VersionSource {
  file: string;
  version: string | null;
  line?: number;
}

const PROJECT_ROOT = path.resolve(__dirname, "..");

// Expected version format: "2025-07" (YYYY-MM)
const VERSION_PATTERN = /^\d{4}-\d{2}$/;

function extractTomlApiVersion(filePath: string): VersionSource {
  const fullPath = path.join(PROJECT_ROOT, filePath);
  
  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match: api_version = "2025-07"
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

function extractServerApiVersion(filePath: string): VersionSource {
  const fullPath = path.join(PROJECT_ROOT, filePath);
  
  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match: apiVersion: ApiVersion.July25
      // The enum format is MonthYear (e.g., July25 = 2025-07)
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

/**
 * Convert Shopify API version enum to string format
 * e.g., "July25" -> "2025-07"
 */
function convertEnumToVersion(enumValue: string): string | null {
  // Pattern: MonthYear (e.g., July25, October24, January26)
  const match = enumValue.match(/^(\w+)(\d{2})$/);
  if (!match) return null;
  
  const [, month, year] = match;
  const monthMap: Record<string, string> = {
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
  
  // Assume 20XX for 2-digit years
  const fullYear = `20${year}`;
  
  return `${fullYear}-${monthNum}`;
}

function main(): number {
  console.log("🔍 Checking Shopify API version consistency...\n");
  
  const sources: VersionSource[] = [
    extractTomlApiVersion("shopify.app.toml"),
    extractServerApiVersion("app/shopify.server.ts"),
    extractTomlApiVersion("extensions/tracking-pixel/shopify.extension.toml"),
  ];
  
  // Check for read errors
  const hasReadErrors = sources.some(s => s.version === null);
  if (hasReadErrors) {
    console.error("❌ Could not read version from some files:");
    sources.filter(s => s.version === null).forEach(s => {
      console.error(`   - ${s.file}`);
    });
    return 2;
  }
  
  // Print all versions
  console.log("📋 Found versions:");
  sources.forEach(s => {
    console.log(`   ${s.file}:${s.line} → ${s.version}`);
  });
  console.log("");
  
  // Check consistency
  const versions = new Set(sources.map(s => s.version));
  
  if (versions.size === 1) {
    const version = sources[0].version;
    console.log(`✅ All files use API version: ${version}`);
    
    // Validate version format
    if (!VERSION_PATTERN.test(version!)) {
      console.warn(`⚠️  Warning: Version format "${version}" doesn't match expected YYYY-MM pattern`);
    }
    
    // Check if version is getting old (warn 6 months before deprecation)
    checkVersionAge(version!);
    
    return 0;
  }
  
  // Mismatch detected
  console.error("❌ API version mismatch detected!");
  console.error("");
  console.error("   All Shopify API versions must be identical across:");
  console.error("   - shopify.app.toml [webhooks] api_version");
  console.error("   - app/shopify.server.ts apiVersion");
  console.error("   - extensions/tracking-pixel/shopify.extension.toml api_version");
  console.error("");
  console.error("   Found different versions:");
  sources.forEach(s => {
    console.error(`   - ${s.file}: ${s.version}`);
  });
  console.error("");
  console.error("   Fix: Update all files to use the same version.");
  
  return 1;
}

function checkVersionAge(version: string): void {
  const match = version.match(/^(\d{4})-(\d{2})$/);
  if (!match) return;
  
  const [, year, month] = match;
  const versionDate = new Date(parseInt(year), parseInt(month) - 1);
  const now = new Date();
  
  // Shopify versions are supported for ~1 year
  // Warn if we're 6+ months into a version
  const monthsOld = (now.getFullYear() - versionDate.getFullYear()) * 12 +
                    (now.getMonth() - versionDate.getMonth());
  
  if (monthsOld >= 9) {
    console.warn(`⚠️  Warning: API version ${version} is ${monthsOld} months old.`);
    console.warn(`   Consider upgrading to a newer version before it's deprecated.`);
    console.warn(`   Check: https://shopify.dev/docs/api/usage/versioning`);
  } else if (monthsOld >= 6) {
    console.log(`ℹ️  Note: API version ${version} is ${monthsOld} months old.`);
    console.log(`   Plan to upgrade within the next quarter.`);
  }
}

process.exit(main());

