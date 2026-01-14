import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import { createReadableStreamFromReadable, type EntryContext, } from "@remix-run/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { ensureSecretsValid, enforceSecurityChecks } from "./utils/secrets";
import { validateConfig, logConfigStatus, API_CONFIG } from "./utils/config";
import { logger } from "./utils/logger.server";
import { EMBEDDED_APP_HEADERS, addSecurityHeadersToHeaders, validateSecurityHeaders, } from "./utils/security-headers";
import { RedisClientFactory } from "./utils/redis-client";
import prisma from "./db.server";
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
            logger.warn("Security headers configuration issues:", { issues: validation.issues });
        }
        headersValidated = true;
    }
}
function validateSecretsOnce() {
    if (!secretsValidated) {
        try {
            ensureSecretsValid();
            logger.info("Secrets validation passed");
        }
        catch (error) {
            logger.error("Secrets validation failed", error);
        }
        secretsValidated = true;
    }
}
function validateConfigOnce() {
    if (!configValidated) {
        const result = validateConfig();
        if (result.errors.length > 0) {
            logger.error("Configuration errors:", undefined, { errors: result.errors });
            if (process.env.NODE_ENV === "production") {
                throw new Error(`Configuration errors: ${result.errors.join(", ")}`);
            }
        }
        if (result.warnings.length > 0) {
            logger.warn("Configuration warnings:", { warnings: result.warnings });
        }
        logConfigStatus();
        configValidated = true;
    }
}
export default async function handleRequest(request: Request, responseStatusCode: number, responseHeaders: Headers, remixContext: EntryContext) {
    enforceSecurityOnce();
    validateSecretsOnce();
    validateConfigOnce();
    validateHeadersOnce();
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
                return new Response(
                    JSON.stringify({ error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE }),
                    {
                        status: 413,
                        headers: {
                            "Content-Type": "application/json",
                        },
                    }
                );
            }
        }
    }
    addDocumentResponseHeaders(request, responseHeaders);
    addSecurityHeadersToHeaders(responseHeaders, EMBEDDED_APP_HEADERS);
    const userAgent = request.headers.get("user-agent");
    const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";
    return new Promise((resolve, reject) => {
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
        let abortTimeoutId: NodeJS.Timeout | null = setTimeout(() => {
            abortTimeoutId = null;
            abort();
        }, ABORT_DELAY);
    });
}
