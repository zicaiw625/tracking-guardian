import fs from "node:fs/promises";
import path from "node:path";

const PROJECT_ROOT = process.cwd();

const TARGET_DIRS = [PROJECT_ROOT];

const VALID_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".prisma", ".sh"]);

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

const IGNORE_FILES = new Set([
  "remove-comments.mjs",
]);

function shouldProcessFile(absPath) {
  const ext = path.extname(absPath);
  if (!VALID_EXTS.has(ext)) return false;
  const basename = path.basename(absPath);
  if (IGNORE_FILES.has(basename)) return false;
  return true;
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

function removeCommentsFromSQL(text) {
  const newline = detectNewline(text);
  let result = "";
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "-" && next === "-") {
      while (i < len && text[i] !== "\n" && text[i] !== "\r") {
        i++;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < len - 1) {
        if (text[i] === "*" && text[i + 1] === "/") {
          i += 2;
          break;
        }
        if (text[i] === "\n" || text[i] === "\r") {
          result += text[i];
        }
        i++;
      }
      continue;
    }

    if (char === "'") {
      result += char;
      i++;
      while (i < len) {
        if (text[i] === "\\") {
          result += text[i];
          i++;
          if (i < len) {
            result += text[i];
            i++;
          }
          continue;
        }
        if (text[i] === "'") {
          result += text[i];
          i++;
          break;
        }
        result += text[i];
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }

  let cleaned = result.split(newline).map(line => line.trimEnd()).join(newline);
  cleaned = cleaned.replace(new RegExp(`(${newline}){3,}`, "g"), newline + newline);
  return cleaned.endsWith(newline) ? cleaned : cleaned + newline;
}

function removeCommentsFromPrisma(text) {
  const newline = detectNewline(text);
  let result = "";
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "/" && next === "/") {
      while (i < len && text[i] !== "\n" && text[i] !== "\r") {
        i++;
      }
      continue;
    }

    if (char === '"') {
      result += char;
      i++;
      while (i < len) {
        if (text[i] === "\\") {
          result += text[i];
          i++;
          if (i < len) {
            result += text[i];
            i++;
          }
          continue;
        }
        if (text[i] === '"') {
          result += text[i];
          i++;
          break;
        }
        result += text[i];
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }

  let cleaned = result.split(newline).map(line => line.trimEnd()).join(newline);
  cleaned = cleaned.replace(new RegExp(`(${newline}){3,}`, "g"), newline + newline);
  return cleaned.endsWith(newline) ? cleaned : cleaned + newline;
}

function removeCommentsFromShell(text) {
  const newline = detectNewline(text);
  const { shebang, rest } = splitShebang(text);
  const lines = rest.split(newline);
  const cleanedLines = lines.map((line) => {
    let result = "";
    let inSingle = false;
    let inDouble = false;
    let escapeNext = false;
    let paramDepth = 0;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const next = line[i + 1];

      if (escapeNext) {
        result += char;
        escapeNext = false;
        continue;
      }

      if (!inSingle && char === "\\") {
        result += char;
        escapeNext = true;
        continue;
      }

      if (!inDouble && char === "'") {
        inSingle = !inSingle;
        result += char;
        continue;
      }

      if (!inSingle && char === '"') {
        inDouble = !inDouble;
        result += char;
        continue;
      }

      if (!inSingle && !inDouble) {
        if (char === "$" && next === "{") {
          paramDepth += 1;
          result += char;
          continue;
        }
        if (char === "}" && paramDepth > 0) {
          paramDepth -= 1;
          result += char;
          continue;
        }
      }

      if (!inSingle && !inDouble && paramDepth === 0 && char === "#") {
        break;
      }

      result += char;
    }

    return result.trimEnd();
  });

  const combined = shebang ? shebang + newline + cleanedLines.join(newline) : cleanedLines.join(newline);
  return combined.endsWith(newline) ? combined : combined + newline;
}

