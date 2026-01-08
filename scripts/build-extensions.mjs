#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SHARED_CONFIG_FILE = path.join(__dirname, "../extensions/shared/config.ts");
const THANK_YOU_CONFIG_FILE = path.join(__dirname, "../extensions/thank-you-blocks/src/config.ts");
const SHARED_CONFIG_JS_FILE = path.join(__dirname, "../extensions/shared/config.js");
const THANK_YOU_CONFIG_JS_FILE = path.join(__dirname, "../extensions/thank-you-blocks/src/config.js");
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

function injectBackendUrl() {
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
    } catch (error) {
        console.error(`❌ Invalid SHOPIFY_APP_URL: ${backendUrl}`);
        console.error("   Please provide a valid URL (e.g., https:
        if (error instanceof Error) {
            console.error(`   Error: ${error.message}`);
        }
        process.exit(1);
    }

    const updatedCount = processConfigFiles(
        [
            { path: SHARED_CONFIG_FILE, label: "Shared config (extensions/shared/config.ts)", required: true },
            { path: THANK_YOU_CONFIG_FILE, label: "Thank-you blocks config (extensions/thank-you-blocks/src/config.ts)", required: false },
            { path: SHARED_CONFIG_JS_FILE, label: "Shared config.js (compiled)", required: false },
            { path: THANK_YOU_CONFIG_JS_FILE, label: "Thank-you blocks config.js (compiled)", required: false },
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
    } else {
        console.log(`✅ Successfully injected BACKEND_URL to ${updatedCount} config file(s)`);
    }
}

function restorePlaceholder() {
    const restoredCount = processConfigFiles(
        [
            { path: SHARED_CONFIG_FILE, label: "Shared config (extensions/shared/config.ts)", required: true },
            { path: THANK_YOU_CONFIG_FILE, label: "Thank-you blocks config (extensions/thank-you-blocks/src/config.ts)", required: false },
            { path: SHARED_CONFIG_JS_FILE, label: "Shared config.js (compiled)", required: false },
            { path: THANK_YOU_CONFIG_JS_FILE, label: "Thank-you blocks config.js (compiled)", required: false },
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
  node scripts/build-extensions.mjs inject   - Replace placeholder with SHOPIFY_APP_URL
  node scripts/build-extensions.mjs restore  - Restore placeholder for version control

Environment Variables:
  SHOPIFY_APP_URL  - The backend URL to inject (required for inject command)

Example:
  SHOPIFY_APP_URL=https://your-app.onrender.com
  npm run deploy  # Shopify CLI builds extensions
  npm run ext:restore
`);
}
