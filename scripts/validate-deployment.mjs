#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.join(__dirname, "..");

function validateBuildExtensionsScript() {
    const result = { passed: true, errors: [], warnings: [] };
    const scriptPath = path.join(__dirname, "build-extensions.mjs");
    try {
        if (!fs.existsSync(scriptPath)) {
            result.passed = false;
            result.errors.push(`build-extensions.mjs 文件不存在: ${scriptPath}`);
            return result;
        }
        const content = fs.readFileSync(scriptPath, "utf-8");
        const openBraces = (content.match(/{/g) || []).length;
        const closeBraces = (content.match(/}/g) || []).length;
        if (openBraces !== closeBraces) {
            result.passed = false;
            result.errors.push(`build-extensions.mjs 中大括号不匹配: 开括号 ${openBraces}, 闭括号 ${closeBraces}`);
        }
        const openParens = (content.match(/\(/g) || []).length;
        const closeParens = (content.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
            result.passed = false;
            result.errors.push(`build-extensions.mjs 中括号不匹配: 开括号 ${openParens}, 闭括号 ${closeParens}`);
        }
        if (!content.includes("SHARED_CONFIG_FILE")) {
            result.passed = false;
            result.errors.push("build-extensions.mjs 中缺少对 shared 配置文件的处理");
        }
    } catch (error) {
        result.passed = false;
        result.errors.push(`检查 build-extensions.mjs 时出错: ${error instanceof Error ? error.message : String(error)}`);
    }
    return result;
}

function validateExtensionToml() {
    const result = { passed: true, errors: [], warnings: [] };
    const tomlPath = path.join(ROOT_DIR, "extensions/tracking-pixel/shopify.extension.toml");
    try {
        if (!fs.existsSync(tomlPath)) {
            result.passed = false;
            result.errors.push(`shopify.extension.toml 文件不存在: ${tomlPath}`);
            return result;
        }
        const content = fs.readFileSync(tomlPath, "utf-8");
        const lines = content.split("\n");
        let inCommentBlock = false;
        let currentExtensionUid = null;
        let currentExtensionName = null;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith("# [[extensions]]")) {
                inCommentBlock = true;
                continue;
            }
            if (inCommentBlock && line.startsWith("[[extensions]]") && !line.startsWith("#")) {
                inCommentBlock = false;
            }
            if (!inCommentBlock) {
                if (line.startsWith("name = ")) {
                    currentExtensionName = line.match(/name = "(.+)"/)?.[1] || null;
                }
                if (line.startsWith("uid = ")) {
                    currentExtensionUid = line.match(/uid = "(.+)"/)?.[1] || null;
                    if (currentExtensionUid) {
                        if (
                            currentExtensionUid.includes("00000000") ||
                            currentExtensionUid.includes("PLACEHOLDER") ||
                            currentExtensionUid.includes("a1b2c3d4") ||
                            currentExtensionUid.length < 20
                        ) {
                            result.passed = false;
                            result.errors.push(
                                `扩展 "${currentExtensionName || "未知"}" (第 ${i + 1} 行) 使用了占位符 uid: ${currentExtensionUid}`
                            );
                        }
                    }
                }
            }
        }
    } catch (error) {
        result.passed = false;
        result.errors.push(`检查 shopify.extension.toml 时出错: ${error instanceof Error ? error.message : String(error)}`);
    }
    return result;
}

