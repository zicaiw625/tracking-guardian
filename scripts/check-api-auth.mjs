#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const checks = [];
let hasErrors = false;

const AUTH_PATTERNS = [
  "authenticate.admin",
  "authenticate.webhook",
  "authenticatePublic",
  "validateCronAuth",
  "validatePerformanceAuth",
  "validateDetailedHealthAuth",
];

const WHITELIST = [
  "api.health",
  "api.cron",
  "api.performance",
  "api.extension-errors",
  "api.tracking",
  "ingest",
];

function getAllRouteFiles(dir, fileList = []) {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      getAllRouteFiles(filePath, fileList);
    } else if (file.endsWith(".tsx") || file.endsWith(".ts")) {
      if (file.startsWith("api.") || file === "ingest.tsx") {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

function getAllApiRouteFiles(dir, fileList = []) {
  try {
    const files = readdirSync(dir);
    for (const file of files) {
      const filePath = join(dir, file);
      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        getAllApiRouteFiles(filePath, fileList);
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

function extractForwardedRoute(content) {
  const importMatch = content.match(/import\(["']\.\.\/lib\/api-routes\/([^"']+)["']\)/);
  if (importMatch) {
    return importMatch[1];
  }
  return null;
}

function checkRouteAuth(filePath, isApiRouteFile = false) {
  const content = readFileSync(filePath, "utf-8");
  const fileName = filePath.split("/").pop() || "";
  const routeName = fileName.replace(/\.(tsx|ts)$/, "");
  
  if (!isApiRouteFile && WHITELIST.some(w => routeName.includes(w))) {
    checks.push({
      name: `API Route: ${routeName}`,
      status: "pass",
      message: "Route is in whitelist (has explicit auth)",
    });
    return;
  }
  
  const forwardedRoute = !isApiRouteFile ? extractForwardedRoute(content) : null;
  if (forwardedRoute) {
    const apiRoutePath = join(process.cwd(), "app/lib/api-routes", forwardedRoute);
    try {
      if (statSync(apiRoutePath).isFile()) {
        checkRouteAuth(apiRoutePath, true);
        checks.push({
          name: `API Route: ${routeName}`,
          status: "pass",
          message: `Forwards to app/lib/api-routes/${forwardedRoute} (auth checked in forwarded file)`,
        });
        return;
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  
  const hasLoader = content.includes("export const loader") || content.includes("export const action");
  if (!hasLoader) {
    checks.push({
      name: `API Route: ${routeName}${isApiRouteFile ? " (in app/lib/api-routes)" : ""}`,
      status: "warn",
      message: "Route has no loader/action exports",
    });
    return;
  }
  
  const loaderMatch = content.match(/export\s+(const|async\s+function)\s+loader[^{]*\{[^}]*\}/s);
  const actionMatch = content.match(/export\s+(const|async\s+function)\s+action[^{]*\{[^}]*\}/s);
  
  let hasAuthInLoader = false;
  let hasAuthInAction = false;
  
  if (loaderMatch) {
    const loaderContent = loaderMatch[0];
    hasAuthInLoader = AUTH_PATTERNS.some(pattern => loaderContent.includes(pattern));
  }
  
  if (actionMatch) {
    const actionContent = actionMatch[0];
    hasAuthInAction = AUTH_PATTERNS.some(pattern => actionContent.includes(pattern));
  }
  
  if (!hasAuthInLoader && !hasAuthInAction) {
    const hasLoaderExport = content.includes("export const loader") || content.includes("export async function loader");
    const hasActionExport = content.includes("export const action") || content.includes("export async function action");
    
    if (hasLoaderExport || hasActionExport) {
      checks.push({
        name: `API Route: ${routeName}${isApiRouteFile ? " (in app/lib/api-routes)" : ""}`,
        status: "fail",
        message: `Missing authentication in ${hasLoaderExport && hasActionExport ? "loader and action" : hasLoaderExport ? "loader" : "action"}. Must use one of: ${AUTH_PATTERNS.join(", ")}`,
      });
      hasErrors = true;
    }
  } else {
    const authMethods = [];
    if (hasAuthInLoader) authMethods.push("loader");
    if (hasAuthInAction) authMethods.push("action");
    checks.push({
      name: `API Route: ${routeName}${isApiRouteFile ? " (in app/lib/api-routes)" : ""}`,
      status: "pass",
      message: `Authentication found in ${authMethods.join(" and ")}`,
    });
  }
}

function checkApiRoutes() {
  const routesDir = join(process.cwd(), "app/routes");
  const routeFiles = getAllRouteFiles(routesDir);
  
  const apiRoutesDir = join(process.cwd(), "app/lib/api-routes");
  const apiRouteFiles = getAllApiRouteFiles(apiRoutesDir);
  
  if (routeFiles.length === 0 && apiRouteFiles.length === 0) {
    checks.push({
      name: "API Routes Check",
      status: "warn",
      message: "No API route files found",
    });
    return;
  }
  
  const checkedApiRouteFiles = new Set();
  
  for (const file of routeFiles) {
    try {
      const content = readFileSync(file, "utf-8");
      const forwardedRoute = extractForwardedRoute(content);
      if (forwardedRoute) {
        const apiRoutePath = join(apiRoutesDir, forwardedRoute);
        if (statSync(apiRoutePath).isFile()) {
          checkedApiRouteFiles.add(apiRoutePath);
        }
      }
      checkRouteAuth(file);
    } catch (error) {
      checks.push({
        name: `API Route: ${file.split("/").pop()}`,
        status: "fail",
        message: `Failed to check route: ${error.message}`,
      });
      hasErrors = true;
    }
  }
  
  for (const file of apiRouteFiles) {
    if (!checkedApiRouteFiles.has(file)) {
      try {
        checkRouteAuth(file, true);
      } catch (error) {
        checks.push({
          name: `API Route: ${file.split("/").pop()} (in app/lib/api-routes)`,
          status: "fail",
          message: `Failed to check route: ${error.message}`,
        });
        hasErrors = true;
      }
    }
  }
}

checkApiRoutes();

console.log("\n=== API Route Authentication Check ===\n");
checks.forEach(check => {
  const icon = check.status === "pass" ? "✅" : check.status === "warn" ? "⚠️" : "❌";
  console.log(`${icon} ${check.name}: ${check.message}`);
});

if (hasErrors) {
  console.log("\n❌ API authentication check failed. Please add authentication to the routes above.");
  process.exit(1);
} else {
  console.log("\n✅ All API routes have authentication.");
  process.exit(0);
}
