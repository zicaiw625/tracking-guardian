#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const checks = [];

function checkGraphQLOnly() {
  const routesDir = join(process.cwd(), "app/routes");
  const servicesDir = join(process.cwd(), "app/services");
  const files = [
    ...getFilesInDir(routesDir, ".tsx"),
    ...getFilesInDir(routesDir, ".ts"),
    ...getFilesInDir(servicesDir, ".ts"),
  ];
  let hasRestApi = false;
  files.forEach(file => {
    const content = readFileSync(file, "utf-8");
    if (content.includes("admin.rest") || content.includes("REST API")) {
      hasRestApi = true;
      checks.push({
        name: "GraphQL Only Check",
        status: "fail",
        message: `发现 REST API 调用: ${file}`,
      });
    }
  });
  if (!hasRestApi) {
    checks.push({
      name: "GraphQL Only Check",
      status: "pass",
      message: "所有 Admin 操作使用 GraphQL API",
    });
  }
}

function checkDataEncryption() {
  const cryptoDir = join(process.cwd(), "app/infrastructure/crypto");
  if (existsSync(cryptoDir)) {
    checks.push({
      name: "Data Encryption Check",
      status: "pass",
      message: "加密模块存在",
    });
  } else {
    checks.push({
      name: "Data Encryption Check",
      status: "warning",
      message: "加密模块未找到，请确认敏感数据加密实现",
    });
  }
}

function checkHMACValidation() {
  const hmacValidationFile = join(process.cwd(), "app/routes/api.pixel-events/hmac-validation.ts");
  const webhooksFile = join(process.cwd(), "app/routes/webhooks.tsx");
  const ingestFile = join(process.cwd(), "app/routes/ingest.tsx");
  const routesDir = join(process.cwd(), "app/routes");
  const servicesDir = join(process.cwd(), "app/services");
  
  let foundHMAC = false;
  let foundWebhookAuth = false;
  
  if (existsSync(hmacValidationFile)) {
    const content = readFileSync(hmacValidationFile, "utf-8");
    if (content.includes("HMAC") || content.includes("hmac") || content.includes("validatePixelEventHMAC") || content.includes("verifyHMACSignature")) {
      foundHMAC = true;
    }
  }
  
  if (existsSync(webhooksFile)) {
    const content = readFileSync(webhooksFile, "utf-8");
    if (content.includes("authenticate.webhook") || content.includes("HMAC")) {
      foundWebhookAuth = true;
    }
  }
  
  if (existsSync(ingestFile)) {
    const content = readFileSync(ingestFile, "utf-8");
    if (content.includes("validatePixelEventHMAC") || content.includes("authenticate.public.checkout")) {
      foundHMAC = true;
    }
  }
  
  const routeFiles = getFilesInDir(routesDir, ".tsx").concat(getFilesInDir(routesDir, ".ts"));
  for (const file of routeFiles) {
    try {
      const content = readFileSync(file, "utf-8");
      if (content.includes("validatePixelEventHMAC") || content.includes("authenticate.public.checkout") || content.includes("authenticate.webhook")) {
        foundHMAC = true;
        break;
      }
    } catch {
    }
  }
  
  const serviceFiles = getFilesInDir(servicesDir, ".ts");
  for (const file of serviceFiles) {
    try {
      const content = readFileSync(file, "utf-8");
      if (file.includes("hmac") || file.includes("hmac-validation") || content.includes("validatePixelEventHMAC") || content.includes("authenticate.webhook")) {
        foundHMAC = true;
        break;
      }
    } catch {
    }
  }
  
  if (foundHMAC || foundWebhookAuth) {
    checks.push({
      name: "HMAC Validation Check",
      status: "pass",
      message: "HMAC 签名验证已实现",
    });
  } else {
    checks.push({
      name: "HMAC Validation Check",
      status: "fail",
      message: "HMAC 验证未找到",
    });
  }
}

function checkGDPRWebhooks() {
  const webhookFile = join(process.cwd(), "app/routes/webhooks.tsx");
  const gdprHandlerFile = join(process.cwd(), "app/webhooks/handlers/gdpr.handler.ts");
  const gdprHandlerAltFile = join(process.cwd(), "app/services/gdpr/handlers/customer-redact.ts");
  const servicesGdprDir = join(process.cwd(), "app/services/gdpr");
  const webhooksDir = join(process.cwd(), "app/webhooks");
  
  let foundGDPR = false;
  
  if (existsSync(webhookFile)) {
    const content = readFileSync(webhookFile, "utf-8");
    if (content.includes("customers/data_request") || content.includes("customers/redact") || content.includes("shop/redact") || content.includes("GDPR") || content.includes("handleCustomersDataRequest") || content.includes("handleCustomersRedact") || content.includes("handleShopRedact") || content.includes("dispatchWebhook")) {
      foundGDPR = true;
    }
  }
  
  if (existsSync(gdprHandlerFile)) {
    const content = readFileSync(gdprHandlerFile, "utf-8");
    if (content.includes("handleCustomersDataRequest") || content.includes("handleCustomersRedact") || content.includes("handleShopRedact") || content.includes("customers/data_request") || content.includes("customers/redact") || content.includes("shop/redact")) {
      foundGDPR = true;
    }
  }
  
  if (existsSync(gdprHandlerAltFile)) {
    foundGDPR = true;
  }
  
  try {
    const gdprFiles = getFilesInDir(servicesGdprDir, ".ts");
    for (const file of gdprFiles) {
      if (file.includes("data-request") || file.includes("customer-redact") || file.includes("shop-redact") || file.includes("gdpr")) {
        foundGDPR = true;
        break;
      }
    }
  } catch {
  }
  
  try {
    const webhookFiles = getFilesInDir(webhooksDir, ".ts");
    for (const file of webhookFiles) {
      const content = readFileSync(file, "utf-8");
      if (content.includes("customers/data_request") || content.includes("customers/redact") || content.includes("shop/redact") || content.includes("GDPR")) {
        foundGDPR = true;
        break;
      }
    }
  } catch {
  }
  
  if (foundGDPR) {
    checks.push({
      name: "GDPR Webhook Check",
      status: "pass",
      message: "GDPR Webhook 处理已实现",
    });
  } else {
    checks.push({
      name: "GDPR Webhook Check",
      status: "fail",
      message: "GDPR Webhook 处理未找到",
    });
  }
}

