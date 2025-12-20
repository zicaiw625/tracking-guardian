import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import {
  createReadableStreamFromReadable,
  type EntryContext,
} from "@remix-run/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { ensureSecretsValid, enforceSecurityChecks } from "./utils/secrets";
import { validateConfig, logConfigStatus } from "./utils/config";
import { logger } from "./utils/logger";
import { 
  EMBEDDED_APP_HEADERS, 
  addSecurityHeadersToHeaders,
  validateSecurityHeaders,
} from "./utils/security-headers";

const ABORT_DELAY = 5000;

let secretsValidated = false;
let securityChecked = false;
let headersValidated = false;
let configValidated = false;

/**
 * P0-04: Enforce security checks BEFORE any request processing
 * This runs once at startup and will crash the app if critical violations are found
 */
function enforceSecurityOnce() {
  if (!securityChecked) {
    // P0-04: This will throw and crash the app if ALLOW_UNSIGNED_PIXEL_EVENTS=true in production
    enforceSecurityChecks();
    securityChecked = true;
  }
}

/**
 * P1-05: Validate security headers configuration at startup
 */
function validateHeadersOnce() {
  if (!headersValidated) {
    const validation = validateSecurityHeaders();
    if (!validation.valid) {
      logger.warn("Security headers configuration issues:", validation.issues);
    }
    headersValidated = true;
  }
}

function validateSecretsOnce() {
  if (!secretsValidated) {
    try {
      ensureSecretsValid();
      logger.info("Secrets validation passed");
    } catch (error) {
      logger.error("Secrets validation failed", error);
    }
    secretsValidated = true;
  }
}

/**
 * P0-2 (Mid Priority): Validate configuration at startup
 * This ensures critical environment variables are set before processing requests.
 * In production, missing required vars will throw and crash the app.
 */
function validateConfigOnce() {
  if (!configValidated) {
    const result = validateConfig();
    
    if (result.errors.length > 0) {
      logger.error("Configuration errors:", result.errors);
      // In production, this is fatal - better to crash than run misconfigured
      if (process.env.NODE_ENV === "production") {
        throw new Error(`Configuration errors: ${result.errors.join(", ")}`);
      }
    }
    
    if (result.warnings.length > 0) {
      logger.warn("Configuration warnings:", result.warnings);
    }
    
    // Also log full config status for debugging
    logConfigStatus();
    
    configValidated = true;
  }
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  // P0-04: Security checks MUST run first - crashes app on critical violations
  enforceSecurityOnce();
  
  validateSecretsOnce();
  
  // P0-2 (Mid Priority): Validate configuration (SHOPIFY_APP_URL, etc.)
  validateConfigOnce();
  
  // P1-05: Validate security headers configuration
  validateHeadersOnce();
  
  // Add Shopify document response headers (App Bridge compatibility)
  addDocumentResponseHeaders(request, responseHeaders);
  
  // P1-05: Add security headers for embedded app pages
  // These headers protect against XSS, clickjacking, etc.
  // The CSP uses frame-ancestors to allow Shopify Admin iframe embedding
  addSecurityHeadersToHeaders(responseHeaders, EMBEDDED_APP_HEADERS);

  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

