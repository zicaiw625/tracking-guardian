

import type { RedisClientType } from "redis";

export interface RedisClientWrapper {

  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<void>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean>;
  ttl(key: string): Promise<number>;

  hGetAll(key: string): Promise<Record<string, string>>;
  hSet(key: string, field: string, value: string): Promise<number>;
  hMSet(key: string, fields: Record<string, string>): Promise<void>;
  hIncrBy(key: string, field: string, increment: number): Promise<number>;

  keys(pattern: string): Promise<string[]>;

  isConnected(): boolean;
  getConnectionInfo(): ConnectionInfo;
}

export interface ConnectionInfo {
  connected: boolean;
  mode: "redis" | "memory";
  url?: string;
  lastError?: string;
  reconnectAttempts: number;
}

interface MemoryEntry {
  value: string;
  expiresAt?: number;
}

interface MemoryHashEntry {
  fields: Record<string, string>;
  expiresAt?: number;
}

class InMemoryFallback implements RedisClientWrapper {
  private stringStore = new Map<string, MemoryEntry>();
  private hashStore = new Map<string, MemoryHashEntry>();
  private maxSize: number;

  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
  }

  private isExpired(expiresAt?: number): boolean {
    return expiresAt !== undefined && expiresAt < Date.now();
  }

  private cleanup(): void {

    for (const [key, entry] of this.stringStore.entries()) {
      if (this.isExpired(entry.expiresAt)) {
        this.stringStore.delete(key);
      }
    }

    for (const [key, entry] of this.hashStore.entries()) {
      if (this.isExpired(entry.expiresAt)) {
        this.hashStore.delete(key);
      }
    }

    const totalSize = this.stringStore.size + this.hashStore.size;
    if (totalSize >= this.maxSize * 0.9) {
      const targetSize = Math.floor(this.maxSize * 0.7);
      const toRemove = totalSize - targetSize;

      let removed = 0;
      for (const key of this.stringStore.keys()) {
        if (removed >= toRemove) break;
        this.stringStore.delete(key);
        removed++;
      }
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.stringStore.get(key);
    if (!entry) return null;
    if (this.isExpired(entry.expiresAt)) {
      this.stringStore.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    options?: { EX?: number }
  ): Promise<void> {
    if (this.stringStore.size >= this.maxSize) {
      this.cleanup();
    }

    const entry: MemoryEntry = { value };
    if (options?.EX) {
      entry.expiresAt = Date.now() + options.EX * 1000;
    }
    this.stringStore.set(key, entry);
  }

  async del(key: string): Promise<number> {
    const hadString = this.stringStore.delete(key);
    const hadHash = this.hashStore.delete(key);
    return hadString || hadHash ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const entry = this.stringStore.get(key);
    let value = 0;

    if (entry && !this.isExpired(entry.expiresAt)) {
      value = parseInt(entry.value, 10) || 0;
    }

    value++;
    this.stringStore.set(key, {
      value: String(value),
      expiresAt: entry?.expiresAt,
    });

    return value;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const stringEntry = this.stringStore.get(key);
    if (stringEntry) {
      stringEntry.expiresAt = Date.now() + seconds * 1000;
      return true;
    }

    const hashEntry = this.hashStore.get(key);
    if (hashEntry) {
      hashEntry.expiresAt = Date.now() + seconds * 1000;
      return true;
    }

    return false;
  }

  async ttl(key: string): Promise<number> {
    const stringEntry = this.stringStore.get(key);
    if (stringEntry?.expiresAt) {
      const remaining = Math.ceil((stringEntry.expiresAt - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    }

    const hashEntry = this.hashStore.get(key);
    if (hashEntry?.expiresAt) {
      const remaining = Math.ceil((hashEntry.expiresAt - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    }

    if (stringEntry || hashEntry) {
      return -1;
    }

    return -2;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    const entry = this.hashStore.get(key);
    if (!entry) return {};
    if (this.isExpired(entry.expiresAt)) {
      this.hashStore.delete(key);
      return {};
    }
    return { ...entry.fields };
  }

  async hSet(key: string, field: string, value: string): Promise<number> {
    let entry = this.hashStore.get(key);
    const isNew = !entry || !entry.fields[field];

    if (!entry) {
      entry = { fields: {} };
      this.hashStore.set(key, entry);
    }

    entry.fields[field] = value;
    return isNew ? 1 : 0;
  }

  async hMSet(key: string, fields: Record<string, string>): Promise<void> {
    let entry = this.hashStore.get(key);
    if (!entry) {
      entry = { fields: {} };
      this.hashStore.set(key, entry);
    }

    Object.assign(entry.fields, fields);
  }

  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    let entry = this.hashStore.get(key);
    if (!entry) {
      entry = { fields: {} };
      this.hashStore.set(key, entry);
    }

    const current = parseInt(entry.fields[field] || "0", 10);
    const newValue = current + increment;
    entry.fields[field] = String(newValue);

    return newValue;
  }

  async keys(pattern: string): Promise<string[]> {

    const prefix = pattern.replace(/\*$/, "");
    const results: string[] = [];

    for (const key of this.stringStore.keys()) {
      if (key.startsWith(prefix)) {
        results.push(key);
      }
    }

    for (const key of this.hashStore.keys()) {
      if (key.startsWith(prefix)) {
        results.push(key);
      }
    }

    return results;
  }

  isConnected(): boolean {
    return true;
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      connected: true,
      mode: "memory",
      reconnectAttempts: 0,
    };
  }
}

class RedisClientFactory {
  private static instance: RedisClientFactory | null = null;
  private client: RedisClientWrapper | null = null;
  private rawClient: RedisClientType | null = null;
  private initPromise: Promise<RedisClientWrapper> | null = null;
  private connectionInfo: ConnectionInfo = {
    connected: false,
    mode: "memory",
    reconnectAttempts: 0,
  };
  private fallback: InMemoryFallback;

  private constructor() {
    const maxKeys = parseInt(process.env.RATE_LIMIT_MAX_KEYS || "10000", 10);
    this.fallback = new InMemoryFallback(maxKeys);
  }

  static getInstance(): RedisClientFactory {
    if (!RedisClientFactory.instance) {
      RedisClientFactory.instance = new RedisClientFactory();
    }
    return RedisClientFactory.instance;
  }

  async getClient(): Promise<RedisClientWrapper> {
    if (this.client) {
      return this.client;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.initialize();
    return this.initPromise;
  }

  getClientSync(): RedisClientWrapper {
    return this.client || this.fallback;
  }

  private async initialize(): Promise<RedisClientWrapper> {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {

      console.log("[REDIS] No REDIS_URL configured, using in-memory store");
      if (process.env.NODE_ENV === "production") {

        console.warn(
          "[REDIS] ⚠️ In-memory store in production - rate limiting will not be shared across instances"
        );
      }
      this.client = this.fallback;
      this.connectionInfo = {
        connected: true,
        mode: "memory",
        reconnectAttempts: 0,
      };
      return this.client;
    }

    try {
      const { createClient } = await import("redis");
      const client = createClient({ url: redisUrl });

      client.on("error", (err) => {

        console.error("[REDIS] Client error:", err.message);
        this.connectionInfo.lastError = err.message;
        this.connectionInfo.connected = false;
      });

      client.on("reconnecting", () => {
        this.connectionInfo.reconnectAttempts++;

        console.log(
          `[REDIS] Reconnecting (attempt ${this.connectionInfo.reconnectAttempts})...`
        );
      });

      client.on("connect", () => {
        this.connectionInfo.connected = true;
        this.connectionInfo.lastError = undefined;

        console.log("[REDIS] Connected");
      });

      await client.connect();

      this.rawClient = client as RedisClientType;
      this.client = this.createWrapper(client as RedisClientType);
      this.connectionInfo = {
        connected: true,
        mode: "redis",
        url: redisUrl.replace(/\/\/[^:]+:[^@]+@/, "
        reconnectAttempts: 0,
      };

      console.log("[REDIS] ✅ Redis client connected and ready");

      return this.client;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      console.error("[REDIS] Failed to connect:", errorMsg);

      console.warn("[REDIS] ⚠️ Falling back to in-memory store");

      this.connectionInfo = {
        connected: true,
        mode: "memory",
        lastError: errorMsg,
        reconnectAttempts: 0,
      };

      this.client = this.fallback;
      return this.client;
    }
  }

  private createWrapper(client: RedisClientType): RedisClientWrapper {
    return {
      get: async (key: string): Promise<string | null> => {
        try {
          return await client.get(key);
        } catch {
          return this.fallback.get(key);
        }
      },

      set: async (
        key: string,
        value: string,
        options?: { EX?: number }
      ): Promise<void> => {
        try {
          if (options?.EX) {
            await client.set(key, value, { EX: options.EX });
          } else {
            await client.set(key, value);
          }
        } catch {
          await this.fallback.set(key, value, options);
        }
      },

      del: async (key: string): Promise<number> => {
        try {
          return await client.del(key);
        } catch {
          return this.fallback.del(key);
        }
      },

      incr: async (key: string): Promise<number> => {
        try {
          return await client.incr(key);
        } catch {
          return this.fallback.incr(key);
        }
      },

      expire: async (key: string, seconds: number): Promise<boolean> => {
        try {
          return await client.expire(key, seconds);
        } catch {
          return this.fallback.expire(key, seconds);
        }
      },

      ttl: async (key: string): Promise<number> => {
        try {
          return await client.ttl(key);
        } catch {
          return this.fallback.ttl(key);
        }
      },

      hGetAll: async (key: string): Promise<Record<string, string>> => {
        try {
          return await client.hGetAll(key);
        } catch {
          return this.fallback.hGetAll(key);
        }
      },

      hSet: async (key: string, field: string, value: string): Promise<number> => {
        try {
          return await client.hSet(key, field, value);
        } catch {
          return this.fallback.hSet(key, field, value);
        }
      },

      hMSet: async (key: string, fields: Record<string, string>): Promise<void> => {
        try {
          await client.hSet(key, fields);
        } catch {
          await this.fallback.hMSet(key, fields);
        }
      },

      hIncrBy: async (
        key: string,
        field: string,
        increment: number
      ): Promise<number> => {
        try {
          return await client.hIncrBy(key, field, increment);
        } catch {
          return this.fallback.hIncrBy(key, field, increment);
        }
      },

      keys: async (pattern: string): Promise<string[]> => {
        try {
          return await client.keys(pattern);
        } catch {
          return this.fallback.keys(pattern);
        }
      },

      isConnected: (): boolean => {
        return this.connectionInfo.connected;
      },

      getConnectionInfo: (): ConnectionInfo => {
        return { ...this.connectionInfo };
      },
    };
  }

  getConnectionInfo(): ConnectionInfo {
    return { ...this.connectionInfo };
  }

  async close(): Promise<void> {
    if (this.rawClient) {
      try {
        await this.rawClient.quit();

        console.log("[REDIS] Connection closed");
      } catch (error) {

        console.error("[REDIS] Error closing connection:", error);
      }
      this.rawClient = null;
      this.client = null;
    }
    this.initPromise = null;
  }

  static reset(): void {
    if (RedisClientFactory.instance) {
      RedisClientFactory.instance.close().catch((error) => {

        console.error("[REDIS] Error closing connection during reset:", error);
      });
      RedisClientFactory.instance = null;
    }
  }
}

export async function getRedisClient(): Promise<RedisClientWrapper> {
  return RedisClientFactory.getInstance().getClient();
}

export function getRedisClientSync(): RedisClientWrapper {
  return RedisClientFactory.getInstance().getClientSync();
}

export function getRedisConnectionInfo(): ConnectionInfo {
  return RedisClientFactory.getInstance().getConnectionInfo();
}

export async function closeRedisConnection(): Promise<void> {
  await RedisClientFactory.getInstance().close();
}

export { RedisClientFactory };