function validateImports() {
    const result = { passed: true, errors: [], warnings: [] };
    const filesToCheck = [
        "app/routes/app.verification.tsx",
        "app/routes/app.workspace.tsx",
    ];
    for (const file of filesToCheck) {
        const filePath = path.join(ROOT_DIR, file);
        try {
            if (!fs.existsSync(filePath)) {
                result.warnings.push(`文件不存在: ${file}`);
                continue;
            }
            const content = fs.readFileSync(filePath, "utf-8");
            const lines = content.split("\n");
            const reactImports = [];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.includes("from \"react\"") || line.includes("from 'react'")) {
                    reactImports.push({ line: i + 1, content: line.trim() });
                }
            }
            if (reactImports.length > 1) {
                const allImports = new Set();
                for (const imp of reactImports) {
                    const match = imp.content.match(/import\s+\{([^}]+)\}\s+from/);
                    if (match) {
                        const imports = match[1].split(",").map(i => i.trim());
                        for (const item of imports) {
                            if (allImports.has(item)) {
                                result.passed = false;
                                result.errors.push(
                                    `文件 ${file} 第 ${imp.line} 行: 重复导入 "${item}"`
                                );
                            }
                            allImports.add(item);
                        }
                    }
                }
            }
        } catch (error) {
            result.warnings.push(`检查 ${file} 时出错: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return result;
}
function validateBackendUrlInjection() {
    const result = { passed: true, errors: [], warnings: [] };
    const configFiles = [
        "extensions/shared/config.ts",
    ];

    for (const configFile of configFiles) {
        const filePath = path.join(ROOT_DIR, configFile);
        try {
            if (!fs.existsSync(filePath)) {
                result.warnings.push(`配置文件不存在: ${configFile}`);
                continue;
            }
            const content = fs.readFileSync(filePath, "utf-8");
            if (!content.includes("__BACKEND_URL_PLACEHOLDER__")) {
                result.warnings.push(`配置文件 ${configFile} 中未找到占位符，可能已被替换`);
            }
            if (!content.includes("BACKEND_URL")) {
                result.passed = false;
                result.errors.push(`配置文件 ${configFile} 中缺少 BACKEND_URL 导出`);
            }
        } catch (error) {
            result.warnings.push(`检查 ${configFile} 时出错: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return result;
}

function validateNetworkAccessPermission() {
    const result = { passed: true, errors: [], warnings: [] };
    const extensionsDir = path.join(ROOT_DIR, "extensions");
    try {
        if (!fs.existsSync(extensionsDir)) {
            result.passed = true;
            result.warnings.push("extensions 目录不存在，跳过 Network Access 检查");
            return result;
        }
        const extensionDirs = fs.readdirSync(extensionsDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
        
        if (extensionDirs.length === 0) {
            result.passed = true;
            result.warnings.push("未找到扩展目录，跳过 Network Access 检查");
            return result;
        }
        
        const extensionsWithNetworkAccess = [];
        for (const extDir of extensionDirs) {
            const extensionConfigPath = path.join(extensionsDir, extDir, "shopify.extension.toml");
            if (!fs.existsSync(extensionConfigPath)) {
                continue;
            }
            try {
                const content = fs.readFileSync(extensionConfigPath, "utf-8");
                const hasNetworkAccess = content.includes("network_access = true") || 
                                         content.includes("network_access=true") ||
                                         /network_access\s*=\s*true/.test(content);
                if (hasNetworkAccess) {
                    extensionsWithNetworkAccess.push(extDir);
                }
            } catch (error) {
                continue;
            }
        }
        
        if (extensionsWithNetworkAccess.length === 0) {
            result.passed = true;
            result.warnings.push("未发现需要 network_access 的扩展");
            return result;
        }
        
        result.passed = true;
        result.warnings.push(`发现 ${extensionsWithNetworkAccess.length} 个扩展配置了 network_access: ${extensionsWithNetworkAccess.join(", ")}。⚠️ 重要：必须在 Partner Dashboard → App → API access → UI extensions network access 中批准该权限，否则部署会失败或模块无法正常工作。`);
    } catch (error) {
        result.passed = true;
        result.warnings.push(`检查扩展配置时出错: ${error instanceof Error ? error.message : String(error)}`);
    }
    return result;
}
async function main() {
    console.log("🔍 开始部署前验证...\n");

    const results = {
        buildExtensions: validateBuildExtensionsScript(),
        extensionToml: validateExtensionToml(),
        imports: validateImports(),
        backendUrl: validateBackendUrlInjection(),
        networkAccess: validateNetworkAccessPermission(),
    };

    let allPassed = true;
    let totalErrors = 0;
    let totalWarnings = 0;

    for (const [name, result] of Object.entries(results)) {
        console.log(`\n📋 检查: ${name}`);
        if (result.passed && result.errors.length === 0) {
            console.log("  ✅ 通过");
        } else {
            allPassed = false;
            if (result.errors.length > 0) {
                console.log("  ❌ 失败");
                result.errors.forEach(err => {
                    console.log(`    - ${err}`);
                    totalErrors++;
                });
            }
        }
        if (result.warnings.length > 0) {
            result.warnings.forEach(warn => {
                console.log(`    ⚠️  ${warn}`);
                totalWarnings++;
            });
        }
    }

    console.log("\n" + "=".repeat(50));
    if (allPassed) {
        console.log("✅ 所有验证通过！可以安全部署。");
        process.exit(0);
    } else {
        console.log(`❌ 验证失败: 发现 ${totalErrors} 个错误，${totalWarnings} 个警告`);
        console.log("请修复上述错误后再部署。");
        process.exit(1);
    }
}
main().catch(error => {
    console.error("验证脚本执行失败:", error);
    process.exit(1);
});