function removeCommentsFromSourceText(absPath, text) {
  const ext = path.extname(absPath);
  if (ext === ".sql") {
    return removeCommentsFromSQL(text);
  }
  if (ext === ".prisma") {
    return removeCommentsFromPrisma(text);
  }
  if (ext === ".sh") {
    return removeCommentsFromShell(text);
  }

  const newline = detectNewline(text);
  const { shebang, rest } = splitShebang(text);

  let result = "";
  let i = 0;
  const len = rest.length;

  while (i < len) {
    const char = rest[i];
    const next = rest[i + 1];

    if (char === "/" && next === "/") {
      while (i < len && rest[i] !== "\n" && rest[i] !== "\r") {
        i++;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < len - 1) {
        if (rest[i] === "*" && rest[i + 1] === "/") {
          i += 2;
          break;
        }
        if (rest[i] === "\n" || rest[i] === "\r") {
          result += rest[i];
        }
        i++;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      result += char;
      i++;
      while (i < len) {
        if (rest[i] === "\\") {
          result += rest[i];
          i++;
          if (i < len) {
            result += rest[i];
            i++;
          }
          continue;
        }
        if (rest[i] === "\n" || rest[i] === "\r") {
          result += rest[i];
          i++;
          break;
        }
        if (rest[i] === quote) {
          result += rest[i];
          i++;
          break;
        }
        result += rest[i];
        i++;
      }
      continue;
    }

    if (char === "`") {
      result += char;
      i++;
      while (i < len) {
        if (rest[i] === "\\") {
          result += rest[i];
          i++;
          if (i < len) {
            result += rest[i];
            i++;
          }
          continue;
        }
        if (rest[i] === "$" && rest[i + 1] === "{") {
          result += "${";
          i += 2;
          let braceDepth = 1;
          while (i < len && braceDepth > 0) {
            if (rest[i] === "{") {
              braceDepth++;
              result += rest[i];
              i++;
            } else if (rest[i] === "}") {
              braceDepth--;
              if (braceDepth > 0) {
                result += rest[i];
              } else {
                result += rest[i];
              }
              i++;
            } else if (rest[i] === "/" && rest[i + 1] === "/") {
              while (i < len && rest[i] !== "\n" && rest[i] !== "\r") {
                i++;
              }
            } else if (rest[i] === "/" && rest[i + 1] === "*") {
              i += 2;
              while (i < len - 1) {
                if (rest[i] === "*" && rest[i + 1] === "/") {
                  i += 2;
                  break;
                }
                if (rest[i] === "\n" || rest[i] === "\r") {
                  result += rest[i];
                }
                i++;
              }
            } else if (rest[i] === '"' || rest[i] === "'") {
              const q = rest[i];
              result += rest[i];
              i++;
              while (i < len) {
                if (rest[i] === "\\") {
                  result += rest[i];
                  i++;
                  if (i < len) {
                    result += rest[i];
                    i++;
                  }
                  continue;
                }
                if (rest[i] === q) {
                  result += rest[i];
                  i++;
                  break;
                }
                result += rest[i];
                i++;
              }
            } else {
              result += rest[i];
              i++;
            }
          }
          continue;
        }
        if (rest[i] === "`") {
          result += rest[i];
          i++;
          break;
        }
        result += rest[i];
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }

  let cleaned = result.split(newline).map(line => line.trimEnd()).join(newline);
  cleaned = cleaned.replace(new RegExp(`(${newline}){3,}`, "g"), newline + newline);

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
      if (ext === ".sql") {
        const singleLineRegex = new RegExp("--[^\\n\\r]*", "g");
        const multiLineRegex = new RegExp("\\/\\*[\\s\\S]*?\\*\\/", "g");
        const singleLineMatches = next.match(singleLineRegex) || [];
        const multiLineMatches = next.match(multiLineRegex) || [];
        commentTokens += singleLineMatches.length + multiLineMatches.length;
      } else if (ext === ".prisma") {
        const singleLineRegex = new RegExp("\\/\\/[^\\n\\r]*", "g");
        const singleLineMatches = next.match(singleLineRegex) || [];
        commentTokens += singleLineMatches.length;
      } else {
        const { rest } = splitShebang(next);
        const singleLineRegex = new RegExp("\\/\\/[^\\n\\r]*", "g");
        const multiLineRegex = new RegExp("\\/\\*[\\s\\S]*?\\*\\/", "g");
        const singleLineMatches = (rest.match(singleLineRegex) || []).filter(m => !m.startsWith("://"));
        const multiLineMatches = rest.match(multiLineRegex) || [];
        commentTokens += singleLineMatches.length + multiLineMatches.length;
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
