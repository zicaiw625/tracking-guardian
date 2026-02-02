#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_FILE = path.join(__dirname, "..", "shopify.app.toml.template");
const OUTPUT_FILE = path.join(__dirname, "..", "shopify.app.toml");
const PLACEHOLDER = "__SHOPIFY_APP_URL__";

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key in process.env) continue;
    process.env[key] = val;
  }
}

function buildShopifyConfig() {
  loadEnv();
  const appUrl = process.env.SHOPIFY_APP_URL || process.env.APPLICATION_URL || "https://tracking-guardian.onrender.com";
  const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true" || process.env.RENDER === "true";
  
  if (!appUrl) {
    if (isCI) {
      console.error("❌ SHOPIFY_APP_URL or APPLICATION_URL is required in CI/CD environment!");
      console.error("   Please set SHOPIFY_APP_URL environment variable to your app's URL.");
      console.error("   Example: SHOPIFY_APP_URL=https://your-app.onrender.com");
      process.exit(1);
    }
    console.log("⚠️  SHOPIFY_APP_URL not set, using default production URL");
    console.log("   Note: In production, always set SHOPIFY_APP_URL to avoid configuration issues.");
    return;
  }

  try {
    const url = new URL(appUrl);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      console.log("⚠️  WARNING: Using localhost URL. This may not work in production!");
    }
    const isDev = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.includes(".myshopify.dev") || /-(dev|staging|test)\./i.test(url.hostname);
    if (!isDev && url.protocol !== "https:") {
      console.error(`❌ Production SHOPIFY_APP_URL must use HTTPS protocol: ${appUrl}`);
      console.error("   Please provide a valid HTTPS URL (e.g., https://your-app.onrender.com)");
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Invalid SHOPIFY_APP_URL: ${appUrl}`);
    console.error("   Please provide a valid URL (e.g., https://your-app.onrender.com)");
    if (error instanceof Error) {
      console.error(`   Error: ${error.message}`);
    }
    process.exit(1);
  }

  if (!fs.existsSync(TEMPLATE_FILE)) {
    console.error(`❌ Template file not found: ${TEMPLATE_FILE}`);
    console.error("   Please ensure shopify.app.toml.template exists in the project root.");
    process.exit(1);
  }

  try {
    const templateContent = fs.readFileSync(TEMPLATE_FILE, "utf-8");
    const outputContent = templateContent.replace(new RegExp(PLACEHOLDER, "g"), appUrl);
    
    fs.writeFileSync(OUTPUT_FILE, outputContent, "utf-8");
    console.log(`✅ Successfully generated shopify.app.toml from template`);
    console.log(`   Application URL: ${appUrl}`);
  } catch (error) {
    console.error(`❌ Failed to generate shopify.app.toml: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function restoreTemplate() {
  if (!fs.existsSync(OUTPUT_FILE)) {
    console.log("ℹ️  shopify.app.toml not found, nothing to restore.");
    return;
  }

  try {
    const currentContent = fs.readFileSync(OUTPUT_FILE, "utf-8");
    const defaultUrl = "https://tracking-guardian.onrender.com";
    const restoredContent = currentContent.replace(new RegExp(defaultUrl, "g"), PLACEHOLDER);
    
    if (restoredContent === currentContent) {
      console.log("ℹ️  shopify.app.toml does not contain default URL, skipping restore.");
      return;
    }
    
    fs.writeFileSync(OUTPUT_FILE, restoredContent, "utf-8");
    console.log(`✅ Restored placeholder in shopify.app.toml`);
  } catch (error) {
    console.error(`❌ Failed to restore shopify.app.toml: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const command = process.argv[2];
switch (command) {
  case "build":
    buildShopifyConfig();
    break;
  case "restore":
    restoreTemplate();
    break;
  default:
    console.log(`
Shopify Config Builder
Usage:
  node scripts/build-shopify-config.mjs build   - Generate shopify.app.toml from template
  node scripts/build-shopify-config.mjs restore - Restore placeholder in shopify.app.toml
Environment Variables:
  SHOPIFY_APP_URL or APPLICATION_URL  - The application URL to use (required for build command)
Example:
  SHOPIFY_APP_URL=https://your-app.onrender.com node scripts/build-shopify-config.mjs build
`);
}
