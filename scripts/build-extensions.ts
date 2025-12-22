#!/usr/bin/env npx ts-node

import * as fs from "fs";
import * as path from "path";

const CONFIG_FILE = path.join(__dirname, "../extensions/shared/config.ts");
const PLACEHOLDER = "__BACKEND_URL_PLACEHOLDER__";

function readConfig(): string {
  return fs.readFileSync(CONFIG_FILE, "utf-8");
}

function writeConfig(content: string): void {
  fs.writeFileSync(CONFIG_FILE, content, "utf-8");
}

function injectBackendUrl(): void {
  const backendUrl = process.env.SHOPIFY_APP_URL;
  
  if (!backendUrl) {
    console.log("⚠️  SHOPIFY_APP_URL not set, using default production URL");
    return;
  }
  
  try {
    new URL(backendUrl);
  } catch {
    console.error(`❌ Invalid SHOPIFY_APP_URL: ${backendUrl}`);
    process.exit(1);
  }
  
  const config = readConfig();
  
  if (!config.includes(PLACEHOLDER)) {
    console.log("⚠️  Placeholder not found in config. Already replaced or config modified.");
    return;
  }
  
  const updatedConfig = config.replace(
    `const BUILD_TIME_URL = "${PLACEHOLDER}";`,
    `const BUILD_TIME_URL = "${backendUrl}";`
  );
  
  writeConfig(updatedConfig);
  console.log(`✅ Injected BACKEND_URL: ${backendUrl}`);
}

function restorePlaceholder(): void {
  const config = readConfig();
  
  const urlPattern = /const BUILD_TIME_URL = "([^"]+)";/;
  const match = config.match(urlPattern);
  
  if (match && match[1] !== PLACEHOLDER) {
    const updatedConfig = config.replace(
      urlPattern,
      `const BUILD_TIME_URL = "${PLACEHOLDER}";`
    );
    
    writeConfig(updatedConfig);
    console.log(`✅ Restored placeholder (was: ${match[1]})`);
  } else {
    console.log("ℹ️  Placeholder already in place, nothing to restore");
  }
}

// CLI handling
const command = process.argv[2];

switch (command) {
  case "inject":
    injectBackendUrl();
    break;
  case "restore":
    restorePlaceholder();
    break;
  default:
    console.log(`
Extension Build Helper

Usage:
  npx ts-node scripts/build-extensions.ts inject   - Replace placeholder with SHOPIFY_APP_URL
  npx ts-node scripts/build-extensions.ts restore  - Restore placeholder for version control

Environment Variables:
  SHOPIFY_APP_URL  - The backend URL to inject (required for inject command)

Example:
  SHOPIFY_APP_URL=https://tracking-guardian.onrender.com npx ts-node scripts/build-extensions.ts inject
  npm run deploy  # Shopify CLI builds extensions
  npx ts-node scripts/build-extensions.ts restore
`);
}
