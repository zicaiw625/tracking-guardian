#!/usr/bin/env node --experimental-strip-types
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true" || process.env.RENDER === "true";

    if (!backendUrl) {
        if (isCI) {
            console.error("❌ SHOPIFY_APP_URL is required in CI/CD environment!");
            console.error("   Please set SHOPIFY_APP_URL environment variable to your app's URL.");
            console.error("   Example: SHOPIFY_APP_URL=https:
            process.exit(1);
        }
        console.log("⚠️  SHOPIFY_APP_URL not set, using default production URL");
        console.log("   Note: In production, always set SHOPIFY_APP_URL to avoid misdirected events.");
        return;
    }

    try {
        const url = new URL(backendUrl);

        if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
            console.log("⚠️  WARNING: Using localhost URL. Pixel events will not work in production!");
        }
    }
    catch {
        console.error(`❌ Invalid SHOPIFY_APP_URL: ${backendUrl}`);
        console.error("   Please provide a valid URL (e.g., https:
        process.exit(1);
    }

    const config = readConfig();
    if (!config.includes(PLACEHOLDER)) {
        console.log("⚠️  Placeholder not found in config. Already replaced or config modified.");
        return;
    }
    const updatedConfig = config.replace(`const BUILD_TIME_URL = "${PLACEHOLDER}";`, `const BUILD_TIME_URL = "${backendUrl}";`);
    writeConfig(updatedConfig);
    console.log(`✅ Injected BACKEND_URL: ${backendUrl}`);
}

function restorePlaceholder(): void {
    const config = readConfig();
    const urlPattern = /const BUILD_TIME_URL = "([^"]+)";/;
    const match = config.match(urlPattern);
    if (match && match[1] !== PLACEHOLDER) {
        const updatedConfig = config.replace(urlPattern, `const BUILD_TIME_URL = "${PLACEHOLDER}";`);
        writeConfig(updatedConfig);
        console.log(`✅ Restored placeholder (was: ${match[1]})`);
    }
    else {
        console.log("ℹ️  Placeholder already in place, nothing to restore");
    }
}

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
  node --experimental-strip-types scripts/build-extensions.ts inject   - Replace placeholder with SHOPIFY_APP_URL
  node --experimental-strip-types scripts/build-extensions.ts restore  - Restore placeholder for version control

Environment Variables:
  SHOPIFY_APP_URL  - The backend URL to inject (required for inject command)

Example:
  SHOPIFY_APP_URL=https:
  npm run deploy  # Shopify CLI builds extensions
  npm run ext:restore
`);
}
