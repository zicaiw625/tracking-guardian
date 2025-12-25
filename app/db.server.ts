/**
 * Database Server Module
 *
 * Provides the Prisma client instance for database operations.
 *
 * MIGRATION NOTE:
 * For new code, prefer using the DI container:
 *
 * ```typescript
 * // Instead of:
 * import prisma from "~/db.server";
 *
 * // Use:
 * import { getDb } from "~/container";
 * const db = getDb();
 *
 * // Or in route handlers:
 * import { withContext } from "~/container";
 * export const loader = withContext(async (request, ctx) => {
 *   const shop = await ctx.db.shop.findUnique({ ... });
 * });
 * ```
 *
 * The DI container provides the same prisma instance but enables:
 * - Better testability through dependency injection
 * - Request-scoped context with logging
 * - Consistent access patterns across the codebase
 */

import { PrismaClient } from "@prisma/client";

// Use globalThis for Node.js global augmentation
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient;
}

// =============================================================================
// Configuration
// =============================================================================

const DB_CONFIG = {
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || "10", 10),
  poolTimeout: parseInt(process.env.DB_POOL_TIMEOUT || "10", 10),
};

// =============================================================================
// Database URL Builder
// =============================================================================

function getDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL || "";
  if (!baseUrl) {
    return baseUrl;
  }
  const url = new URL(baseUrl);
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", String(DB_CONFIG.connectionLimit));
  }
  if (!url.searchParams.has("pool_timeout")) {
    url.searchParams.set("pool_timeout", String(DB_CONFIG.poolTimeout));
  }
  return url.toString();
}

// =============================================================================
// Prisma Client Factory
// =============================================================================

function createPrismaClient(): PrismaClient {
  const isProduction = process.env.NODE_ENV === "production";
  const client = new PrismaClient({
    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },
    log: isProduction ? ["error", "warn"] : ["query", "info", "warn", "error"],
  });
  if (!isProduction) {
    // Startup diagnostics - using console intentionally
    // eslint-disable-next-line no-console
    console.log("[STARTUP] Prisma connection pool configured:", {
      connectionLimit: DB_CONFIG.connectionLimit,
      poolTimeout: DB_CONFIG.poolTimeout,
    });
  }
  return client;
}

// =============================================================================
// Singleton Instance
// =============================================================================

const prisma: PrismaClient = global.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

// =============================================================================
// Exports
// =============================================================================

export default prisma;

/**
 * Get the Prisma client instance.
 * This is an alias for the default export, useful for explicit imports.
 */
// export { prisma };

/**
 * Type export for TransactionClient used in repository patterns.
 */
export type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
