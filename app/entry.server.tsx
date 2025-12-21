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

function enforceSecurityOnce() {
  if (!securityChecked) {
    enforceSecurityChecks();
    securityChecked = true;
  }
}

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

function validateConfigOnce() {
  if (!configValidated) {
    const result = validateConfig();
    
    if (result.errors.length > 0) {
      logger.error("Configuration errors:", result.errors);
      if (process.env.NODE_ENV === "production") {
        throw new Error(`Configuration errors: ${result.errors.join(", ")}`);
      }
    }
    
    if (result.warnings.length > 0) {
      logger.warn("Configuration warnings:", result.warnings);
    }
    
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
  enforceSecurityOnce();
  
  validateSecretsOnce();
  
  validateConfigOnce();
  
  validateHeadersOnce();
  
  // P0-1: CRITICAL - Order matters for CSP/frame-ancestors compliance
  // 1. Shopify's addDocumentResponseHeaders sets CSP with dynamic frame-ancestors
  //    that includes the specific shop domain (e.g., https://my-store.myshopify.com)
  // 2. We then add additional security headers that do NOT include CSP
  //    to avoid overriding Shopify's properly configured frame-ancestors
  addDocumentResponseHeaders(request, responseHeaders);
  
  // Add non-CSP security headers (X-Content-Type-Options, etc.)
  // EMBEDDED_APP_HEADERS intentionally excludes Content-Security-Policy
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
