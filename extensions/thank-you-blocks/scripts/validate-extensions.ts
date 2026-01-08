#!/usr/bin/env tsx

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative, extname } from "path";

const EXTENSION_DIR = join(process.cwd());
const SRC_DIR = join(EXTENSION_DIR, "src");
const CONFIG_FILE = join(EXTENSION_DIR, "shopify.extension.toml");

interface Violation {
    file: string;
    line: number;
    content: string;
    description: string;
}

interface CheckResult {
    name: string;
    passed: boolean;
    violations: Violation[];
    message: string;
}

const results: CheckResult[] = [];

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
    {
        pattern: /\bwindow\s*\./,
        description: "window API 被禁止使用（Shopify UI Extensions 不支持）",
    },
    {
        pattern: /\bnavigator\s*\./,
        description: "navigator API 被禁止使用（Shopify UI Extensions 不支持）",
    },
    {
        pattern: /\bdocument\s*\./,
        description: "document API 被禁止使用（Shopify UI Extensions 不支持）",
    },
    {
        pattern: /\blocalStorage\b/,
        description: "localStorage 被禁止使用（Shopify UI Extensions 不支持）",
    },
    {
        pattern: /\bsessionStorage\b/,
        description: "sessionStorage 被禁止使用（Shopify UI Extensions 不支持）",
    },
];

const ALLOWED_PATTERNS: RegExp[] = [
    /\/\/.*(window|navigator|document|localStorage|sessionStorage)/i,
    /\/\*[\s\S]*?(window|navigator|document|localStorage|sessionStorage)[\s\S]*?\*\
    /".*window.*"/,
    /'.*window.*'/,
    /`.*window.*`/,
    /".*navigator.*"/,
    /'.*navigator.*'/,
    /`.*navigator.*`/,
    /".*document.*"/,
    /'.*document.*'/,
    /`.*document.*`/,
];

const FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const IGNORE_PATTERNS = [
    "node_modules",
    ".git",
    "build",
    "dist",
    ".cache",
    "scripts/validate-extensions.ts",
];

function shouldIgnore(filePath: string): boolean {
    return IGNORE_PATTERNS.some(pattern => filePath.includes(pattern));
}

function isAllowed(line: string): boolean {
    return ALLOWED_PATTERNS.some(pattern => pattern.test(line));
}

function checkForbiddenAPIs(): CheckResult {
    const violations: Violation[] = [];

    function scanDirectory(dir: string): void {
        if (!existsSync(dir)) {
            return;
        }

        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            const relativePath = relative(EXTENSION_DIR, fullPath);

            if (shouldIgnore(relativePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                scanDirectory(fullPath);
            } else if (entry.isFile()) {
                const ext = extname(entry.name);
                if (FILE_EXTENSIONS.includes(ext)) {
                    try {
                        const content = readFileSync(fullPath, "utf-8");
                        const lines = content.split("\n");

                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            if (isAllowed(line)) {
                                continue;
                            }

                            for (const { pattern, description } of FORBIDDEN_PATTERNS) {
                                if (pattern.test(line)) {
                                    violations.push({
                                        file: relativePath,
                                        line: i + 1,
                                        content: line.trim(),
                                        description,
                                    });
                                }
                            }
                        }
                    } catch (error) {

                    }
                }
            }
        }
    }

    scanDirectory(SRC_DIR);

    return {
        name: "禁止使用的浏览器 API",
        passed: violations.length === 0,
        violations,
        message: violations.length === 0
            ? "未发现禁止使用的浏览器 API"
            : `发现 ${violations.length} 处禁止使用的 API`,
    };
}

function checkExtensionConfig(): CheckResult {
    const violations: Violation[] = [];

    if (!existsSync(CONFIG_FILE)) {
        violations.push({
            file: "shopify.extension.toml",
            line: 0,
            content: "",
            description: "扩展配置文件不存在",
        });
        return {
            name: "扩展配置文件",
            passed: false,
            violations,
            message: "扩展配置文件不存在",
        };
    }

    try {
        const content = readFileSync(CONFIG_FILE, "utf-8");

        if (!content.includes("api_version")) {
            violations.push({
                file: "shopify.extension.toml",
                line: 0,
                content: "",
                description: "缺少 api_version 配置",
            });
        }

        if (!content.includes("type =")) {
            violations.push({
                file: "shopify.extension.toml",
                line: 0,
                content: "",
                description: "缺少 type 配置",
            });
        }
    } catch (error) {
        violations.push({
            file: "shopify.extension.toml",
            line: 0,
            content: "",
            description: `读取配置文件失败: ${error}`,
        });
    }

    return {
        name: "扩展配置文件",
        passed: violations.length === 0,
        violations,
        message: violations.length === 0
            ? "扩展配置文件格式正确"
            : `发现 ${violations.length} 个配置问题`,
    };
}

function checkSourceStructure(): CheckResult {
    const violations: Violation[] = [];

    if (!existsSync(SRC_DIR)) {
        violations.push({
            file: "src",
            line: 0,
            content: "",
            description: "源代码目录不存在",
        });
    }

    return {
        name: "源代码文件结构",
        passed: violations.length === 0,
        violations,
        message: violations.length === 0
            ? "源代码目录结构正确"
            : `发现 ${violations.length} 个结构问题`,
    };
}

function main(): number {
    console.log("🔍 开始验证 Thank You Blocks 扩展...\n");
    console.log("=".repeat(60));

    results.push(checkForbiddenAPIs());
    results.push(checkExtensionConfig());
    results.push(checkSourceStructure());

    console.log("\n📊 检查结果汇总:\n");

    let allPassed = true;
    for (const result of results) {
        const icon = result.passed ? "✅" : "❌";
        console.log(`${icon} ${result.name}: ${result.message}`);

        if (!result.passed && result.violations.length > 0) {
            allPassed = false;
            console.log(`   发现 ${result.violations.length} 个问题:`);
            for (const violation of result.violations.slice(0, 10)) {
                console.log(`   - ${violation.file}:${violation.line} - ${violation.description}`);
                if (violation.content) {
                    console.log(`     内容: ${violation.content.substring(0, 80)}`);
                }
            }
            if (result.violations.length > 10) {
                console.log(`   ... 还有 ${result.violations.length - 10} 个问题未显示`);
            }
        }
        console.log("");
    }

    console.log("=".repeat(60));

    const passedCount = results.filter(r => r.passed).length;
    const totalCount = results.length;

    if (allPassed) {
        console.log(`\n✅ 所有检查通过 (${passedCount}/${totalCount})\n`);
        return 0;
    } else {
        console.log(`\n❌ 发现 ${results.filter(r => !r.passed).length} 个检查项失败 (${passedCount}/${totalCount})\n`);
        return 1;
    }
}

process.exit(main());
