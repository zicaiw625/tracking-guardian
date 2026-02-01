
export function sanitizePII(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const sanitized = Array.isArray(payload) ? [...payload] : { ...payload as Record<string, unknown> };
  if (Array.isArray(sanitized)) {
    return sanitized.map(item => sanitizePII(item));
  }
  const obj = sanitized as Record<string, unknown>;
  const allowedFields = new Set([
    "id",
    "event_name",
    "eventname",
    "value",
    "currency",
    "items",
    "event_id",
    "eventid",
    "timestamp",
    "event_time",
    "eventtime",
    "client_id",
    "clientid",
    "order_id",
    "orderid",
    "item_id",
    "itemid",
    "item_name",
    "itemname",
    "quantity",
    "price",
    "content_id",
    "contentid",
    "content_name",
    "contentname",
    "contents",
    "content_type",
    "contenttype",
    "engagement_time_msec",
    "engagementtimemsec",
    "url",
    "method",
    "data",
    "product_id",
    "productid",
    "variant_id",
    "variantid",
    "consent",
    "trustlevel",
    "trust_level",
    "hmacmatched",
    "hmac_matched",
    "verificationrunid",
    "verification_run_id",
  ]);
  /** PII/sensitive fields to strip. When adding new payload or platform params, update this set if they can carry PII. */
  const piiFields = new Set([
    "email",
    "phone",
    "phone_number",
    "phonenumber",
    "name",
    "first_name",
    "firstname",
    "last_name",
    "lastname",
    "full_name",
    "fullname",
    "given_name",
    "givenname",
    "surname",
    "middle_name",
    "middlename",
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
    "latitude",
    "longitude",
    "location",
    "customer_id",
    "customerid",
    "user_id",
    "userid",
    "em",
    "ph",
    "fn",
    "ln",
    "zp",
    "ct",
    "st",
    "user_data",
    "userdata",
    "external_id",
    "externalid",
    "email_hash",
    "emailhash",
    "phone_hash",
    "phonehash",
    "hashed_email",
    "hashedemail",
    "hashed_phone",
    "hashedphone",
    "hashed_phone_number",
    "hashedphonenumber",
    "pre_hashed_user_data",
    "prehasheduserdata",
    "customer_email_hash",
    "customeremailhash",
    "customer_phone_hash",
    "customerphonehash",
    "dob",
    "date_of_birth",
    "birthday",
    "birth_date",
    "birthdate",
    "gender",
    "sex",
    "fax",
    "fax_number",
    "faxnumber",
    "cookie",
    "cookies",
  ]);
  const sensitiveKeys = new Set([
    "access_token",
    "accesstoken",
    "api_secret",
    "apisecret",
    "authorization",
    "pixel_code",
    "pixelcode",
    "test_event_code",
    "testeventcode",
  ]);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "url") {
      if (typeof obj[key] === "string") {
        try {
          const u = new URL(obj[key] as string);
          result[key] = `${u.origin}${u.pathname}`;
        } catch {
          result[key] = "[REDACTED]";
        }
      } else {
        result[key] = "[REDACTED]";
      }
      continue;
    }
    if (lowerKey === "body") {
      result[key] = "[REDACTED]";
      continue;
    }
    const piiKeywords = ["email", "phone", "address", "name", "customer", "user", "personal", "identify"];
    const containsPiiKeyword = piiKeywords.some(keyword => lowerKey.includes(keyword));
    const isAllowed = allowedFields.has(lowerKey);
    if (!isAllowed && containsPiiKeyword) {
      continue;
    }
    if (piiFields.has(lowerKey)) {
      continue;
    }
    if (sensitiveKeys.has(lowerKey)) {
      result[key] = "***REDACTED***";
      continue;
    }
    if (!isAllowed) {
      continue;
    }
    if (typeof obj[key] === "object" && obj[key] !== null) {
      result[key] = sanitizePII(obj[key]);
    } else {
      result[key] = obj[key];
    }
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function sanitizeCredentials(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const sanitized = Array.isArray(payload) ? [...payload] : { ...payload as Record<string, unknown> };
  if (Array.isArray(sanitized)) {
    return sanitized.map(item => sanitizeCredentials(item));
  }
  const obj = sanitized as Record<string, unknown>;
  const sensitiveKeys = new Set([
    "access_token",
    "accesstoken",
    "api_secret",
    "apisecret",
    "test_event_code",
    "testeventcode",
    "api_key",
    "apikey",
  ]);
  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.has(lowerKey)) {
      obj[key] = "***REDACTED***";
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      obj[key] = sanitizeCredentials(obj[key]);
    }
  }
  return obj;
}
