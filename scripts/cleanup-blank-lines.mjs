import fs from "node:fs/promises";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const TARGET_DIRS = [PROJECT_ROOT];

const VALID_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const IGNORE_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "build",
  "dist",
  "coverage",
  ".cache",
  ".turbo",
  ".next",
  ".vercel",
]);

function shouldProcessFile(absPath) {
  const ext = path.extname(absPath);
  if (!VALID_EXTS.has(ext)) return false;
  return true;
}

function cleanupBlankLines(text) {
  const lines = text.split("\n");
  const result = [];
  let prevWasBlank = true;
  let braceDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const isBlank = trimmed === "";
    for (const ch of line) {
      if (ch === "{" || ch === "[" || ch === "(") braceDepth++;
      if (ch === "}" || ch === "]" || ch === ")") braceDepth--;
    }
    if (isBlank) {
      if (!prevWasBlank && i < lines.length - 1 && braceDepth === 0) {
        result.push("");
      }
      prevWasBlank = true;
    } else {
      result.push(line);
      prevWasBlank = false;
    }
  }
  while (result.length > 0 && result[0].trim() === "") {
    result.shift();
  }
  while (result.length > 0 && result[result.length - 1].trim() === "") {
    result.pop();
  }
  return result.join("\n") + "\n";
}

async function walk(dir, outFiles) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIR_NAMES.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), outFiles);
      continue;
    }
    if (!entry.isFile()) continue;
    const absPath = path.join(dir, entry.name);
    if (shouldProcessFile(absPath)) outFiles.push(absPath);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const files = [];
  for (const dir of TARGET_DIRS) {
    await walk(dir, files);
  }
  files.sort();
  let changed = 0;
  let processed = 0;
  for (const file of files) {
    if (!shouldProcessFile(file)) continue;
    const original = await fs.readFile(file, "utf8");
    const next = cleanupBlankLines(original);
    processed++;
    if (next !== original) {
      changed++;
      if (!dryRun) {
        await fs.writeFile(file, next, "utf8");
      }
    }
  }
  const mode = dryRun ? "DRY-RUN" : "WRITE";
  console.log(`[cleanup-blank-lines] mode=${mode} processed=${processed} changed=${changed}`);
}

await main();
