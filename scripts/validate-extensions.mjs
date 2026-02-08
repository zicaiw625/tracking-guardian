#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..");
const EXTENSIONS_DIR = path.join(PROJECT_ROOT, "extensions");

const results = [];

const FORBIDDEN_PATTERNS = [
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

const ALLOWED_PATTERNS = [
  /\/\/.*(window|navigator|document|localStorage|sessionStorage)/i,
  /\/\*[\s\S]*?(window|navigator|document|localStorage|sessionStorage)[\s\S]*?\*\//,
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
const IGNORE_PATTERNS = ["node_modules", ".git", "build", "dist", ".cache", "scripts/validate-extensions.mjs"];

function shouldIgnore(filePath) {
  return IGNORE_PATTERNS.some((pattern) => filePath.includes(pattern));
}

function isAllowed(line) {
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(line));
}

function checkForbiddenAPIs() {
  const violations = [];
  const srcDirs = [
    path.join(EXTENSIONS_DIR, "tracking-pixel", "src"),
    path.join(EXTENSIONS_DIR, "post-checkout-badge", "src"),
  ];
  function scanDirectory(dir) {
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
          } catch (error) {}
        }
      }
    }
  }
  for (const srcDir of srcDirs) {
    scanDirectory(srcDir);
  }
  return {
    name: "禁止使用的浏览器 API",
    passed: violations.length === 0,
    violations,
    message: violations.length === 0 ? "未发现禁止使用的浏览器 API" : `发现 ${violations.length} 处禁止使用的 API`,
  };
}

function checkExtensionConfigs() {
  const violations = [];
  const configFiles = [
    path.join(EXTENSIONS_DIR, "tracking-pixel", "shopify.extension.toml"),
    path.join(EXTENSIONS_DIR, "post-checkout-badge", "shopify.extension.toml"),
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
      if (!content.includes("api_version")) {
        violations.push({
          file: path.relative(PROJECT_ROOT, configFile),
          line: 0,
          content: "",
          description: "缺少 api_version 配置",
        });
      }
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
    message: violations.length === 0 ? "所有扩展配置文件格式正确" : `发现 ${violations.length} 个配置问题`,
  };
}

function checkSourceStructure() {
  const violations = [];
  const expectedDirs = [
    path.join(EXTENSIONS_DIR, "tracking-pixel", "src"),
    path.join(EXTENSIONS_DIR, "post-checkout-badge", "src"),
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
    message: violations.length === 0 ? "源代码目录结构正确" : `发现 ${violations.length} 个结构问题`,
  };
}

function checkBackendUrlInjection() {
  const configFiles = [{ path: "extensions/shared/config.ts", label: "Shared config", requireBuildTimeUrl: true }];
  const violations = [];
  const placeholderPattern = /__BACKEND_URL_PLACEHOLDER__/;
  const buildTimeUrlPattern = /const\s+BUILD_TIME_URL\s*=\s*(["'])([^"']+)\1;/;
  const sharedConfigImportPattern = /import\s+.*\bBACKEND_URL\b.*from\s+["']\.\.\/\.\.\/shared\/config["']/;
  const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true" || process.env.RENDER === "true";

  for (const configFile of configFiles) {
    const filePath = path.join(PROJECT_ROOT, configFile.path);
    if (!fs.existsSync(filePath)) {
      violations.push({
        file: configFile.path,
        line: 0,
        content: "",
        description: "配置文件不存在",
      });
      continue;
    }
    const content = fs.readFileSync(filePath, "utf-8");

    if (configFile.requireBuildTimeUrl) {
      const match = content.match(buildTimeUrlPattern);
      if (!match) {
        violations.push({
          file: configFile.path,
          line: 0,
          content: "",
          description: "未找到 BUILD_TIME_URL 定义",
        });
        continue;
      }
      const urlValue = match[2];
      if (placeholderPattern.test(urlValue)) {
        violations.push({
          file: configFile.path,
          line: 0,
          content: urlValue,
          description: "URL 仍为占位符，需要在部署前运行 'pnpm ext:inject' 或 'pnpm deploy:ext'",
        });
      } else if (urlValue.includes("localhost") || urlValue.includes("127.0.0.1")) {
        if (isCI) {
          violations.push({
            file: configFile.path,
            line: 0,
            content: urlValue,
            description: "URL 指向 localhost，生产环境将无法工作。CI/CD 环境中必须设置正确的 SHOPIFY_APP_URL",
          });
        }
      }
    } else {
      if (!sharedConfigImportPattern.test(content)) {
        violations.push({
          file: configFile.path,
          line: 0,
          content: "",
          description: "未找到从 shared/config 导入 BACKEND_URL 的语句",
        });
      }
    }
  }

  return {
    name: "BACKEND_URL 注入检查",
    passed: violations.length === 0,
    violations,
    message:
      violations.length === 0 ? "所有扩展配置文件中的 URL 已正确注入" : `发现 ${violations.length} 个 URL 注入问题`,
  };
}

function checkBuildArtifactsForPlaceholder() {
  const placeholderPattern = /__BACKEND_URL_PLACEHOLDER__/;
  const artifactDirs = [{ path: path.join(EXTENSIONS_DIR, "tracking-pixel", "dist"), label: "tracking-pixel" }];
  const violations = [];
  const existingDirs = artifactDirs.filter((dir) => fs.existsSync(dir.path));
  if (existingDirs.length === 0) {
    return {
      name: "构建产物占位符检查",
      passed: true,
      violations,
      message: "未找到构建产物，跳过占位符检查",
    };
  }
  function scanDirectory(dirPath) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(PROJECT_ROOT, fullPath);
      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (placeholderPattern.test(content)) {
            violations.push({
              file: relativePath,
              line: 0,
              content: "__BACKEND_URL_PLACEHOLDER__",
              description: "构建产物中包含 BACKEND_URL 占位符",
            });
          }
        } catch (error) {
          violations.push({
            file: relativePath,
            line: 0,
            content: "",
            description: `读取构建产物失败: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }
  }
  for (const dir of existingDirs) {
    scanDirectory(dir.path);
  }
  return {
    name: "构建产物占位符检查",
    passed: violations.length === 0,
    violations,
    message:
      violations.length === 0
        ? "构建产物中未发现 BACKEND_URL 占位符"
        : `发现 ${violations.length} 个构建产物占位符问题`,
  };
}

function main() {
  console.log("🔍 开始验证 Shopify 扩展...\n");
  console.log("=".repeat(60));
  results.push(checkForbiddenAPIs());
  results.push(checkExtensionConfigs());
  results.push(checkSourceStructure());
  results.push(checkBackendUrlInjection());
  results.push(checkBuildArtifactsForPlaceholder());
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
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  if (allPassed) {
    console.log(`\n✅ 所有检查通过 (${passedCount}/${totalCount})\n`);
    return 0;
  } else {
    console.log(`\n❌ 发现 ${results.filter((r) => !r.passed).length} 个检查项失败 (${passedCount}/${totalCount})\n`);
    return 1;
  }
}

process.exit(main());
