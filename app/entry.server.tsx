import { PassThrough } from "stream";
import { randomBytes } from "crypto";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import { createReadableStreamFromReadable, type EntryContext, } from "@remix-run/node";
import { isbot } from "isbot";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { i18nServer } from "./i18n.server";
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import { addDocumentResponseHeaders } from "./shopify.server";
import { ensureSecretsValid, enforceSecurityChecks } from "./utils/secrets.server";
import { validateEncryptionConfig } from "./utils/crypto.server";
import { validateConfig, logConfigStatus, API_CONFIG } from "./utils/config.server";
import { logger } from "./utils/logger.server";
import { EMBEDDED_APP_HEADERS, SHARE_PAGE_ROBOTS_TAG, addSecurityHeadersToHeaders, getProductionSecurityHeaders, validateSecurityHeaders, buildAppPageCspWithNonce, buildPublicPageCspWithNonce } from "./utils/security-headers";
import { RedisClientFactory } from "./utils/redis-client.server";
import prisma from "./db.server";
import { getCorsHeadersPreBody } from "./lib/pixel-events/cors";
import { SecureShopDomainSchema } from "./utils/security";
const ABORT_DELAY = 5000;
const PUBLIC_DOCUMENT_PATHS = new Set(["/privacy", "/terms", "/support"]);

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
        // P1-2: Force block startup in production if config is invalid
        const msg = `Configuration errors: ${configResult.errors.join(", ")}`;
        logger.error(msg); // Ensure it's logged
        throw new Error(msg);
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
    const nonce = randomBytes(16).toString("base64");
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

    const isEmbeddedAppDocument = url.pathname === "/app" || url.pathname.startsWith("/app/");
    const isPublicDocument = PUBLIC_DOCUMENT_PATHS.has(url.pathname);
    const isShareDocument = url.pathname === "/r" || url.pathname.startsWith("/r/");
    if (isEmbeddedAppDocument) {
      let frameAncestors = ["https://admin.shopify.com", "https://*.myshopify.com", "https://*.shopify.com"];
      if (shopDomain) {
        frameAncestors = [
          "https://admin.shopify.com",
          `https://${shopDomain}`,
        ];
      }
      responseHeaders.delete("X-Frame-Options");
      responseHeaders.set("Content-Security-Policy", buildAppPageCspWithNonce(nonce, frameAncestors));
      const documentSecurityHeaders =
        process.env.NODE_ENV === "production"
          ? getProductionSecurityHeaders(EMBEDDED_APP_HEADERS)
          : EMBEDDED_APP_HEADERS;
      addSecurityHeadersToHeaders(responseHeaders, documentSecurityHeaders);
    } else if (isPublicDocument) {
      responseHeaders.set("Content-Security-Policy", buildPublicPageCspWithNonce(nonce));
    }
    if (isShareDocument) {
      responseHeaders.set("X-Robots-Tag", SHARE_PAGE_ROBOTS_TAG);
    }
    const userAgent = request.headers.get("user-agent");
    const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

    const instance = createInstance();
    const lng = await i18nServer.getLocale(request);
    const ns = remixContext?.routeModules
      ? i18nServer.getRouteNamespaces(remixContext)
      : ["translation"];

    await instance
        .use(initReactI18next)
        .init({
            lng,
            ns,
            fallbackLng: "en",
            resources: {
                en: { translation: en },
                zh: { translation: zh },
            },
        });

    return new Promise((resolve, reject) => {
        let abortTimeoutId: NodeJS.Timeout | null = null;
        const { pipe, abort } = renderToPipeableStream(
            <I18nextProvider i18n={instance}>
                <RemixServer context={remixContext} url={request.url} abortDelay={ABORT_DELAY} nonce={nonce}/>
            </I18nextProvider>,
            {
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
