

import * as fs from "fs";
import * as path from "path";

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
    {

        pattern: /\/admin\/api\/\d{4}-\d{2}\/(?!graphql\.json)[a-z_]+/i,
        description: "REST API endpoint detected (use GraphQL instead)",
    },
    {

        pattern: /\/admin\/api\/\d{4}-\d{2}\/[a-z_]+\.json/i,
        description: "REST .json endpoint detected",
    },
    {

        pattern: /AdminRestApiClient/,
        description: "AdminRestApiClient import/usage detected (use GraphQL client)",
    },
    {

        pattern: /\.restClient\b/,
        description: ".restClient property access detected",
    },
    {

        pattern: /rest:\s*true/,
        description: "REST client option detected",
    },
    {

        pattern: /shopify\.clients\.Rest/,
        description: "Shopify REST client constructor detected",
    },
    {

        pattern: /\bnew\s+Rest\s*\(|Rest\.create\s*\(/,
        description: "REST client instantiation detected",
    },
];

const ALLOWED_PATTERNS: RegExp[] = [

    /\/admin\/api\/\d{4}-\d{2}\/graphql\.json/,

    /\/\/.*rest/i,
    /\/\*.*rest.*\*\

    /".*REST.*"/i,
    /'.*REST.*'/i,

    /\.test\.ts$/,
];

const SCAN_DIRECTORIES = [
    "app",
    "extensions",
];

const FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

const IGNORE_PATTERNS = [
    "node_modules",
    ".git",
    "build",
    "dist",
    ".cache",
    "scripts/check-graphql-only.ts",
];

interface Violation {
    file: string;
    line: number;
    content: string;
    description: string;
}

function shouldIgnore(filePath: string): boolean {
    return IGNORE_PATTERNS.some(pattern => filePath.includes(pattern));
}

function isAllowed(line: string, filePath: string): boolean {

    if (ALLOWED_PATTERNS.some(pattern => {
        if (pattern.source.endsWith("$")) {
            return pattern.test(filePath);
        }
        return pattern.test(line);
    })) {
        return true;
    }
    return false;
}

function scanFile(filePath: string): Violation[] {
    const violations: Violation[] = [];

    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        lines.forEach((line, index) => {

            if (isAllowed(line, filePath)) {
                return;
            }

            for (const { pattern, description } of FORBIDDEN_PATTERNS) {
                if (pattern.test(line)) {
                    violations.push({
                        file: filePath,
                        line: index + 1,
                        content: line.trim().substring(0, 100),
                        description,
                    });
                    break;
                }
            }
        });
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
    }

    return violations;
}

function scanDirectory(dirPath: string): Violation[] {
    const violations: Violation[] = [];

    if (!fs.existsSync(dirPath)) {
        return violations;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (shouldIgnore(fullPath)) {
            continue;
        }

        if (entry.isDirectory()) {
            violations.push(...scanDirectory(fullPath));
        } else if (entry.isFile() && FILE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
            violations.push(...scanFile(fullPath));
        }
    }

    return violations;
}

function main(): void {
    console.log("🔍 Scanning for REST API usage (GraphQL-only compliance check)...\n");

    const allViolations: Violation[] = [];

    for (const dir of SCAN_DIRECTORIES) {
        const dirPath = path.join(process.cwd(), dir);
        allViolations.push(...scanDirectory(dirPath));
    }

    if (allViolations.length === 0) {
        console.log("✅ No REST API usage detected. GraphQL-only compliance check passed!\n");
        process.exit(0);
    } else {
        console.error("❌ REST API usage detected! GraphQL-only compliance check failed.\n");
        console.error("Shopify requires public apps to use GraphQL Admin API exclusively.\n");
        console.error("Violations found:\n");

        for (const violation of allViolations) {
            console.error(`  📍 ${violation.file}:${violation.line}`);
            console.error(`     ${violation.description}`);
            console.error(`     → ${violation.content}`);
            console.error("");
        }

        console.error(`\nTotal: ${allViolations.length} violation(s)`);
        console.error("\nPlease replace REST API calls with GraphQL equivalents.");
        console.error("Reference: https:

        process.exit(1);
    }
}

main();
