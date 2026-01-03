#!/usr/bin/env node --experimental-strip-types
/**
 * 扩展验证脚本
 * 验证 Shopify 扩展的代码质量和配置正确性
 * 
 * 检查项：
 * 1. 禁止使用的浏览器 API（window, navigator, document）
 * 2. 扩展配置文件存在性和基本格式
 * 3. 源代码文件结构
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..");
const EXTENSIONS_DIR = path.join(PROJECT_ROOT, "extensions");

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

// 禁止使用的浏览器 API 模式
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

// 允许的模式（注释中的使用是允许的）
const ALLOWED_PATTERNS: RegExp[] = [
    /\/\/.*(window|navigator|document|localStorage|sessionStorage)/i,
    /\/\*[\s\S]*?(window|navigator|document|localStorage|sessionStorage)[\s\S]*?\*\//i,
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

// 1. 检查禁止使用的浏览器 API
function checkForbiddenAPIs(): CheckResult {
    const violations: Violation[] = [];
    const extensionsSrcDir = path.join(EXTENSIONS_DIR, "thank-you-blocks", "src");
    const pixelSrcDir = path.join(EXTENSIONS_DIR, "tracking-pixel", "src");

    function scanDirectory(dir: string): void {
        if (!fs.existsSync(dir)) {
            return;
        }

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(PROJECT_ROOT, fullPath);

            if (shouldIgnore(relativePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                scanDirectory(fullPath);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (FILE_EXTENSIONS.includes(ext)) {
                    try {
                        const content = fs.readFileSync(fullPath, "utf-8");
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
                        // 忽略读取错误
                    }
                }
            }
        }
    }

    scanDirectory(extensionsSrcDir);
    scanDirectory(pixelSrcDir);

    return {
        name: "禁止使用的浏览器 API",
        passed: violations.length === 0,
        violations,
        message: violations.length === 0
            ? "未发现禁止使用的浏览器 API"
            : `发现 ${violations.length} 处禁止使用的 API`,
    };
}

// 2. 检查扩展配置文件
function checkExtensionConfigs(): CheckResult {
    const violations: Violation[] = [];
    const configFiles = [
        path.join(EXTENSIONS_DIR, "thank-you-blocks", "shopify.extension.toml"),
        path.join(EXTENSIONS_DIR, "tracking-pixel", "shopify.extension.toml"),
    ];

    for (const configFile of configFiles) {
        if (!fs.existsSync(configFile)) {
            violations.push({
                file: path.relative(PROJECT_ROOT, configFile),
                line: 0,
                content: "",
                description: "扩展配置文件不存在",
            });
            continue;
        }

        try {
            const content = fs.readFileSync(configFile, "utf-8");

            // 检查 api_version
            if (!content.includes("api_version")) {
                violations.push({
                    file: path.relative(PROJECT_ROOT, configFile),
                    line: 0,
                    content: "",
                    description: "缺少 api_version 配置",
                });
            }

            // 检查 type
            if (!content.includes("type =")) {
                violations.push({
                    file: path.relative(PROJECT_ROOT, configFile),
                    line: 0,
                    content: "",
                    description: "缺少 type 配置",
                });
            }
        } catch (error) {
            violations.push({
                file: path.relative(PROJECT_ROOT, configFile),
                line: 0,
                content: "",
                description: `读取配置文件失败: ${error}`,
            });
        }
    }

    return {
        name: "扩展配置文件",
        passed: violations.length === 0,
        violations,
        message: violations.length === 0
            ? "所有扩展配置文件格式正确"
            : `发现 ${violations.length} 个配置问题`,
    };
}

// 3. 检查源代码文件结构
function checkSourceStructure(): CheckResult {
    const violations: Violation[] = [];
    const expectedDirs = [
        path.join(EXTENSIONS_DIR, "thank-you-blocks", "src"),
        path.join(EXTENSIONS_DIR, "tracking-pixel", "src"),
    ];

    for (const dir of expectedDirs) {
        if (!fs.existsSync(dir)) {
            violations.push({
                file: path.relative(PROJECT_ROOT, dir),
                line: 0,
                content: "",
                description: "源代码目录不存在",
            });
        }
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

// 主函数
function main(): number {
    console.log("🔍 开始验证 Shopify 扩展...\n");
    console.log("=".repeat(60));

    // 运行所有检查
    results.push(checkForbiddenAPIs());
    results.push(checkExtensionConfigs());
    results.push(checkSourceStructure());

    // 输出结果
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

