#!/usr/bin/env node
import { readFileSync } from "fs";
import { join } from "path";

const FORBIDDEN_LICENSES = [
  "GPL",
  "AGPL",
  "LGPL",
];

const packageJsonPath = join(process.cwd(), "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

const allDependencies = {
  ...packageJson.dependencies || {},
  ...packageJson.devDependencies || {},
};

const issues = [];

for (const [pkgName, version] of Object.entries(allDependencies)) {
  try {
    const pkgPath = join(process.cwd(), "node_modules", pkgName, "package.json");
    const pkgJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const license = pkgJson.license || (pkgJson.licenses && pkgJson.licenses[0]?.type) || "UNKNOWN";
    
    const licenseStr = typeof license === "string" ? license : license.type || "UNKNOWN";
    
    for (const forbidden of FORBIDDEN_LICENSES) {
      if (licenseStr.includes(forbidden)) {
        issues.push({
          package: pkgName,
          version,
          license: licenseStr,
          reason: `License ${forbidden} is not allowed`,
        });
      }
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      continue;
    }
    console.warn(`Warning: Could not check license for ${pkgName}: ${error.message}`);
  }
}

if (issues.length > 0) {
  console.error("❌ License check failed: Found packages with forbidden licenses");
  console.error("");
  issues.forEach(({ package: pkg, version, license, reason }) => {
    console.error(`  - ${pkg}@${version}: ${license} (${reason})`);
  });
  console.error("");
  console.error("Please remove or replace these packages before deployment.");
  process.exit(1);
} else {
  console.log("✅ License check passed: No forbidden licenses found");
  process.exit(0);
}
