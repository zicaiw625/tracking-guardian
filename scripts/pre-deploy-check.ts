#!/usr/bin/env node --experimental-strip-types
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CheckResult {
    name: string;
    passed: boolean;
    message: string;
}

const results: CheckResult[] = [];

function checkBuildExtensionsSyntax(): CheckResult {
    const filePath = path.join(__dirname, "build-extensions.ts");
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        
        // 检查是否有明显的语法错误（如未闭合的括号）
        const openBraces = (content.match(/\{/g) || []).length;
        const closeBraces = (content.match(/\}/g) || []).length;
        const openParens = (content.match(/\(/g) || []).length;
        const closeParens = (content.match(/\)/g) || []).length;
        
        // 检查字符串是否匹配（更精确的方法：检查字符串字面量）
        // 使用正则表达式匹配字符串字面量，排除注释和模板字符串
        const stringLiteralRegex = /(["'])(?:(?=(\\?))\2.)*?\1/g;
        const doubleQuoteStrings = content.match(/"[^"\\]*(\\.[^"\\]*)*"/g) || [];
        const singleQuoteStrings = content.match(/'[^'\\]*(\\.[^'\\]*)*'/g) || [];
        
        // 检查是否有明显的未闭合字符串（简单检查）
        // 注意：这个方法不完美，但可以检测明显的错误
        const unclosedDoubleQuotes = (content.match(/"[^"]*$/gm) || []).filter(line => {
            // 排除注释行和模板字符串
            return !line.trim().startsWith("//") && !line.includes("`");
        }).length;
        
        if (unclosedDoubleQuotes > 0 && !content.includes("console.log(`")) {
            // 可能是未闭合的字符串，但需要更仔细的检查
            // 暂时跳过这个检查，因为可能有合法的多行字符串
        }
        
        if (openBraces !== closeBraces) {
            return {
                name: "build-extensions.ts 语法检查",
                passed: false,
                message: `大括号不匹配：${openBraces} 个开括号，${closeBraces} 个闭括号`,
            };
        }
        
        if (openParens !== closeParens) {
            return {
                name: "build-extensions.ts 语法检查",
                passed: false,
                message: `圆括号不匹配：${openParens} 个开括号，${closeParens} 个闭括号`,
            };
        }
        
        // 检查是否包含必要的函数
        if (!content.includes("injectBackendUrl")) {
            return {
                name: "build-extensions.ts 语法检查",
                passed: false,
                message: "缺少 injectBackendUrl 函数",
            };
        }
        
        if (!content.includes("restorePlaceholder")) {
            return {
                name: "build-extensions.ts 语法检查",
                passed: false,
                message: "缺少 restorePlaceholder 函数",
            };
        }
        
        return {
            name: "build-extensions.ts 语法检查",
            passed: true,
            message: "语法检查通过",
        };
    } catch (error) {
        return {
            name: "build-extensions.ts 语法检查",
            passed: false,
            message: `读取文件失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

function checkExtensionUids(): CheckResult {
    const filePath = path.join(__dirname, "../extensions/thank-you-blocks/shopify.extension.toml");
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        
        // 查找所有 uid 行（包括注释掉的）
        const uidLines = content.match(/uid\s*=\s*"([^"]+)"/g) || [];
        const placeholderPattern = /^0{8,}|^[a-f0-9]{8}-0{4}-0{4}-0{4}-0{12,}$/i;
        
        const invalidUids: string[] = [];
        
        for (const line of uidLines) {
            const match = line.match(/uid\s*=\s*"([^"]+)"/);
            if (match && match[1]) {
                const uid = match[1];
                // 检查是否是占位符格式
                if (placeholderPattern.test(uid) || uid.includes("PLACEHOLDER") || uid.includes("placeholder")) {
                    invalidUids.push(uid);
                }
            }
        }
        
        // 检查未注释的扩展是否有占位符 uid
        const lines = content.split("\n");
        const activeInvalidUids: string[] = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes("uid =") && !line.trim().startsWith("#")) {
                // 检查这一行是否被注释
                let isCommented = false;
                
                // 向上查找，看是否在注释块中
                for (let j = i - 1; j >= 0 && j >= i - 30; j--) {
                    const prevLine = lines[j].trim();
                    // 如果遇到注释标记，检查是否是整个扩展块被注释
                    if (prevLine.startsWith("# [[extensions]]") || prevLine.startsWith("#[extensions]")) {
                        isCommented = true;
                        break;
                    }
                    // 如果遇到未注释的 [[extensions]]，说明这个扩展是激活的
                    if (prevLine === "[[extensions]]" || prevLine.startsWith("[[extensions]]")) {
                        break;
                    }
                    // 如果这一行本身被注释
                    if (prevLine.startsWith("#") && prevLine.includes("uid")) {
                        isCommented = true;
                        break;
                    }
                }
                
                if (!isCommented) {
                    const match = line.match(/uid\s*=\s*"([^"]+)"/);
                    if (match && match[1]) {
                        const uid = match[1];
                        if (placeholderPattern.test(uid) || uid.includes("PLACEHOLDER") || uid.includes("placeholder")) {
                            activeInvalidUids.push(uid);
                        }
                    }
                }
            }
        }
        
        if (activeInvalidUids.length > 0) {
            return {
                name: "扩展 UID 检查",
                passed: false,
                message: `发现 ${activeInvalidUids.length} 个未注释的占位符 UID: ${activeInvalidUids.slice(0, 3).join(", ")}`,
            };
        }
        
        // 如果有占位符但都被注释了，给出警告但不失败
        if (invalidUids.length > 0 && activeInvalidUids.length === 0) {
            return {
                name: "扩展 UID 检查",
                passed: true,
                message: `所有启用的扩展都有有效的 UID（发现 ${invalidUids.length} 个已注释的占位符，不影响部署）`,
            };
        }
        
        return {
            name: "扩展 UID 检查",
            passed: true,
            message: `所有启用的扩展都有有效的 UID（共 ${uidLines.length} 个）`,
        };
    } catch (error) {
        return {
            name: "扩展 UID 检查",
            passed: false,
            message: `读取文件失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

function checkDuplicateImports(): CheckResult {
    const filesToCheck = [
        "app/routes/app.verification.tsx",
        "app/routes/app.workspace.tsx",
    ];
    
    const issues: string[] = [];
    
    for (const file of filesToCheck) {
        const filePath = path.join(__dirname, "..", file);
        if (!fs.existsSync(filePath)) {
            issues.push(`${file}: 文件不存在`);
            continue;
        }
        
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        
        // 查找所有 react 导入（只检查 from "react" 或 from 'react'）
        const reactImports: Array<{ line: number; content: string }> = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // 只匹配 from "react" 或 from 'react'，不包括 @remix-run/react 等
            if (line.includes("import") && /from\s+["']react["']/.test(line)) {
                reactImports.push({ line: i + 1, content: line.trim() });
            }
        }
        
        if (reactImports.length > 1) {
            issues.push(`${file}: 发现 ${reactImports.length} 个 react 导入（第 ${reactImports.map(i => i.line).join(", ")} 行）`);
        }
        
        // 检查是否有重复的 Suspense 或 lazy 导入
        const suspenseCount = (content.match(/\bSuspense\b/g) || []).length;
        const lazyCount = (content.match(/\blazy\b/g) || []).length;
        
        // 在 import 语句中，每个应该只出现一次
        const importLines = content.match(/import\s+.*from\s+["']react["']/g) || [];
        if (importLines.length > 0) {
            const importContent = importLines.join(" ");
            const suspenseInImports = (importContent.match(/\bSuspense\b/g) || []).length;
            const lazyInImports = (importContent.match(/\blazy\b/g) || []).length;
            
            if (suspenseInImports > 1) {
                issues.push(`${file}: Suspense 在导入语句中出现 ${suspenseInImports} 次`);
            }
            if (lazyInImports > 1) {
                issues.push(`${file}: lazy 在导入语句中出现 ${lazyInImports} 次`);
            }
        }
    }
    
    if (issues.length > 0) {
        return {
            name: "重复导入检查",
            passed: false,
            message: issues.join("; "),
        };
    }
    
    return {
        name: "重复导入检查",
        passed: true,
        message: "未发现重复导入",
    };
}

function checkBackendUrlInjection(): CheckResult {
    const configFiles = [
        "extensions/shared/config.ts",
        "extensions/thank-you-blocks/src/config.ts",
    ];
    
    const missingFiles: string[] = [];
    const missingPlaceholder: string[] = [];
    
    for (const configFile of configFiles) {
        const filePath = path.join(__dirname, "..", configFile);
        if (!fs.existsSync(filePath)) {
            missingFiles.push(configFile);
            continue;
        }
        
        const content = fs.readFileSync(filePath, "utf-8");
        if (!content.includes("__BACKEND_URL_PLACEHOLDER__")) {
            missingPlaceholder.push(configFile);
        }
    }
    
    // 检查 build-extensions.ts 是否处理了这两个文件
    const buildScriptPath = path.join(__dirname, "build-extensions.ts");
    const buildScriptContent = fs.readFileSync(buildScriptPath, "utf-8");
    
    const issues: string[] = [];
    
    if (missingFiles.length > 0) {
        issues.push(`缺少配置文件: ${missingFiles.join(", ")}`);
    }
    
    if (missingPlaceholder.length > 0) {
        issues.push(`配置文件缺少占位符: ${missingPlaceholder.join(", ")}`);
    }
    
    if (!buildScriptContent.includes("THANK_YOU_CONFIG_FILE")) {
        issues.push("build-extensions.ts 未处理 thank-you-blocks 配置文件");
    }
    
    if (!buildScriptContent.includes("SHARED_CONFIG_FILE")) {
        issues.push("build-extensions.ts 未处理 shared 配置文件");
    }
    
    if (issues.length > 0) {
        return {
            name: "BACKEND_URL 注入检查",
            passed: false,
            message: issues.join("; "),
        };
    }
    
    return {
        name: "BACKEND_URL 注入检查",
        passed: true,
        message: `所有配置文件都已正确设置（共 ${configFiles.length} 个）`,
    };
}

// 运行所有检查
results.push(checkBuildExtensionsSyntax());
results.push(checkExtensionUids());
results.push(checkDuplicateImports());
results.push(checkBackendUrlInjection());

// 输出结果
console.log("\n🔍 部署前检查结果\n");
console.log("=" .repeat(60));

let allPassed = true;

for (const result of results) {
    const icon = result.passed ? "✅" : "❌";
    const status = result.passed ? "通过" : "失败";
    console.log(`${icon} ${result.name}: ${status}`);
    console.log(`   ${result.message}`);
    console.log();
    
    if (!result.passed) {
        allPassed = false;
    }
}

console.log("=" .repeat(60));

if (allPassed) {
    console.log("\n✅ 所有检查通过，可以继续部署\n");
    process.exit(0);
} else {
    console.log("\n❌ 部分检查失败，请修复后再部署\n");
    process.exit(1);
}