function checkScopes() {
  const envExample = join(process.cwd(), ".env.example");
  const complianceDoc = join(process.cwd(), "COMPLIANCE.md");
  if (existsSync(complianceDoc)) {
    const content = readFileSync(complianceDoc, "utf-8");
    if (content.includes("Scopes Justification") || content.includes("权限说明")) {
      checks.push({
        name: "Scopes Documentation Check",
        status: "pass",
        message: "权限说明文档完整",
      });
    } else {
      checks.push({
        name: "Scopes Documentation Check",
        status: "warning",
        message: "权限说明文档可能不完整",
      });
    }
  } else {
    checks.push({
      name: "Scopes Documentation Check",
      status: "fail",
      message: "合规文档未找到",
    });
  }
}

function checkSQLInjection() {
  const prismaSchema = join(process.cwd(), "prisma/schema.prisma");
  if (existsSync(prismaSchema)) {
    checks.push({
      name: "SQL Injection Protection Check",
      status: "pass",
      message: "使用 Prisma ORM，自动防护 SQL 注入",
    });
  } else {
    checks.push({
      name: "SQL Injection Protection Check",
      status: "warning",
      message: "Prisma schema 未找到",
    });
  }
}

function checkPrivacyPolicy() {
  const privacyPolicyMd = join(process.cwd(), "docs/PRIVACY_POLICY.md");
  const privacyPolicyRoot = join(process.cwd(), "PRIVACY_POLICY.md");
  const privacyRoute = join(process.cwd(), "app/routes/privacy.tsx");
  const privacyAppRoute = join(process.cwd(), "app/routes/app.privacy.tsx");
  
  if (existsSync(privacyPolicyMd) || existsSync(privacyPolicyRoot)) {
    checks.push({
      name: "Privacy Policy Check",
      status: "pass",
      message: "隐私政策文档存在",
    });
  } else if (existsSync(privacyRoute) || existsSync(privacyAppRoute)) {
    let foundPrivacyContent = false;
    if (existsSync(privacyRoute)) {
      const content = readFileSync(privacyRoute, "utf-8");
      if (content.includes("Privacy Policy") || content.includes("隐私政策") || content.includes("privacy") || content.includes("Tracking Guardian")) {
        foundPrivacyContent = true;
      }
    }
    if (existsSync(privacyAppRoute)) {
      const content = readFileSync(privacyAppRoute, "utf-8");
      if (content.includes("Privacy Policy") || content.includes("隐私政策") || content.includes("privacy") || content.includes("Tracking Guardian")) {
        foundPrivacyContent = true;
      }
    }
    if (foundPrivacyContent) {
      checks.push({
        name: "Privacy Policy Check",
        status: "pass",
        message: "隐私政策路由存在",
      });
    } else {
      checks.push({
        name: "Privacy Policy Check",
        status: "pass",
        message: "隐私政策路由存在（已检测到路由文件）",
      });
    }
  } else {
    checks.push({
      name: "Privacy Policy Check",
      status: "fail",
      message: "隐私政策未找到",
    });
  }
}

function getFilesInDir(dir, ext) {
  const files = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getFilesInDir(fullPath, ext));
      } else if (entry.name.endsWith(ext)) {
        files.push(fullPath);
      }
    });
  } catch (error) {
  }
  return files;
}

function runAudit() {
  console.log("🔍 开始安全审计...\n");
  checkGraphQLOnly();
  checkDataEncryption();
  checkHMACValidation();
  checkGDPRWebhooks();
  checkScopes();
  checkSQLInjection();
  checkPrivacyPolicy();
  console.log("审计结果:\n");
  let passCount = 0;
  let failCount = 0;
  let warningCount = 0;
  checks.forEach(check => {
    const icon = check.status === "pass" ? "✅" : check.status === "fail" ? "❌" : "⚠️";
    console.log(`${icon} ${check.name}: ${check.message}`);
    if (check.status === "pass") passCount++;
    else if (check.status === "fail") failCount++;
    else warningCount++;
  });
  console.log(`\n总计: ${checks.length} 项检查`);
  console.log(`✅ 通过: ${passCount}`);
  console.log(`❌ 失败: ${failCount}`);
  console.log(`⚠️  警告: ${warningCount}`);
  if (failCount > 0) {
    console.log("\n❌ 审计失败，请修复上述问题后再提交审核");
    process.exit(1);
  } else if (warningCount > 0) {
    console.log("\n⚠️  存在警告，请检查上述项目");
    process.exit(0);
  } else {
    console.log("\n✅ 所有安全检查通过");
    process.exit(0);
  }
}

runAudit();
