type Jsonish =
  | null
  | boolean
  | number
  | string
  | Jsonish[]
  | { [key: string]: Jsonish };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeUrl(value: unknown): unknown {
  if (typeof value !== "string") return "***REDACTED***";
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "***REDACTED***";
  }
}

const DROP_EXACT = new Set([
  "email",
  "phone",
  "phone_number",
  "phonenumber",
  "address",
  "street",
  "city",
  "state",
  "zip",
  "postal_code",
  "postalcode",
  "country",
  "ip",
  "ip_address",
  "ipaddress",
  "user_agent",
  "useragent",
  "ua",
  "first_name",
  "firstname",
  "last_name",
  "lastname",
  "full_name",
  "fullname",
  "given_name",
  "givenname",
  "surname",
  "dob",
  "date_of_birth",
  "birth_date",
  "birthdate",
  "birthday",
]);

const REDACT_EXACT = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "id_token",
  "idtoken",
  "client_secret",
  "clientsecret",
  "api_key",
  "apikey",
  "api_secret",
  "apisecret",
  "secret",
  "token",
  "password",
  "passphrase",
  "signature",
]);

const DROP_SUBSTRINGS = [
  "email",
  "phone",
  "address",
  "ip_address",
  "ipaddress",
  "user_agent",
  "useragent",
] as const;

const REDACT_SUBSTRINGS = [
  "token",
  "secret",
  "password",
  "passphrase",
  "authorization",
  "cookie",
] as const;

function shouldDropKey(keyLower: string): boolean {
  if (DROP_EXACT.has(keyLower)) return true;
  return DROP_SUBSTRINGS.some((s) => keyLower.includes(s));
}

function shouldRedactKey(keyLower: string): boolean {
  if (REDACT_EXACT.has(keyLower)) return true;
  return REDACT_SUBSTRINGS.some((s) => keyLower.includes(s));
}

function sanitizeJsonish(value: unknown, depth: number): unknown {
  if (depth > 20) return null;
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const v of value) {
      const s = sanitizeJsonish(v, depth + 1);
      if (s !== undefined) out.push(s);
    }
    return out;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (shouldDropKey(lower)) continue;
    if (lower === "url" || lower.endsWith("_url") || lower.endsWith("url")) {
      result[key] = sanitizeUrl(obj[key]);
      continue;
    }
    if (shouldRedactKey(lower)) {
      result[key] = "***REDACTED***";
      continue;
    }
    const s = sanitizeJsonish(obj[key], depth + 1);
    if (s === undefined) continue;
    result[key] = s;
  }
  return result;
}

export function sanitizeForPersistence(value: unknown): Jsonish | unknown {
  return sanitizeJsonish(value, 0) as Jsonish | unknown;
}

export const PRISMA_JSON_FIELD_NAMES = new Set([
  "settings",
  "details",
  "dependencies",
  "scriptTags",
  "checkoutConfig",
  "riskItems",
  "identifiedPlatforms",
  "eventMappings",
  "clientConfig",
  "credentials_legacy",
  "previousConfig",
  "payloadJson",
  "summaryJson",
  "eventsJson",
  "shopifyContextJson",
  "normalizedEventJson",
  "requestPayloadJson",
  "customAnswers",
  "capiInput",
  "consentEvidence",
  "trustMetadata",
  "platformResults",
  "platformResponse",
  "payload",
  "result",
  "previousValue",
  "newValue",
  "metadata",
  "platformBreakdown",
  "configData",
]);

function sanitizeDataObject(data: unknown): void {
  if (!isPlainObject(data)) return;
  const obj = data as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!PRISMA_JSON_FIELD_NAMES.has(key)) continue;
    obj[key] = sanitizeForPersistence(obj[key]);
  }
}

function sanitizeCreateManyData(data: unknown): void {
  if (Array.isArray(data)) {
    for (const item of data) sanitizeDataObject(item);
    return;
  }
  sanitizeDataObject(data);
}

export function sanitizePrismaWriteArgs(action: string, args: unknown): void {
  if (!args || typeof args !== "object") return;
  const a = args as Record<string, unknown>;
  if (action === "create" || action === "update" || action === "updateMany") {
    sanitizeDataObject(a.data);
    return;
  }
  if (action === "upsert") {
    sanitizeDataObject(a.create);
    sanitizeDataObject(a.update);
    return;
  }
  if (action === "createMany") {
    sanitizeCreateManyData(a.data);
  }
}

