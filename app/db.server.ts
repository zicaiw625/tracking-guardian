import { PrismaClient } from "@prisma/client";

declare global {
  var prisma: PrismaClient;
}

/**
 * Database connection pool configuration.
 * 
 * These can be overridden via environment variables:
 * - DB_CONNECTION_LIMIT: Max connections in pool (default: 10)
 * - DB_POOL_TIMEOUT: Connection acquisition timeout in seconds (default: 10)
 * 
 * For Prisma, these are also configurable via DATABASE_URL query params:
 * - connection_limit
 * - pool_timeout
 * 
 * @see https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections
 */
const DB_CONFIG = {
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || "10", 10),
  poolTimeout: parseInt(process.env.DB_POOL_TIMEOUT || "10", 10),
};

/**
 * Append connection pool parameters to DATABASE_URL if not already present.
 * This ensures the connection pool is properly configured even if not in the URL.
 */
function getDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL || "";
  
  if (!baseUrl) {
    return baseUrl;
  }

  const url = new URL(baseUrl);
  
  // Only set if not already configured in the URL
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", String(DB_CONFIG.connectionLimit));
  }
  if (!url.searchParams.has("pool_timeout")) {
    url.searchParams.set("pool_timeout", String(DB_CONFIG.poolTimeout));
  }
  
  return url.toString();
}

function createPrismaClient(): PrismaClient {
  const isProduction = process.env.NODE_ENV === "production";
  
  const client = new PrismaClient({
    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },
    log: isProduction
      ? ["error", "warn"]
      : ["query", "info", "warn", "error"],
  });

  // Log connection pool configuration on startup
  if (!isProduction) {
    console.log("[Prisma] Connection pool configured:", {
      connectionLimit: DB_CONFIG.connectionLimit,
      poolTimeout: DB_CONFIG.poolTimeout,
    });
  }

  return client;
}

const prisma: PrismaClient = global.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

export default prisma;

