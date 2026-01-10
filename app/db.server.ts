import { PrismaClient } from "@prisma/client";
import { logger } from "./utils/logger.server";

declare global {
  var prisma: PrismaClient;
}

const DB_CONFIG = {
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || "10", 10),
  poolTimeout: parseInt(process.env.DB_POOL_TIMEOUT || "10", 10),
};

function getDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL || "";
  const isProduction = process.env.NODE_ENV === "production";
  if (!baseUrl) {
    if (isProduction) {
      throw new Error(
        "DATABASE_URL environment variable is required in production. " +
        "Please set DATABASE_URL to a valid PostgreSQL connection string."
      );
    }
    return baseUrl;
  }
  try {
    const url = new URL(baseUrl);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", String(DB_CONFIG.connectionLimit));
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", String(DB_CONFIG.poolTimeout));
    }
    return url.toString();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("[DB] Invalid DATABASE_URL format", { error: errorMessage });
    if (isProduction) {
      throw new Error(
        `Invalid DATABASE_URL format: ${errorMessage}. ` +
        "Please provide a valid PostgreSQL connection string."
      );
    }
    return baseUrl;
  }
}

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
    logger.info("[STARTUP] Prisma connection pool configured", {
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

export type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
