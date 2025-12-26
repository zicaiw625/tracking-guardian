/**
 * Infrastructure Layer
 *
 * P2-1: Cross-cutting concerns and shared infrastructure:
 * - Database repositories
 * - Cryptography utilities
 * - Caching
 * - Queue management (future)
 */

// Database layer - re-export with namespace to avoid conflicts
export * as db from "./db";

// Cryptography - re-export with namespace
export * as crypto from "./crypto";

// Caching - re-export with namespace
export * as cache from "./cache";

// Also export commonly used items directly
export { prisma } from "./db";
export { encrypt, decrypt, encryptJson, decryptJson } from "./crypto";
export { getRedisClient, SimpleCache, withRateLimit } from "./cache";
