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
import { logger } from "./utils/logger";

const ABORT_DELAY = 5000;

let secretsValidated = false;
let securityChecked = false;

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

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  // P0-04: Security checks MUST run first - crashes app on critical violations
  enforceSecurityOnce();
  
  validateSecretsOnce();
  
  addDocumentResponseHeaders(request, responseHeaders);

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

