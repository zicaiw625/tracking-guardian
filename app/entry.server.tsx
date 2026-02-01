import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import { createReadableStreamFromReadable, type EntryContext, } from "@remix-run/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { ensureSecretsValid, enforceSecurityChecks } from "./utils/secrets.server";
import { validateEncryptionConfig } from "./utils/crypto.server";
import { validateConfig, logConfigStatus, API_CONFIG } from "./utils/config.server";
import { logger } from "./utils/logger.server";
import { EMBEDDED_APP_HEADERS, addSecurityHeadersToHeaders, getProductionSecurityHeaders, validateSecurityHeaders, buildCspHeader, NON_EMBEDDED_PAGE_CSP_DIRECTIVES } from "./utils/security-headers";
import { RedisClientFactory } from "./utils/redis-client.server";
import prisma from "./db.server";
import { getCorsHeadersPreBody } from "./lib/pixel-events/cors";
import { SecureShopDomainSchema } from "./utils/security";
const ABORT_DELAY = 5000;

if (typeof process !== "undefined") {
  process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
    const errorMessage = reason instanceof Error ? reason.message : String(reason);
    const errorStack = reason instanceof Error ? reason.stack : undefined;
    logger.error("Unhandled Promise Rejection", reason instanceof Error ? reason : new Error(String(reason)), {
      errorMessage,
      errorStack,
      promise: String(promise),
    });
  });
  process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught Exception", error, {
      errorMessage: error.message,
      errorStack: error.stack,
    });
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  });
  const cleanup = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    try {
      await RedisClientFactory.resetAsync();
      logger.info("Redis connections closed");
    } catch (error) {
      logger.error("Error closing Redis connections during shutdown", error);
    }
    try {
      await prisma.$disconnect();
      logger.info("Database connections closed");
    } catch (error) {
      logger.error("Error closing database connections during shutdown", error);
    }
    logger.info("Graceful shutdown completed");
    process.exit(0);
  };
  process.on("SIGTERM", () => cleanup("SIGTERM"));
  process.on("SIGINT", () => cleanup("SIGINT"));
}

const startupGate = (async () => {
  try {
    await enforceSecurityChecks();
    ensureSecretsValid();
    validateEncryptionConfig();
    if (process.env.NODE_ENV === "production" && process.env.TRUST_PROXY !== "true") {
      throw new Error("TRUST_PROXY must be true in production for correct IP rate limiting");
    }
    const configResult = validateConfig();
    if (configResult.errors.length > 0) {
      logger.error("Configuration errors:", undefined, { errors: configResult.errors });
      if (process.env.NODE_ENV === "production") {
        throw new Error(`Configuration errors: ${configResult.errors.join(", ")}`);
      }
    }
    if (configResult.warnings.length > 0) {
      logger.warn("Configuration warnings:", { warnings: configResult.warnings });
    }
    logConfigStatus();
    const headersValidation = validateSecurityHeaders();
    if (!headersValidation.valid) {
      logger.warn("Security headers configuration issues:", { issues: headersValidation.issues });
    }
    logger.info("Startup security checks completed successfully");
    return true;
  } catch (error) {
    logger.error("Startup security checks failed", error);
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
    throw error;
  }
})();

export default async function handleRequest(request: Request, responseStatusCode: number, responseHeaders: Headers, remixContext: EntryContext) {
    await startupGate;
    const url = new URL(request.url);
    if (url.pathname === "/ingest" && request.method === "POST") {
        const contentLength = request.headers.get("Content-Length");
        if (contentLength) {
            const size = parseInt(contentLength, 10);
            if (!isNaN(size) && size > API_CONFIG.MAX_BODY_SIZE) {
                logger.warn(`Request body too large at entry layer: ${size} bytes (max ${API_CONFIG.MAX_BODY_SIZE})`, {
                    path: url.pathname,
                    method: request.method,
                });
                const headers = new Headers(getCorsHeadersPreBody(request));
                headers.set("Content-Type", "application/json");
                return new Response(
                    JSON.stringify({ error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE }),
                    {
                        status: 413,
                        headers,
                    }
                );
            }
        }
    }
    addDocumentResponseHeaders(request, responseHeaders);
    const shopCandidate =
      request.headers.get("x-shopify-shop-domain") ||
      url.searchParams.get("shop") ||
      null;
    const shopDomain =
      shopCandidate && SecureShopDomainSchema.safeParse(shopCandidate).success
        ? shopCandidate
        : null;
    const frameAncestors = ["https://admin.shopify.com"];
    if (shopDomain) frameAncestors.unshift(`https://${shopDomain}`);
    responseHeaders.delete("X-Frame-Options");
    const cspDirectives = {
      ...NON_EMBEDDED_PAGE_CSP_DIRECTIVES,
      "frame-ancestors": frameAncestors,
    };
    responseHeaders.set("Content-Security-Policy", buildCspHeader(cspDirectives));
    const documentSecurityHeaders =
      process.env.NODE_ENV === "production"
        ? getProductionSecurityHeaders(EMBEDDED_APP_HEADERS)
        : EMBEDDED_APP_HEADERS;
    addSecurityHeadersToHeaders(responseHeaders, documentSecurityHeaders);
    const userAgent = request.headers.get("user-agent");
    const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";
    return new Promise((resolve, reject) => {
        let abortTimeoutId: NodeJS.Timeout | null = null;
        const { pipe, abort } = renderToPipeableStream(<RemixServer context={remixContext} url={request.url} abortDelay={ABORT_DELAY}/>, {
            [callbackName]: () => {
                const body = new PassThrough();
                const stream = createReadableStreamFromReadable(body);
                responseHeaders.set("Content-Type", "text/html");
                if (abortTimeoutId !== null) {
                    clearTimeout(abortTimeoutId);
                    abortTimeoutId = null;
                }
                resolve(new Response(stream, {
                    headers: responseHeaders,
                    status: responseStatusCode,
                }));
                pipe(body);
            },
            onShellError(error) {
                if (abortTimeoutId !== null) {
                    clearTimeout(abortTimeoutId);
                    abortTimeoutId = null;
                }
                reject(error);
            },
            onError(error) {
                responseStatusCode = 500;
                logger.error("React render error", error);
            },
        });
        abortTimeoutId = setTimeout(() => {
            abortTimeoutId = null;
            abort();
        }, ABORT_DELAY);
    });
}
