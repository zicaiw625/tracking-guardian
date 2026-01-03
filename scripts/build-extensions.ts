#!/usr/bin/env node --experimental-strip-types
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SHARED_CONFIG_FILE = path.join(__dirname, "../extensions/shared/config.ts");
const THANK_YOU_CONFIG_FILE = path.join(__dirname, "../extensions/thank-you-blocks/src/config.ts");
const SHARED_CONFIG_JS_FILE = path.join(__dirname, "../extensions/shared/config.js");
const PLACEHOLDER = "__BACKEND_URL_PLACEHOLDER__";

function readConfig(filePath: string): string {
    return fs.readFileSync(filePath, "utf-8");
}

function writeConfig(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, "utf-8");
}

function injectBackendUrl(): void {
    const backendUrl = process.env.SHOPIFY_APP_URL;

    const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true" || process.env.RENDER === "true";

    if (!backendUrl) {
        if (isCI) {
            console.error("❌ SHOPIFY_APP_URL is required in CI/CD environment!");
            console.error("   Please set SHOPIFY_APP_URL environment variable to your app's URL.");
            console.error("   Example: SHOPIFY_APP_URL=https://your-app.onrender.com");
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
    catch (error) {
        console.error(`❌ Invalid SHOPIFY_APP_URL: ${backendUrl}`);
        console.error("   Please provide a valid URL (e.g., https://your-app.onrender.com)");
        if (error instanceof Error) {
            console.error(`   Error: ${error.message}`);
        }
        process.exit(1);
    }

    let injectedCount = 0;

    // Process shared config
    try {
        if (!fs.existsSync(SHARED_CONFIG_FILE)) {
            console.error(`❌ Shared config file not found: ${SHARED_CONFIG_FILE}`);
            process.exit(1);
        }
        const sharedConfig = readConfig(SHARED_CONFIG_FILE);
        if (sharedConfig.includes(PLACEHOLDER)) {
            const updatedSharedConfig = sharedConfig.replace(`const BUILD_TIME_URL = "${PLACEHOLDER}";`, `const BUILD_TIME_URL = "${backendUrl}";`);
            writeConfig(SHARED_CONFIG_FILE, updatedSharedConfig);
            console.log(`✅ Injected BACKEND_URL to shared config: ${backendUrl}`);
            injectedCount++;
        } else {
            console.log("⚠️  Placeholder not found in shared config. Already replaced or config modified.");
        }
    } catch (error) {
        console.error(`❌ Failed to process shared config: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }

    // Process thank-you-blocks config
    try {
        if (fs.existsSync(THANK_YOU_CONFIG_FILE)) {
            const thankYouConfig = readConfig(THANK_YOU_CONFIG_FILE);
            if (thankYouConfig.includes(PLACEHOLDER)) {
                const updatedThankYouConfig = thankYouConfig.replace(`const BUILD_TIME_URL = "${PLACEHOLDER}";`, `const BUILD_TIME_URL = "${backendUrl}";`);
                writeConfig(THANK_YOU_CONFIG_FILE, updatedThankYouConfig);
                console.log(`✅ Injected BACKEND_URL to thank-you-blocks config: ${backendUrl}`);
                injectedCount++;
            } else {
                console.log("⚠️  Placeholder not found in thank-you-blocks config. Already replaced or config modified.");
            }
        } else {
            console.log("⚠️  Thank-you-blocks config file not found, skipping.");
        }
    } catch (error) {
        console.error(`❌ Failed to process thank-you-blocks config: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }

    // Process shared config.js (if it exists, may be a compiled file)
    try {
        if (fs.existsSync(SHARED_CONFIG_JS_FILE)) {
            const sharedConfigJs = readConfig(SHARED_CONFIG_JS_FILE);
            if (sharedConfigJs.includes(PLACEHOLDER)) {
                const updatedSharedConfigJs = sharedConfigJs.replace(`const BUILD_TIME_URL = "${PLACEHOLDER}";`, `const BUILD_TIME_URL = "${backendUrl}";`);
                writeConfig(SHARED_CONFIG_JS_FILE, updatedSharedConfigJs);
                console.log(`✅ Injected BACKEND_URL to shared config.js: ${backendUrl}`);
                injectedCount++;
            }
        }
    } catch (error) {
        // Don't fail if config.js doesn't exist or can't be processed (it may be a compiled file)
        console.log("ℹ️  Shared config.js not processed (may be a compiled file):", error instanceof Error ? error.message : String(error));
    }

    if (injectedCount === 0) {
        console.warn("⚠️  No placeholders were replaced. Please check that config files contain the placeholder.");
    } else {
        console.log(`✅ Successfully injected BACKEND_URL to ${injectedCount} config file(s)`);
    }
}

function restorePlaceholder(): void {
    // Restore shared config
    const sharedConfig = readConfig(SHARED_CONFIG_FILE);
    const urlPattern = /const BUILD_TIME_URL = "([^"]+)";/;
    const sharedMatch = sharedConfig.match(urlPattern);
    if (sharedMatch && sharedMatch[1] !== PLACEHOLDER) {
        const updatedSharedConfig = sharedConfig.replace(urlPattern, `const BUILD_TIME_URL = "${PLACEHOLDER}";`);
        writeConfig(SHARED_CONFIG_FILE, updatedSharedConfig);
        console.log(`✅ Restored placeholder in shared config (was: ${sharedMatch[1]})`);
    } else {
        console.log("ℹ️  Placeholder already in place in shared config, nothing to restore");
    }

    // Restore thank-you-blocks config
    if (fs.existsSync(THANK_YOU_CONFIG_FILE)) {
        const thankYouConfig = readConfig(THANK_YOU_CONFIG_FILE);
        const thankYouMatch = thankYouConfig.match(urlPattern);
        if (thankYouMatch && thankYouMatch[1] !== PLACEHOLDER) {
            const updatedThankYouConfig = thankYouConfig.replace(urlPattern, `const BUILD_TIME_URL = "${PLACEHOLDER}";`);
            writeConfig(THANK_YOU_CONFIG_FILE, updatedThankYouConfig);
            console.log(`✅ Restored placeholder in thank-you-blocks config (was: ${thankYouMatch[1]})`);
        } else {
            console.log("ℹ️  Placeholder already in place in thank-you-blocks config, nothing to restore");
        }
    }

    // Restore shared config.js (if it exists)
    if (fs.existsSync(SHARED_CONFIG_JS_FILE)) {
        try {
            const sharedConfigJs = readConfig(SHARED_CONFIG_JS_FILE);
            const sharedJsMatch = sharedConfigJs.match(urlPattern);
            if (sharedJsMatch && sharedJsMatch[1] !== PLACEHOLDER) {
                const updatedSharedConfigJs = sharedConfigJs.replace(urlPattern, `const BUILD_TIME_URL = "${PLACEHOLDER}";`);
                writeConfig(SHARED_CONFIG_JS_FILE, updatedSharedConfigJs);
                console.log(`✅ Restored placeholder in shared config.js (was: ${sharedJsMatch[1]})`);
            }
        } catch (error) {
            // Don't fail if config.js can't be processed
            console.log("ℹ️  Shared config.js not restored (may be a compiled file)");
        }
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
  SHOPIFY_APP_URL=https://your-app.onrender.com
  npm run deploy  # Shopify CLI builds extensions
  npm run ext:restore
`);
}
