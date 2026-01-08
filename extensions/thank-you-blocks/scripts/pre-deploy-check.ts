#!/usr/bin/env tsx

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const EXTENSION_DIR = join(process.cwd());
const PACKAGE_JSON = join(EXTENSION_DIR, "package.json");
const CONFIG_FILE = join(EXTENSION_DIR, "shopify.extension.toml");

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  severity: "error" | "warning";
}

const results: CheckResult[] = [];

function addResult(name: string, passed: boolean, message: string, severity: "error" | "warning" = "error"): void {
  results.push({ name, passed, message, severity });
}

function checkTypeScriptCompilation(): void {
  try {
    execSync("npm run build", {
      cwd: EXTENSION_DIR,
      stdio: "pipe",
      encoding: "utf-8"
    });
    addResult("TypeScript 编译", true, "编译通过，无语法错误", "error");
  } catch (error: any) {
    const errorOutput = error.stdout || error.stderr || String(error);
    addResult("TypeScript 编译", false, `编译失败: ${errorOutput.substring(0, 200)}`, "error");
  }
}

function checkApiVersion(): void {
  try {
    if (!existsSync(CONFIG_FILE)) {
      addResult("API 版本配置", false, "未找到 shopify.extension.toml 文件", "error");
      return;
    }

    const config = readFileSync(CONFIG_FILE, "utf-8");
    const apiVersionMatch = config.match(/api_version\s*=\s*["']?([^"'\n]+)["']?/);

    if (!apiVersionMatch) {
      addResult("API 版本配置", false, "未找到 api_version 配置", "error");
      return;
    }

    const apiVersion = apiVersionMatch[1];
    const [year, month] = apiVersion.split("-").map(Number);

    if (year < 2025 || (year === 2025 && month < 7)) {
      addResult("API 版本配置", false, `API 版本 ${apiVersion} 过旧，建议升级到 2025-07 或更新版本`, "error");
    } else {
      addResult("API 版本配置", true, `API 版本: ${apiVersion} (符合要求)`, "error");
    }
  } catch (error) {
    addResult("API 版本配置", false, `检查失败: ${error}`, "error");
  }
}

function checkDependencyVersions(): void {
  try {
    if (!existsSync(PACKAGE_JSON)) {
      addResult("依赖版本", false, "未找到 package.json 文件", "error");
      return;
    }

    const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8"));
    const uiExtensionsVersion = packageJson.dependencies?.["@shopify/ui-extensions-react"];
    const uiExtensionsCoreVersion = packageJson.dependencies?.["@shopify/ui-extensions"];

    if (!uiExtensionsVersion || !uiExtensionsCoreVersion) {
      addResult("依赖版本", false, "未找到 @shopify/ui-extensions 或 @shopify/ui-extensions-react 依赖", "error");
      return;
    }

    const versionMatch = uiExtensionsVersion.match(/^(\^|~)?(\d+)\.(\d+)\.(\d+)/);
    if (versionMatch) {
      const major = parseInt(versionMatch[2]);
      const minor = parseInt(versionMatch[3]);

      if (major < 2025 || (major === 2025 && minor < 7)) {
        addResult("依赖版本", false, `依赖版本 ${uiExtensionsVersion} 可能过旧，建议升级到 ^2025.7.3`, "warning");
      } else {
        addResult("依赖版本", true, `依赖版本: ${uiExtensionsVersion} (符合要求)`, "error");
      }
    } else {
      addResult("依赖版本", true, `依赖版本: ${uiExtensionsVersion}`, "error");
    }
  } catch (error) {
    addResult("依赖版本", false, `检查失败: ${error}`, "error");
  }
}

function runValidationScript(): void {
  try {
    const output = execSync("npm run validate", {
      cwd: EXTENSION_DIR,
      stdio: "pipe",
      encoding: "utf-8"
    });

    if (output.includes("所有检查通过")) {
      addResult("代码质量验证", true, "所有验证检查通过", "error");
    } else {
      addResult("代码质量验证", false, "验证脚本发现问题，请查看详细输出", "error");
    }
  } catch (error: any) {
    const errorOutput = error.stdout || error.stderr || String(error);
    addResult("代码质量验证", false, `验证失败: ${errorOutput.substring(0, 300)}`, "error");
  }
}

