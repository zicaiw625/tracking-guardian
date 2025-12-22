import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

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

function getScriptKindByExt(ext) {
  switch (ext) {
    case ".ts":
      return ts.ScriptKind.TS;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".cjs":
    case ".mjs":
    case ".js":
    default:
      return ts.ScriptKind.JS;
  }
}

function splitShebang(text) {
  const idx = text.indexOf("\n");
  const firstLine = idx === -1 ? text : text.slice(0, idx);
  if (firstLine.startsWith("#!")) {
    const rest = idx === -1 ? "" : text.slice(idx + 1);
    return { shebang: firstLine, rest };
  }
  return { shebang: "", rest: text };
}

function detectNewline(text) {
  const i = text.indexOf("\n");
  if (i <= 0) return "\n";
  return text[i - 1] === "\r" ? "\r\n" : "\n";
}

function blankOutPreservingNewlines(slice) {
  let out = "";
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    out += ch === "\n" || ch === "\r" ? ch : " ";
  }
  return out;
}

function removeCommentsFromSourceText(absPath, text) {
  const newline = detectNewline(text);
  const ext = path.extname(absPath);
  const scriptKind = getScriptKindByExt(ext);

  const { shebang, rest } = splitShebang(text);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, rest);
  scanner.setScriptKind(scriptKind);

  const ranges = [];
  while (true) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      ranges.push([scanner.getTokenPos(), scanner.getTextPos()]);
    }
  }

  if (ranges.length === 0) {
                                                     
    const combined = shebang ? shebang + newline + rest : rest;
    return combined.endsWith(newline) ? combined : combined + newline;
  }

  let cleaned = rest;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const [start, end] = ranges[i];
    cleaned = cleaned.slice(0, start) + blankOutPreservingNewlines(cleaned.slice(start, end)) + cleaned.slice(end);
  }

  const combined = shebang ? shebang + newline + cleaned : cleaned;
  return combined.endsWith(newline) ? combined : combined + newline;
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
  const verify = args.has("--verify");

  const files = [];
  for (const dir of TARGET_DIRS) {
    await walk(dir, files);
  }

  files.sort();

  let changed = 0;
  let processed = 0;
  let commentTokens = 0;
  for (const file of files) {
    if (!shouldProcessFile(file)) continue;
    const original = await fs.readFile(file, "utf8");
    const next = removeCommentsFromSourceText(file, original);
    processed++;
    if (next !== original) changed++;
    if (!dryRun && !verify && next !== original) await fs.writeFile(file, next, "utf8");

    if (verify) {
      const ext = path.extname(file);
      const scriptKind = getScriptKindByExt(ext);
      const { rest } = splitShebang(next);
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, rest);
      scanner.setScriptKind(scriptKind);
      while (true) {
        const kind = scanner.scan();
        if (kind === ts.SyntaxKind.EndOfFileToken) break;
        if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
          commentTokens++;
        }
      }
    }
  }

  const mode = verify ? "VERIFY" : dryRun ? "DRY-RUN" : "WRITE";
                                        
  console.log(
    `[remove-comments] mode=${mode} processed=${processed} changed=${changed}` +
      (verify ? ` remainingCommentTokens=${commentTokens}` : ""),
  );
}

await main();

