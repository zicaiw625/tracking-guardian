import fs from "node:fs/promises";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const TARGET_DIRS = [PROJECT_ROOT];

const VALID_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql"]);

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

function removeComments(content, ext) {
  if (ext === ".sql") {
    return removeSQLComments(content);
  }
  return removeJSComments(content);
}

function removeJSComments(content) {
  const lines = content.split('\n');
  const result = [];
  let inMultiLineComment = false;
  let inString = false;
  let stringChar = null;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let newLine = '';
    let i = 0;
    let lineInString = inString;
    let lineStringChar = stringChar;
    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1] || '';
      const prevChar = line[i - 1] || '';
      if (!inMultiLineComment && !lineInString) {
        if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
          lineInString = true;
          lineStringChar = char;
          newLine += char;
          i++;
          continue;
        }
        if (char === '/' && nextChar === '/') {
          break;
        }
        if (char === '/' && nextChar === '*') {
          inMultiLineComment = true;
          i += 2;
          continue;
        }
      }
      if (lineInString) {
        if (char === lineStringChar && prevChar !== '\\') {
          lineInString = false;
          lineStringChar = null;
        }
        newLine += char;
        i++;
        continue;
      }
      if (inMultiLineComment) {
        if (char === '*' && nextChar === '/') {
          inMultiLineComment = false;
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      newLine += char;
      i++;
    }
    inString = lineInString;
    stringChar = lineStringChar;
    if (newLine.trim() || !inMultiLineComment) {
      result.push(newLine);
    }
  }
  return result.join('\n');
}

function removeSQLComments(content) {
  const lines = content.split('\n');
  const result = [];
  let inMultiLineComment = false;
  let inString = false;
  let stringChar = null;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let newLine = '';
    let i = 0;
    let lineInString = inString;
    let lineStringChar = stringChar;
    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1] || '';
      const prevChar = line[i - 1] || '';
      if (!inMultiLineComment && !lineInString) {
        if ((char === "'" || char === '"') && prevChar !== '\\') {
          lineInString = true;
          lineStringChar = char;
          newLine += char;
          i++;
          continue;
        }
        if (char === '-' && nextChar === '-') {
          break;
        }
        if (char === '/' && nextChar === '*') {
          inMultiLineComment = true;
          i += 2;
          continue;
        }
      }
      if (lineInString) {
        if (char === lineStringChar && prevChar !== '\\') {
          lineInString = false;
          lineStringChar = null;
        }
        newLine += char;
        i++;
        continue;
      }
      if (inMultiLineComment) {
        if (char === '*' && nextChar === '/') {
          inMultiLineComment = false;
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      newLine += char;
      i++;
    }
    inString = lineInString;
    stringChar = lineStringChar;
    if (newLine.trim() || !inMultiLineComment) {
      result.push(newLine);
    }
  }
  return result.join('\n');
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
    const ext = path.extname(file);
    const next = removeComments(original, ext);
    processed++;
    if (next !== original) {
      changed++;
      if (!dryRun) {
        await fs.writeFile(file, next, "utf8");
      } else {
        console.log(`Would remove comments from: ${path.relative(PROJECT_ROOT, file)}`);
      }
    }
  }
  const mode = dryRun ? "DRY-RUN" : "WRITE";
  console.log(`[remove-comments] mode=${mode} processed=${processed} changed=${changed}`);
}

await main();
