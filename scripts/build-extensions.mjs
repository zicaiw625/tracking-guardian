#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SHARED_CONFIG_FILE = path.join(__dirname, "../extensions/shared/config.ts");
const PLACEHOLDER = "__BACKEND_URL_PLACEHOLDER__";
const BUILD_TIME_URL_PATTERN = /const\s+BUILD_TIME_URL\s*=\s*(["'])([^"']+)\1;/;

function readConfig(filePath) {
    return fs.readFileSync(filePath, "utf-8");
}

function writeConfig(filePath, content) {
    fs.writeFileSync(filePath, content, "utf-8");
}

function replaceBuildTimeUrl(content, nextValue, allowOverride = false) {
    const match = content.match(BUILD_TIME_URL_PATTERN);
    if (!match) {
        return { updated: false, reason: "pattern_not_found" };
    }
    const [, quote, currentValue] = match;
    if (!allowOverride && currentValue !== PLACEHOLDER) {
        return { updated: false, reason: "placeholder_missing", currentValue };
    }
    if (currentValue === nextValue) {
        return { updated: false, reason: "already_set" };
    }
    return {
        updated: true,
        nextContent: content.replace(BUILD_TIME_URL_PATTERN, `const BUILD_TIME_URL = ${quote}${nextValue}${quote};`),
        previousValue: currentValue,
    };
}

function restoreBuildTimeUrl(content) {
    const match = content.match(BUILD_TIME_URL_PATTERN);
    if (!match || match[2] === PLACEHOLDER) {
        return { updated: false };
    }
    const [, quote, previousValue] = match;
    return {
        updated: true,
        nextContent: content.replace(BUILD_TIME_URL_PATTERN, `const BUILD_TIME_URL = ${quote}${PLACEHOLDER}${quote};`),
        previousValue,
    };
}

function processConfigFiles(targets, handler) {
    let updatedCount = 0;
    targets.forEach(({ path: filePath, label, required }) => {
        if (!fs.existsSync(filePath)) {
            const prefix = required ? "❌" : "⚠️ ";
            console[required ? "error" : "log"](`${prefix} ${label} not found: ${filePath}${required ? "" : ", skipping."}`);
            if (required) process.exit(1);
            return;
        }
        try {
            const content = readConfig(filePath);
            const result = handler(content);
            if (result.updated) {
                writeConfig(filePath, result.nextContent);
                console.log(`✅ ${label} updated (${result.previousValue ?? "placeholder"} -> ${result.nextValue ?? PLACEHOLDER})`);
                updatedCount++;
            } else {
                const reason = result.reason === "placeholder_missing"
                    ? `no placeholder (current value: ${result.currentValue ?? "unknown"})`
                    : result.reason === "pattern_not_found"
                        ? "BUILD_TIME_URL assignment not found"
                        : "already up to date";
                console.log(`ℹ️  Skipped ${label}: ${reason}`);
            }
        } catch (error) {
            console.error(`❌ Failed to process ${label}: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        }
    });
    return updatedCount;
}

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
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        if (key in process.env) continue;
        process.env[key] = val;
    }
}

function resolveBackendUrl() {
    const candidates = [
        process.env.RENDER_EXTERNAL_URL,
        process.env.PUBLIC_APP_URL,
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            const url = new URL(candidate);
            if (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
                return candidate;
            }
        } catch {
        }
    }
    return null;
}

function injectBackendUrl() {
    loadEnv();
    let backendUrl = process.env.SHOPIFY_APP_URL || resolveBackendUrl() || "https://tracking-guardian.onrender.com";
    const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true" || process.env.RENDER === "true";
    if (!backendUrl) {
        if (isCI) {
            console.error("❌ No valid backend URL found. Set SHOPIFY_APP_URL, RENDER_EXTERNAL_URL, or PUBLIC_APP_URL.");
            console.error("   Example: SHOPIFY_APP_URL=https://your-app.onrender.com");
            process.exit(1);
        }
        console.log("⚠️  SHOPIFY_APP_URL not set, no fallback URL available. Skipping injection.");
        return;
    }
    try {
        const url = new URL(backendUrl);
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
            console.log("⚠️  WARNING: Using localhost URL. Pixel events will not work in production!");
        }
        const isDev = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.includes(".myshopify.dev") || /-(dev|staging|test)\./i.test(url.hostname);
        if (!isDev && url.protocol !== "https:") {
            console.error(`❌ Production BACKEND_URL must use HTTPS protocol: ${backendUrl}`);
            console.error("   Please provide a valid HTTPS URL (e.g., https://your-app.onrender.com)");
            process.exit(1);
        }
    } catch (error) {
        console.error(`❌ Invalid SHOPIFY_APP_URL: ${backendUrl}`);
        console.error("   Please provide a valid URL (e.g., https://your-app.onrender.com)");
        if (error instanceof Error) {
            console.error(`   Error: ${error.message}`);
        }
        process.exit(1);
    }
    const updatedCount = processConfigFiles(
        [
            { path: SHARED_CONFIG_FILE, label: "Shared config (extensions/shared/config.ts)", required: true },
        ],
        (content) => {
            const result = replaceBuildTimeUrl(content, backendUrl);
            return result.updated
                ? { ...result, nextValue: backendUrl }
                : result;
        },
    );
    if (updatedCount === 0) {
        console.warn("⚠️  No placeholders were replaced. Please check that config files contain the placeholder.");
        if (isCI) {
            console.error("❌ In CI/CD environment, URL injection is required!");
            console.error("   This is a critical error that will cause pixel events to fail.");
            console.error("   Please ensure the build process runs 'pnpm ext:inject' or equivalent.");
            process.exit(1);
        }
    } else {
        console.log(`✅ Successfully injected BACKEND_URL to ${updatedCount} config file(s)`);
        console.log(`   Backend URL: ${backendUrl}`);
        console.log(`   ⚠️  IMPORTANT: Ensure this URL is added to Web Pixel Extension allowlist in Partner Dashboard`);
        console.log(`   ⚠️  IMPORTANT: If placeholder is not replaced, pixel events will fail silently`);
    }
}
function restorePlaceholder() {
    const restoredCount = processConfigFiles(
        [
            { path: SHARED_CONFIG_FILE, label: "Shared config (extensions/shared/config.ts)", required: true },
        ],
        (content) => restoreBuildTimeUrl(content),
    );
    if (restoredCount === 0) {
        console.log("ℹ️  No placeholders were restored (files may already contain the placeholder).");
    } else {
        console.log(`✅ Restored placeholder in ${restoredCount} config file(s)`);
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
  node scripts/build-extensions.mjs inject   - Replace placeholder with backend URL
  node scripts/build-extensions.mjs restore  - Restore placeholder for version control
Environment Variables (inject uses first available):
  SHOPIFY_APP_URL  - Preferred backend URL
  RENDER_EXTERNAL_URL  - Fallback on Render (auto-set for web services)
  PUBLIC_APP_URL  - Fallback
Example:
  SHOPIFY_APP_URL=https://your-app.onrender.com
  npm run deploy
  npm run ext:restore
`);
}
