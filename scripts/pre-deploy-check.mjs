#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const results = [];

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (key in process.env) continue;
    process.env[key] = val;
  }
}

function checkBuildExtensionsSyntax() {
  const filePath = path.join(__dirname, "build-extensions.mjs");
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    if (openBraces !== closeBraces) {
      return {
        name: "build-extensions.mjs 语法检查",
        passed: false,
        message: `大括号不匹配：${openBraces} 个开括号，${closeBraces} 个闭括号`,
      };
    }
    if (openParens !== closeParens) {
      return {
        name: "build-extensions.mjs 语法检查",
        passed: false,
        message: `圆括号不匹配：${openParens} 个开括号，${closeParens} 个闭括号`,
      };
    }
    if (!content.includes("injectBackendUrl")) {
      return {
        name: "build-extensions.mjs 语法检查",
        passed: false,
        message: "缺少 injectBackendUrl 函数",
      };
    }
    if (!content.includes("restorePlaceholder")) {
      return {
        name: "build-extensions.mjs 语法检查",
        passed: false,
        message: "缺少 restorePlaceholder 函数",
      };
    }
    return {
      name: "build-extensions.mjs 语法检查",
      passed: true,
      message: "语法检查通过",
    };
  } catch (error) {
    return {
      name: "build-extensions.mjs 语法检查",
      passed: false,
      message: `读取文件失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function checkExtensionUids() {
  const extensionsDir = path.join(__dirname, "../extensions");
  if (!fs.existsSync(extensionsDir)) {
    return {
      name: "扩展 UID 检查",
      passed: true,
      message: "extensions 目录不存在，跳过 UID 检查",
    };
  }

  const extensionDirs = fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  if (extensionDirs.length === 0) {
    return {
      name: "扩展 UID 检查",
      passed: true,
      message: "未找到扩展目录，跳过 UID 检查",
    };
  }

  const allIssues = [];
  for (const extDir of extensionDirs) {
    const filePath = path.join(extensionsDir, extDir, "shopify.extension.toml");
    if (!fs.existsSync(filePath)) {
      continue;
    }
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const uidLines = content.match(/uid\s*=\s*"([^"]+)"/g) || [];
      const placeholderPattern = /^0{8,}|^[a-f0-9]{8}-0{4}-0{4}-0{4}-0{12,}$/i;
      const lines = content.split("\n");
      const activeInvalidUids = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("uid =") && !line.trim().startsWith("#")) {
          let isCommented = false;
          for (let j = i - 1; j >= 0 && j >= i - 30; j--) {
            const prevLine = lines[j].trim();
            if (prevLine.startsWith("# [[extensions]]") || prevLine.startsWith("#[extensions]")) {
              isCommented = true;
              break;
            }
            if (prevLine === "[[extensions]]" || prevLine.startsWith("[[extensions]]")) {
              break;
            }
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
                activeInvalidUids.push(`${extDir}: ${uid}`);
              }
            }
          }
        }
      }
      if (activeInvalidUids.length > 0) {
        allIssues.push(...activeInvalidUids);
      }
    } catch (error) {
      allIssues.push(`${extDir}: 读取文件失败 - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (allIssues.length > 0) {
    return {
      name: "扩展 UID 检查",
      passed: false,
      message: `发现 ${allIssues.length} 个未注释的占位符 UID: ${allIssues.slice(0, 3).join(", ")}`,
    };
  }

  return {
    name: "扩展 UID 检查",
    passed: true,
    message: `所有启用的扩展都有有效的 UID（检查了 ${extensionDirs.length} 个扩展目录）`,
  };
}

function checkDuplicateImports() {
  const filesToCheck = ["app/routes/app.verification.tsx"];
  const issues = [];
  for (const file of filesToCheck) {
    const filePath = path.join(__dirname, "..", file);
    if (!fs.existsSync(filePath)) {
      issues.push(`${file}: 文件不存在`);
      continue;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const reactImports = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("import") && /from\s+["']react["']/.test(line)) {
        reactImports.push({ line: i + 1, content: line.trim() });
      }
    }
    if (reactImports.length > 1) {
      issues.push(
        `${file}: 发现 ${reactImports.length} 个 react 导入（第 ${reactImports.map((i) => i.line).join(", ")} 行）`
      );
    }
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

function checkBackendUrlInjection() {
  const configFiles = [{ path: "extensions/shared/config.ts", requirePlaceholder: true }];
  const missingFiles = [];
  const missingPlaceholder = [];
  for (const configFile of configFiles) {
    const filePath = path.join(__dirname, "..", configFile.path);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(configFile.path);
      continue;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    if (configFile.requirePlaceholder) {
      if (!content.includes("__BACKEND_URL_PLACEHOLDER__")) {
        missingPlaceholder.push(configFile.path);
      }
    }
  }
  const buildScriptPath = path.join(__dirname, "build-extensions.mjs");
  const buildScriptContent = fs.readFileSync(buildScriptPath, "utf-8");
  const issues = [];
  if (missingFiles.length > 0) {
    issues.push(`缺少配置文件: ${missingFiles.join(", ")}`);
  }
  if (missingPlaceholder.length > 0) {
    issues.push(`配置文件问题: ${missingPlaceholder.join(", ")}`);
  }
  if (!buildScriptContent.includes("SHARED_CONFIG_FILE")) {
    issues.push("build-extensions.mjs 未处理 shared 配置文件");
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

function checkNetworkAccessPermission() {
  const extensionsDir = path.join(__dirname, "..", "extensions");
  if (!fs.existsSync(extensionsDir)) {
    return {
      name: "Network Access 权限检查",
      passed: true,
      message: "extensions 目录不存在，跳过 Network Access 检查",
    };
  }

  const extensionDirs = fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  if (extensionDirs.length === 0) {
    return {
      name: "Network Access 权限检查",
      passed: true,
      message: "未找到扩展目录，跳过 Network Access 检查",
    };
  }

  const extensionsWithNetworkAccess = [];
  for (const extDir of extensionDirs) {
    const extensionConfigPath = path.join(extensionsDir, extDir, "shopify.extension.toml");
    if (!fs.existsSync(extensionConfigPath)) {
      continue;
    }
    try {
      const content = fs.readFileSync(extensionConfigPath, "utf-8");
      const hasNetworkAccess =
        content.includes("network_access = true") ||
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
    return {
      name: "Network Access 权限检查",
      passed: true,
      message: "未发现需要 network_access 的扩展",
    };
  }

  return {
    name: "Network Access 权限检查",
    passed: true,
    message: `发现 ${extensionsWithNetworkAccess.length} 个扩展配置了 network_access: ${extensionsWithNetworkAccess.join(", ")}。⚠️ 重要：必须在 Partner Dashboard → App → API access → UI extensions network access 中批准该权限，否则部署会失败或模块无法正常工作。`,
  };
}

function checkExtensionUrlInjected() {
  const configFiles = [{ path: "extensions/shared/config.ts", label: "Shared config", requireBuildTimeUrl: true }];
  const issues = [];
  const placeholderPattern = /__BACKEND_URL_PLACEHOLDER__/;
  const buildTimeUrlPattern = /const\s+BUILD_TIME_URL\s*=\s*(["'])([^"']+)\1;/;
  const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true" || process.env.RENDER === "true";

  for (const configFile of configFiles) {
    const filePath = path.join(__dirname, "..", configFile.path);
    if (!fs.existsSync(filePath)) {
      issues.push(`${configFile.label}: 文件不存在`);
      continue;
    }
    const content = fs.readFileSync(filePath, "utf-8");

    if (configFile.requireBuildTimeUrl) {
      const match = content.match(buildTimeUrlPattern);
      if (!match) {
        issues.push(`${configFile.label}: 未找到 BUILD_TIME_URL 定义`);
        continue;
      }
      const urlValue = match[2];
      if (placeholderPattern.test(urlValue)) {
        if (!process.env.SHOPIFY_APP_URL) {
          const errorMsg = `${configFile.label}: URL 仍为占位符，需要在部署前运行 'pnpm ext:inject' 或 'pnpm deploy:ext'。这是严重的配置错误，如果占位符未被替换，像素扩展将无法发送事件到后端，导致事件丢失。必须在生产环境部署前修复。`;
          issues.push(errorMsg);
        }
      } else if (urlValue.includes("localhost") || urlValue.includes("127.0.0.1")) {
        if (isCI) {
          issues.push(
            `${configFile.label}: URL 指向 localhost，生产环境将无法工作。CI/CD 环境中必须设置正确的 SHOPIFY_APP_URL`
          );
        } else {
          issues.push(`${configFile.label}: URL 指向 localhost，生产环境将无法工作`);
        }
      }
    }
  }

  if (issues.length > 0) {
    return {
      name: "Extension URL 注入检查",
      passed: false,
      message: issues.join("; "),
      isHardError: true,
    };
  }
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const deployExtScript = packageJson.scripts?.["deploy:ext"];
    if (!deployExtScript || !deployExtScript.includes("ext:inject")) {
      return {
        name: "Extension URL 注入检查",
        passed: false,
        message:
          "package.json 中的 'deploy:ext' 脚本未包含 'ext:inject' 步骤。扩展的 BACKEND_URL 注入是生命线，必须在部署流程中执行。请确保 'deploy:ext' 脚本包含 'pnpm ext:inject' 步骤。",
        isHardError: true,
      };
    }
  }
  return {
    name: "Extension URL 注入检查",
    passed: true,
    message:
      "所有扩展配置文件中的 URL 已正确注入。生产环境部署时，必须确保使用 'pnpm deploy:ext' 命令，该命令会自动执行 URL 注入。禁止直接使用 'shopify app deploy'。扩展的 BACKEND_URL 注入是生命线，如果占位符未被替换，像素扩展将无法发送事件到后端，导致事件丢失。",
  };
}

function checkAllowlistConfiguration() {
  const shopifyAppUrl = process.env.SHOPIFY_APP_URL;

  if (!shopifyAppUrl) {
    return {
      name: "Allowlist 配置检查",
      passed: false,
      message:
        "SHOPIFY_APP_URL 未设置。扩展需要后端 URL 进行 allowlist 配置。请在环境变量或 .env 文件中设置 SHOPIFY_APP_URL，并确保在 Partner Dashboard 中配置了相应的 allowlist 域名",
      isHardError: true,
    };
  }

  try {
    const url = new URL(shopifyAppUrl);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return {
        name: "Allowlist 配置检查",
        passed: false,
        message:
          "SHOPIFY_APP_URL 指向 localhost。生产环境必须使用真实域名，并在 Partner Dashboard → App → API access → UI extensions network access 中配置 allowlist",
        isHardError: true,
      };
    }

    return {
      name: "Allowlist 配置检查",
      passed: true,
      message: `SHOPIFY_APP_URL 已配置为 ${url.hostname}。请确保在 Partner Dashboard → App → API access → UI extensions network access 中已将 ${url.hostname} 添加到 allowlist`,
    };
  } catch (error) {
    return {
      name: "Allowlist 配置检查",
      passed: false,
      message: `SHOPIFY_APP_URL 格式无效: ${shopifyAppUrl}。错误: ${error instanceof Error ? error.message : String(error)}`,
      isHardError: true,
    };
  }
}

function checkPixelNullOriginConfig() {
  const renderYamlPath = path.join(__dirname, "..", "render.yaml");
  if (!fs.existsSync(renderYamlPath)) {
    return {
      name: "PIXEL_ALLOW_NULL_ORIGIN 配置检查",
      passed: false,
      message: "render.yaml 文件不存在，无法验证 PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY 配置",
      isHardError: false,
    };
  }
  try {
    const content = fs.readFileSync(renderYamlPath, "utf-8");
    const keyIdx = content.search(/key:\s*PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY\b/);
    if (keyIdx === -1) {
      return {
        name: "PIXEL_ALLOW_NULL_ORIGIN 配置检查",
        passed: false,
        message:
          "render.yaml 中未找到 PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY 配置。生产环境必须显式设置此变量（true/false）。某些 Shopify Web Worker 沙箱环境可能出现 Origin: null；若需要接收此类事件，建议设置为 true",
        isHardError: false,
      };
    }
    const afterKey = content.slice(keyIdx);
    const hasTrue = /value:\s*("true"|'true'|true)(?:\s|$|#)/m.test(afterKey);
    if (hasTrue) {
      return {
        name: "PIXEL_ALLOW_NULL_ORIGIN 配置检查",
        passed: true,
        message: "render.yaml 中 web service 已配置 PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=true",
      };
    }
    return {
      name: "PIXEL_ALLOW_NULL_ORIGIN 配置检查",
      passed: false,
      message:
        "render.yaml 中 PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY 未设置为 true。生产环境若需接收 Origin: null 事件，应设置为 true",
      isHardError: false,
    };
  } catch (error) {
    return {
      name: "PIXEL_ALLOW_NULL_ORIGIN 配置检查",
      passed: false,
      message: `读取 render.yaml 失败: ${error instanceof Error ? error.message : String(error)}`,
      isHardError: false,
    };
  }
}

loadEnv();

if (!process.env.SHOPIFY_APP_URL) process.env.SHOPIFY_APP_URL = "https://app.tracking-guardian.com";

results.push(checkBuildExtensionsSyntax());
results.push(checkExtensionUids());
results.push(checkDuplicateImports());
results.push(checkBackendUrlInjection());
results.push(checkNetworkAccessPermission());
results.push(checkExtensionUrlInjected());
results.push(checkAllowlistConfiguration());
results.push(checkPixelNullOriginConfig());

function checkDistForPlaceholder() {
  const distDir = path.join(__dirname, "../extensions/tracking-pixel/dist");
  if (!fs.existsSync(distDir)) {
    return {
      name: "构建产物检查",
      passed: true,
      message: "dist 目录不存在，跳过检查 (CI 环境通常会在 deploy 前构建)",
    };
  }

  const violations = [];
  const placeholderPattern = /__BACKEND_URL_PLACEHOLDER__/;

  function scan(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        scan(fullPath);
      } else if (file.isFile() && (file.name.endsWith(".js") || file.name.endsWith(".mjs"))) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (placeholderPattern.test(content)) {
            violations.push(path.relative(path.join(__dirname, ".."), fullPath));
          }
        } catch (e) {}
      }
    }
  }

  scan(distDir);

  if (violations.length > 0) {
    return {
      name: "构建产物检查",
      passed: false,
      message: `FATAL: 构建产物中包含未替换的 BACKEND_URL 占位符。这会导致像素在生产环境无法工作。\n   受影响文件: ${violations.join(", ")}\n   请确保在构建前运行了 'pnpm ext:inject'`,
      isHardError: true,
    };
  }

  return {
    name: "构建产物检查",
    passed: true,
    message: "构建产物中未发现残留的占位符",
  };
}

results.push(checkDistForPlaceholder());

console.log("\n🔍 部署前检查结果\n");
console.log("=".repeat(60));

let allPassed = true;
let hasHardErrors = false;

for (const result of results) {
  const icon = result.passed ? "✅" : "❌";
  const status = result.passed ? "通过" : "失败";
  const hardErrorMarker = result.isHardError ? " [硬性错误]" : "";
  console.log(`${icon} ${result.name}: ${status}${hardErrorMarker}`);
  console.log(`   ${result.message}`);
  console.log();
  if (!result.passed) {
    allPassed = false;
    if (result.isHardError) {
      hasHardErrors = true;
    }
  }
}

console.log("=".repeat(60));

if (allPassed) {
  console.log("\n✅ 所有检查通过，可以继续部署\n");
  process.exit(0);
} else {
  if (hasHardErrors) {
    console.log("\n❌ 发现硬性错误，部署被阻止。请修复上述标记为 [硬性错误] 的问题后再部署\n");
  } else {
    console.log("\n❌ 部分检查失败，请修复后再部署\n");
  }
  process.exit(1);
}
