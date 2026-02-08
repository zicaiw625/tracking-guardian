import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

function readOrEmpty(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function computeCacheKey() {
  const inputs = [
    readOrEmpty(path.join(process.cwd(), "pnpm-lock.yaml")),
    readOrEmpty(path.join(process.cwd(), "package.json")),
    readOrEmpty(path.join(process.cwd(), ".eslintrc.cjs")),
    readOrEmpty(path.join(process.cwd(), "tsconfig.json")),
  ].join("\n---\n");

  return createHash("sha1").update(inputs).digest("hex").slice(0, 12);
}

const cacheKey = computeCacheKey();
const cacheDir = path.join(
  process.cwd(),
  "node_modules",
  ".cache",
  "eslint"
);

if (existsSync(cacheDir) && !statSync(cacheDir).isDirectory()) {
  unlinkSync(cacheDir);
}

mkdirSync(cacheDir, { recursive: true });

const cacheLocation = path.join(cacheDir, `cache-${cacheKey}.json`);

const extraArgs = process.argv.slice(2);
const result = spawnSync(
  "eslint",
  ["--cache", "--cache-location", cacheLocation, ".", ...extraArgs],
  { stdio: "inherit", shell: process.platform === "win32" }
);

process.exit(result.status ?? 1);
