#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key in process.env) continue;
    process.env[key] = val;
  }
}

loadEnv();
process.env.NODE_ENV = "production";

if (process.env.ALLOW_UNSIGNED_PIXEL_EVENTS === "true") {
  console.error("[CI SECURITY] ALLOW_UNSIGNED_PIXEL_EVENTS=true is not allowed in production build.");
  process.exit(1);
}

if (process.env.TRUST_PROXY !== undefined && process.env.TRUST_PROXY !== "true") {
  console.error("[CI SECURITY] TRUST_PROXY must be 'true' in production when set.");
  process.exit(1);
}

process.exit(0);
