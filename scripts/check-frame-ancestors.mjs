#!/usr/bin/env node
import { readFileSync } from "fs";
import { join } from "path";

const checks = [];
let hasErrors = false;

function checkFrameAncestors() {
  const securityHeadersFile = join(process.cwd(), "app/utils/security-headers.ts");
  try {
    const content = readFileSync(securityHeadersFile, "utf-8");
    
    const cspDirectivesMatch = content.match(/export const NON_EMBEDDED_PAGE_CSP_DIRECTIVES\s*:\s*Record<string,\s*string\[\]>\s*=\s*\{([^}]+)\}/s);
    if (!cspDirectivesMatch) {
      checks.push({
        name: "Frame Ancestors CSP Check",
        status: "fail",
        message: "NON_EMBEDDED_PAGE_CSP_DIRECTIVES object literal not found",
      });
      hasErrors = true;
      return;
    }
    
    const objectBody = cspDirectivesMatch[1];
    const frameAncestorsMatch = objectBody.match(/"frame-ancestors"\s*:\s*\[([^\]]+)\]/);
    if (!frameAncestorsMatch) {
      checks.push({
        name: "Frame Ancestors CSP Check",
        status: "fail",
        message: "frame-ancestors directive not found in NON_EMBEDDED_PAGE_CSP_DIRECTIVES object literal",
      });
      hasErrors = true;
      return;
    }
    
    const frameAncestorsArrayContent = frameAncestorsMatch[1];
    const arrayValues = frameAncestorsArrayContent
      .split(",")
      .map(v => v.trim().replace(/^["']|["']$/g, ""))
      .filter(v => v.length > 0);
    
    const hasAdminShopify = arrayValues.includes("https://admin.shopify.com");
    const hasShopDomainPattern = arrayValues.some(v => 
      v.includes("myshopify.com") || 
      v.includes("shopDomain") ||
      v.includes("shop-domain")
    );
    const hasSelf = arrayValues.includes("'self'") || arrayValues.includes('"self"');
    
    if (!hasAdminShopify) {
      checks.push({
        name: "Frame Ancestors CSP Check",
        status: "fail",
        message: "frame-ancestors must include https://admin.shopify.com",
      });
      hasErrors = true;
    }
    
    if (!hasShopDomainPattern && !hasSelf) {
      checks.push({
        name: "Frame Ancestors CSP Check",
        status: "warn",
        message: "frame-ancestors should include shop domain pattern or 'self' for embedded app compatibility",
      });
    }
    
    if (hasAdminShopify && (hasShopDomainPattern || hasSelf)) {
      checks.push({
        name: "Frame Ancestors CSP Check",
        status: "pass",
        message: "frame-ancestors correctly configured with admin.shopify.com and shop domain support",
      });
    } else if (hasAdminShopify) {
      checks.push({
        name: "Frame Ancestors CSP Check",
        status: "pass",
        message: "frame-ancestors includes admin.shopify.com (shop domain handled dynamically by Shopify)",
      });
    }
  } catch (error) {
    checks.push({
      name: "Frame Ancestors CSP Check",
      status: "fail",
      message: `Failed to read security-headers.ts: ${error.message}`,
    });
    hasErrors = true;
  }
}

function checkEmbeddedAppHeaders() {
  const entryServerFile = join(process.cwd(), "app/entry.server.tsx");
  try {
    const content = readFileSync(entryServerFile, "utf-8");
    
    const hasEmbeddedHeaders = content.includes("EMBEDDED_APP_HEADERS");
    const hasAddDocumentResponseHeaders = content.includes("addDocumentResponseHeaders");
    
    if (!hasEmbeddedHeaders || !hasAddDocumentResponseHeaders) {
      checks.push({
        name: "Embedded App Headers Check",
        status: "warn",
        message: "entry.server.tsx should use EMBEDDED_APP_HEADERS and addDocumentResponseHeaders for embedded app pages",
      });
    } else {
      checks.push({
        name: "Embedded App Headers Check",
        status: "pass",
        message: "Embedded app headers correctly configured",
      });
    }
  } catch (error) {
    checks.push({
      name: "Embedded App Headers Check",
      status: "fail",
      message: `Failed to read entry.server.tsx: ${error.message}`,
    });
    hasErrors = true;
  }
}

function checkSecurityHeadersValidation() {
  const securityHeadersFile = join(process.cwd(), "app/utils/security-headers.ts");
  try {
    const content = readFileSync(securityHeadersFile, "utf-8");
    
    const hasValidation = content.includes("validateSecurityHeaders");
    const hasFrameAncestorsCheck = content.includes("frame-ancestors") && 
                                    (content.includes("validateSecurityHeaders") || 
                                     content.includes("EMBEDDED_APP_HEADERS"));
    
    if (!hasValidation) {
      checks.push({
        name: "Security Headers Validation Check",
        status: "warn",
        message: "validateSecurityHeaders function should validate frame-ancestors configuration",
      });
    } else {
      checks.push({
        name: "Security Headers Validation Check",
        status: "pass",
        message: "Security headers validation function exists",
      });
    }
  } catch (error) {
    checks.push({
      name: "Security Headers Validation Check",
      status: "fail",
      message: `Failed to read security-headers.ts: ${error.message}`,
    });
    hasErrors = true;
  }
}

checkFrameAncestors();
checkEmbeddedAppHeaders();
checkSecurityHeadersValidation();

console.log("\n=== Frame Ancestors Security Check ===\n");
checks.forEach(check => {
  const icon = check.status === "pass" ? "✅" : check.status === "warn" ? "⚠️" : "❌";
  console.log(`${icon} ${check.name}: ${check.message}`);
});

if (hasErrors) {
  console.log("\n❌ Frame ancestors check failed. Please fix the issues above.");
  process.exit(1);
} else {
  console.log("\n✅ All frame ancestors checks passed.");
  process.exit(0);
}
