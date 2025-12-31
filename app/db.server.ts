

import { PrismaClient } from "@prisma/client";

declare global {

  var prisma: PrismaClient;
}

const DB_CONFIG = {
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || "10", 10),
  poolTimeout: parseInt(process.env.DB_POOL_TIMEOUT || "10", 10),
};

function getDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL || "";
  if (!baseUrl) {
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
    console.error("[DB] Invalid DATABASE_URL format:", error instanceof Error ? error.message : String(error));
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

    console.log("[STARTUP] Prisma connection pool configured:", {
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
