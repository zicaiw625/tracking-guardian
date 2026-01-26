#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const checks = [];
let hasErrors = false;

const BODY_READ_PATTERNS = [
  "request\\.json\\s*\\(",
  "request\\.text\\s*\\(",
  "request\\.formData\\s*\\(",
  "request\\.arrayBuffer\\s*\\(",
  "request\\.blob\\s*\\(",
  "request\\.body",
  "request\\.bodyUsed",
  "await\\s+request\\.json",
  "await\\s+request\\.text",
  "await\\s+request\\.formData",
  "await\\s+request\\.arrayBuffer",
  "await\\s+request\\.blob",
];

const WEBHOOK_AUTH_PATTERN = "authenticate\\.webhook\\s*\\(";

function getAllRouteFiles(dir, fileList = []) {
  try {
    const files = readdirSync(dir);
    for (const file of files) {
      const filePath = join(dir, file);
      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        getAllRouteFiles(filePath, fileList);
      } else if (file.endsWith(".tsx") || file.endsWith(".ts")) {
        fileList.push(filePath);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  return fileList;
}

function findWebhookAuthPosition(content) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(WEBHOOK_AUTH_PATTERN).test(lines[i])) {
      return i;
    }
  }
  return -1;
}

function findBodyReadBeforePosition(content, beforeLine) {
  const lines = content.split("\n");
  const bodyReadPatterns = BODY_READ_PATTERNS.map(pattern => new RegExp(pattern));
  
  for (let i = 0; i < beforeLine && i < lines.length; i++) {
    for (const pattern of bodyReadPatterns) {
      if (pattern.test(lines[i])) {
        return { line: i + 1, content: lines[i].trim() };
      }
    }
  }
  return null;
}

function checkWebhookFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const fileName = filePath.split("/").pop() || "";
  
  if (!content.includes("authenticate.webhook")) {
    return;
  }
  
  const authLine = findWebhookAuthPosition(content);
  if (authLine === -1) {
    return;
  }
  
  const bodyRead = findBodyReadBeforePosition(content, authLine);
  if (bodyRead) {
    checks.push({
      name: `Webhook Route: ${fileName}`,
      status: "fail",
      message: `Body read operation found at line ${bodyRead.line} before authenticate.webhook at line ${authLine + 1}: "${bodyRead.content}". Shopify webhook HMAC verification requires the raw body - do not read the body before authenticate.webhook(request).`,
    });
    hasErrors = true;
    return;
  }
  
  checks.push({
    name: `Webhook Route: ${fileName}`,
    status: "pass",
    message: "No body read operations found before authenticate.webhook",
  });
}

function checkWebhookRoutes() {
  const routesDir = join(process.cwd(), "app/routes");
  const routeFiles = getAllRouteFiles(routesDir);
  
  if (routeFiles.length === 0) {
    checks.push({
      name: "Webhook Body Check",
      status: "warn",
      message: "No route files found",
    });
    return;
  }
  
  for (const file of routeFiles) {
    try {
      checkWebhookFile(file);
    } catch (error) {
      checks.push({
        name: `Webhook Route: ${file.split("/").pop()}`,
        status: "fail",
        message: `Failed to check file: ${error.message}`,
      });
      hasErrors = true;
    }
  }
}

checkWebhookRoutes();

console.log("\n=== Webhook Body Protection Check ===\n");
checks.forEach(check => {
  const icon = check.status === "pass" ? "✅" : check.status === "warn" ? "⚠️" : "❌";
  console.log(`${icon} ${check.name}: ${check.message}`);
});

if (hasErrors) {
  console.log("\n❌ Webhook body protection check failed. Do not read the request body before authenticate.webhook(request).");
  process.exit(1);
} else {
  console.log("\n✅ All webhook routes properly protect the request body.");
  process.exit(0);
}
