/**
 * GraphQL-only Compliance Check
 * 
 * P0-02: Ensures no REST API endpoints are introduced.
 * This script scans the codebase for patterns that indicate REST API usage.
 * 
 * Usage: npx ts-node scripts/check-graphql-only.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Patterns that indicate REST API usage (not allowed for new Shopify public apps)
const REST_PATTERNS = [
    // REST Admin API endpoint patterns (non-GraphQL)
    {
        pattern: /\/admin\/api\/\d{4}-\d{2}\/(?!graphql\.json)[a-z_]+\.json/gi,
        description: "REST Admin API endpoint (use GraphQL instead)",
    },
    {
        pattern: /\.rest\(\s*\{/gi,
        description: "Shopify REST client usage",
    },
    {
        pattern: /shopify\.rest\./gi,
        description: "Shopify REST client property access",
    },
    {
        pattern: /RestClient/gi,
        description: "RestClient class usage",
    },
    {
        pattern: /createRestApiClient/gi,
        description: "REST API client creation",
    },
];

// Files/directories to ignore
const IGNORE_PATTERNS = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".cache",
    "coverage",
    ".prisma",
    "*.test.ts",
    "*.test.tsx",
    "*.spec.ts",
    "*.spec.tsx",
];

// Allowed REST patterns (false positives)
const ALLOWED_PATTERNS = [
    // These are legitimate uses that look like REST but aren't
    /google-analytics\.com\/mp\/collect/gi,  // GA4 Measurement Protocol
    /graph\.facebook\.com/gi,                 // Meta Graph API
    /api\.telegram\.org/gi,                   // Telegram Bot API
    /ads\.tiktok\.com/gi,                     // TikTok Ads API
];

interface Violation {
    file: string;
    line: number;
    match: string;
    description: string;
}

function shouldIgnore(filePath: string): boolean {
    return IGNORE_PATTERNS.some(pattern => {
        if (pattern.startsWith("*")) {
            return filePath.endsWith(pattern.slice(1));
        }
        return filePath.includes(pattern);
    });
}

function isAllowedPattern(line: string): boolean {
    return ALLOWED_PATTERNS.some(pattern => pattern.test(line));
}

function scanFile(filePath: string): Violation[] {
    const violations: Violation[] = [];
    
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        
        lines.forEach((line, lineIndex) => {
            // Skip if line contains an allowed pattern
            if (isAllowedPattern(line)) {
                return;
            }
            
            REST_PATTERNS.forEach(({ pattern, description }) => {
                // Reset regex lastIndex
                pattern.lastIndex = 0;
                
                const match = line.match(pattern);
                if (match) {
                    violations.push({
                        file: filePath,
                        line: lineIndex + 1,
                        match: match[0],
                        description,
                    });
                }
            });
        });
    } catch (error) {
        // Skip files that can't be read
    }
    
    return violations;
}

function scanDirectory(dir: string): Violation[] {
    let violations: Violation[] = [];
    
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (shouldIgnore(fullPath)) {
                continue;
            }
            
            if (entry.isDirectory()) {
                violations = violations.concat(scanDirectory(fullPath));
            } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
                violations = violations.concat(scanFile(fullPath));
            }
        }
    } catch (error) {
        // Skip directories that can't be read
    }
    
    return violations;
}

function main(): void {
    const rootDir = path.resolve(__dirname, "..");
    const appDir = path.join(rootDir, "app");
    const extensionsDir = path.join(rootDir, "extensions");
    
    console.log("🔍 GraphQL-only Compliance Check (P0-02)\n");
    console.log("Scanning for REST API usage patterns...\n");
    
    let allViolations: Violation[] = [];
    
    // Scan app directory
    if (fs.existsSync(appDir)) {
        console.log(`Scanning: ${appDir}`);
        allViolations = allViolations.concat(scanDirectory(appDir));
    }
    
    // Scan extensions directory
    if (fs.existsSync(extensionsDir)) {
        console.log(`Scanning: ${extensionsDir}`);
        allViolations = allViolations.concat(scanDirectory(extensionsDir));
    }
    
    console.log("");
    
    if (allViolations.length === 0) {
        console.log("✅ GraphQL-only check passed! No REST API usage detected.\n");
        console.log("Your codebase complies with Shopify's GraphQL-only requirement for new public apps.");
        process.exit(0);
    } else {
        console.log(`❌ Found ${allViolations.length} potential REST API usage(s):\n`);
        
        allViolations.forEach((v, index) => {
            console.log(`${index + 1}. ${v.file}:${v.line}`);
            console.log(`   Match: ${v.match}`);
            console.log(`   Issue: ${v.description}`);
            console.log("");
        });
        
        console.log("⚠️  Please migrate these to GraphQL equivalents.");
        console.log("   Reference: https://shopify.dev/docs/api/admin-graphql\n");
        
        process.exit(1);
    }
}

main();