function checkExtensionUIDs(): void {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return;
    }

    const config = readFileSync(CONFIG_FILE, "utf-8");
    const lines = config.split("\n");
    const uids: Array<{ uid: string; line: number }> = [];

    for (let i = 0; i < lines.length; i++) {
      const uidMatch = lines[i].match(/uid\s*=\s*["']([^"']+)["']/);
      if (uidMatch) {
        uids.push({ uid: uidMatch[1], line: i + 1 });
      }
    }

    if (uids.length === 0) {
      addResult("扩展 UID", true, "未找到 UID 配置（可能由 Shopify CLI 自动生成）", "warning");
      return;
    }

    const invalidUIDs: string[] = [];
    for (const { uid, line } of uids) {
      const segments = uid.split("-");
      const hasOnlyHexChars = segments.every(seg => /^[0-9a-f]+$/i.test(seg));
      const isValidFormat = segments.length >= 4 && hasOnlyHexChars && uid.length >= 36;

      if (!isValidFormat) {
        invalidUIDs.push(`行 ${line}: ${uid}`);
      }
    }

    if (invalidUIDs.length > 0) {
      addResult("扩展 UID", false, `发现无效的 UID 格式: ${invalidUIDs.join(", ")}`, "error");
    } else {
      addResult("扩展 UID", true, `所有 ${uids.length} 个 UID 格式正确`, "error");
    }

    const uidCounts = new Map<string, number[]>();
    uids.forEach(({ uid, line }) => {
      if (!uidCounts.has(uid)) {
        uidCounts.set(uid, []);
      }
      uidCounts.get(uid)!.push(line);
    });

    const duplicates: string[] = [];
    uidCounts.forEach((lines, uid) => {
      if (lines.length > 1) {
        duplicates.push(`UID ${uid} 在行 ${lines.join(", ")} 重复`);
      }
    });

    if (duplicates.length > 0) {
      addResult("扩展 UID 唯一性", false, `发现重复的 UID: ${duplicates.join("; ")}`, "error");
    } else {
      addResult("扩展 UID 唯一性", true, "所有 UID 唯一", "error");
    }
  } catch (error) {
    addResult("扩展 UID", false, `检查失败: ${error}`, "error");
  }
}

function main(): void {
  console.log("🚀 开始部署前完整自检...\n");
  console.log("=" .repeat(60));

  checkTypeScriptCompilation();
  checkApiVersion();
  checkDependencyVersions();
  checkExtensionUIDs();
  runValidationScript();

  console.log("\n📊 检查结果汇总:\n");

  const errorCount = results.filter(r => r.severity === "error" && !r.passed).length;
  const warningCount = results.filter(r => r.severity === "warning" && !r.passed).length;
  const passedCount = results.filter(r => r.passed).length;

  results.forEach(result => {
    const icon = result.passed ? "✅" : (result.severity === "error" ? "❌" : "⚠️");
    const status = result.passed ? "通过" : "失败";
    console.log(`${icon} [${result.severity.toUpperCase()}] ${result.name}: ${status}`);
    if (!result.passed || result.severity === "warning") {
      console.log(`   ${result.message}`);
    }
  });

  console.log("\n" + "=".repeat(60));
  console.log(`\n📈 统计: ${passedCount}/${results.length} 项通过, ${errorCount} 个错误, ${warningCount} 个警告\n`);

  if (errorCount > 0) {
    console.log("❌ 发现 P0 级别错误，请修复后再部署！\n");
    process.exit(1);
  } else if (warningCount > 0) {
    console.log("⚠️  发现警告，建议修复后再部署。\n");
    process.exit(0);
  } else {
    console.log("✅ 所有检查通过！代码已准备好部署。\n");
    process.exit(0);
  }
}

main();
