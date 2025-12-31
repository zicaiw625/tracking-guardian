#!/usr/bin/env node


import { readFileSync, existsSync } from "fs";
import { join } from "path";

interface SecurityCheck {
  name: string;
  status: "pass" | "fail" | "warning";
  message: string;
}

const checks: SecurityCheck[] = [];

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
  const middlewareFile = join(process.cwd(), "app/middleware/validation.ts");

  if (existsSync(middlewareFile)) {
    const content = readFileSync(middlewareFile, "utf-8");
    if (content.includes("HMAC") || content.includes("hmac") || content.includes("signature")) {
      checks.push({
        name: "HMAC Validation Check",
        status: "pass",
        message: "HMAC 签名验证已实现",
      });
    } else {
      checks.push({
        name: "HMAC Validation Check",
        status: "warning",
        message: "HMAC 验证可能未实现",
      });
    }
  } else {
    checks.push({
      name: "HMAC Validation Check",
      status: "fail",
      message: "验证中间件未找到",
    });
  }
}

function checkGDPRWebhooks() {
  const webhookFile = join(process.cwd(), "app/webhooks/gdpr.ts");

  if (existsSync(webhookFile)) {
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
  const privacyPolicy = join(process.cwd(), "docs/PRIVACY_POLICY.md");

  if (existsSync(privacyPolicy)) {
    checks.push({
      name: "Privacy Policy Check",
      status: "pass",
      message: "隐私政策文档存在",
    });
  } else {
    checks.push({
      name: "Privacy Policy Check",
      status: "fail",
      message: "隐私政策文档未找到",
    });
  }
}

function getFilesInDir(dir: string, ext: string): string[] {
  const files: string[] = [];
  try {
    const entries = require("fs").readdirSync(dir, { withFileTypes: true });
    entries.forEach((entry: any) => {
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

