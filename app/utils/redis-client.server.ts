import type { RedisClientType } from "redis";
import { logger } from "./logger.server";
import { EventEmitter } from "events";

export interface RedisClientWrapper {
  get(key: string): Promise<string | null>;
  mGet(keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, options?: { EX?: number }): Promise<void>;
  setNX(key: string, value: string, ttlMs: number): Promise<boolean>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean>;
  ttl(key: string): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hGet(key: string, field: string): Promise<string | null>;
  hSet(key: string, field: string, value: string): Promise<number>;
  hMSet(key: string, fields: Record<string, string>): Promise<void>;
  hDel(key: string, ...fields: string[]): Promise<number>;
  hIncrBy(key: string, field: string, increment: number): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  scan(cursor: string, pattern: string, count?: number): Promise<{ cursor: string; keys: string[] }>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, onMessage: (message: string) => void): Promise<() => Promise<void>>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  lPush(key: string, ...values: string[]): Promise<number>;
  rPop(key: string): Promise<string | null>;
  lTrim(key: string, start: number, stop: number): Promise<void>;
  lLen(key: string): Promise<number>;
  lRem(key: string, count: number, element: string): Promise<number>;
  lIndex(key: string, index: number): Promise<string | null>;
  lSet(key: string, index: number, element: string): Promise<void>;
  rPopLPush(source: string, destination: string): Promise<string | null>;
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
  private static emitter = (() => {
    const e = new EventEmitter();
    e.setMaxListeners(0);
    return e;
  })();
  private stringStore = new Map<string, MemoryEntry>();
  private hashStore = new Map<string, MemoryHashEntry>();
  private listStore = new Map<string, string[]>();
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
  async mGet(keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map(key => this.get(key)));
  }
  async set(key: string, value: string, options?: { EX?: number }): Promise<void> {
    if (this.stringStore.size >= this.maxSize) {
      this.cleanup();
    }
    const entry: MemoryEntry = { value };
    if (options?.EX) {
      entry.expiresAt = Date.now() + options.EX * 1000;
    }
    this.stringStore.set(key, entry);
  }
  async setNX(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.stringStore.has(key)) {
      const entry = this.stringStore.get(key);
      if (entry && (!entry.expiresAt || entry.expiresAt > Date.now())) {
        return false;
      }
    }
    if (this.stringStore.size >= this.maxSize) {
      this.cleanup();
    }
    this.stringStore.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    return true;
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
  async decr(key: string): Promise<number> {
    const entry = this.stringStore.get(key);
    let value = 0;
    if (entry && !this.isExpired(entry.expiresAt)) {
      value = parseInt(entry.value, 10) || 0;
    }
    value--;
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
  async hGet(key: string, field: string): Promise<string | null> {
    const entry = this.hashStore.get(key);
    if (!entry) return null;
    if (this.isExpired(entry.expiresAt)) {
      this.hashStore.delete(key);
      return null;
    }
    return entry.fields[field] ?? null;
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
  async hDel(key: string, ...fields: string[]): Promise<number> {
    const entry = this.hashStore.get(key);
    if (!entry) return 0;
    if (this.isExpired(entry.expiresAt)) {
      this.hashStore.delete(key);
      return 0;
    }
    let removed = 0;
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(entry.fields, field)) {
        delete entry.fields[field];
        removed++;
      }
    }
    if (Object.keys(entry.fields).length === 0) {
      this.hashStore.delete(key);
    }
    return removed;
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
  async scan(cursor: string, pattern: string, count: number = 100): Promise<{ cursor: string; keys: string[] }> {
    const keys = await this.keys(pattern);
    const start = Number.parseInt(cursor, 10);
    const offset = Number.isNaN(start) ? 0 : start;
    const batch = keys.slice(offset, offset + count);
    const nextOffset = offset + count;
    const nextCursor = nextOffset >= keys.length ? "0" : String(nextOffset);
    return { cursor: nextCursor, keys: batch };
  }
  async publish(channel: string, message: string): Promise<number> {
    InMemoryFallback.emitter.emit(channel, message);
    return 1;
  }
  async subscribe(channel: string, onMessage: (message: string) => void): Promise<() => Promise<void>> {
    const listener = (message: string) => onMessage(message);
    InMemoryFallback.emitter.on(channel, listener);
    return async () => {
      InMemoryFallback.emitter.off(channel, listener);
    };
  }
  async eval(_script: string, _keys: string[], _args: string[]): Promise<unknown> {
    throw new Error("Redis eval is not supported in memory mode");
  }
  async lPush(key: string, ...values: string[]): Promise<number> {
    let list = this.listStore.get(key);
    if (!list) {
      list = [];
      this.listStore.set(key, list);
    }
    for (let i = values.length - 1; i >= 0; i--) {
      list.unshift(values[i]);
    }
    return list.length;
  }
  async rPop(key: string): Promise<string | null> {
    const list = this.listStore.get(key);
    if (!list || list.length === 0) return null;
    const value = list.pop()!;
    if (list.length === 0) this.listStore.delete(key);
    return value;
  }
  async lTrim(key: string, start: number, stop: number): Promise<void> {
    const list = this.listStore.get(key);
    if (!list) return;
    const trimmed = list.slice(start, stop + 1);
    if (trimmed.length === 0) {
      this.listStore.delete(key);
    } else {
      this.listStore.set(key, trimmed);
    }
  }
  async lLen(key: string): Promise<number> {
    const list = this.listStore.get(key);
    return list ? list.length : 0;
  }
  async lRem(key: string, count: number, element: string): Promise<number> {
    const list = this.listStore.get(key);
    if (!list) return 0;
    let removed = 0;
    if (count > 0) {
      for (let i = 0; i < list.length && removed < count; i++) {
        if (list[i] === element) {
          list.splice(i, 1);
          removed++;
          i--;
        }
      }
    } else {
      // Remove all occurrences (count = 0) or handle negative logic if needed (not implemented)
      const initialLen = list.length;
      const newList = list.filter((x) => x !== element);
      removed = initialLen - newList.length;
      this.listStore.set(key, newList);
    }
    return removed;
  }
  async lIndex(key: string, index: number): Promise<string | null> {
    const list = this.listStore.get(key);
    if (!list) return null;
    const idx = index < 0 ? list.length + index : index;
    return list[idx] || null;
  }
  async lSet(key: string, index: number, element: string): Promise<void> {
    const list = this.listStore.get(key);
    if (!list) {
      throw new Error("ERR no such key");
    }
    const idx = index < 0 ? list.length + index : index;
    if (idx < 0 || idx >= list.length) {
      throw new Error("ERR index out of range");
    }
    list[idx] = element;
  }
  async rPopLPush(source: string, destination: string): Promise<string | null> {
    const value = await this.rPop(source);
    if (value !== null) {
      await this.lPush(destination, value);
    }
    return value;
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
  private strictClient: RedisClientWrapper | null = null;
  private rawClient: RedisClientType | null = null;
  private initPromise: Promise<RedisClientWrapper> | null = null;
  private connectionInfo: ConnectionInfo = {
    connected: false,
    mode: "memory",
    reconnectAttempts: 0,
  };
  private fallback: InMemoryFallback;
  private lastReconnectLogAt = 0;
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
  async getStrictClient(): Promise<RedisClientWrapper> {
    await this.getClient();
    if (this.connectionInfo.mode !== "redis" || !this.connectionInfo.connected || !this.strictClient) {
      throw new Error("Redis strict client unavailable");
    }
    return this.strictClient;
  }
  getClientSync(): RedisClientWrapper {
    return this.client || this.fallback;
  }
  private async initialize(): Promise<RedisClientWrapper> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_MEMORY_REDIS_IN_PROD !== "true") {
        throw new Error("REDIS_URL is required in production (rate-limit/locks need shared storage). Set ALLOW_MEMORY_REDIS_IN_PROD=true to bypass.");
      }
      if (process.env.NODE_ENV === "production") {
        logger.warn("[REDIS] Using in-memory store in production (ALLOW_MEMORY_REDIS_IN_PROD=true). Multi-instance deployments will have inconsistent state.");
      }
      logger.info("[REDIS] No REDIS_URL configured, using in-memory store");
      this.client = this.fallback;
      this.strictClient = null;
      this.connectionInfo = {
        connected: true,
        mode: "memory",
        reconnectAttempts: 0,
      };
      return this.client;
    }
    try {
      const { createClient } = await import("redis");
      const maxDelayMs = Math.max(1000, parseInt(process.env.REDIS_RECONNECT_MAX_DELAY_MS || "30000", 10) || 30000);
      const baseDelayMs = Math.max(100, parseInt(process.env.REDIS_RECONNECT_BASE_DELAY_MS || "500", 10) || 500);
      const connectTimeoutMs = Math.max(1000, parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || "5000", 10) || 5000);
      const initTimeoutMs = Math.max(
        1000,
        parseInt(process.env.REDIS_INIT_TIMEOUT_MS || String(connectTimeoutMs + 3000), 10) || (connectTimeoutMs + 3000)
      );

      const client = createClient({
        url: redisUrl,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: connectTimeoutMs,
          reconnectStrategy: (retries: number) => {
            const attempt = retries + 1;
            this.connectionInfo.reconnectAttempts = attempt;
            const exp = Math.min(maxDelayMs, Math.round(baseDelayMs * Math.pow(1.7, retries)));
            const jitter = Math.floor(exp * (0.2 * Math.random()));
            const delayMs = Math.min(maxDelayMs, exp + jitter);
            const now = Date.now();
            const shouldLog = attempt === 1 || attempt % 10 === 0 || now - this.lastReconnectLogAt > 60_000;
            if (shouldLog) {
              this.lastReconnectLogAt = now;
              logger.info(`[REDIS] Reconnecting (attempt ${attempt})...`, {
                delayMs,
                maxDelayMs,
              });
            }
            return delayMs;
          },
        },
      });
      client.on("error", (err) => {
        const errMsg =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err && "message" in err
              ? String((err as { message?: unknown }).message)
              : String(err);
        const normalizedError = err instanceof Error ? err : Object.assign(new Error(errMsg), { cause: err as unknown });
        logger.error("[REDIS] Client error", normalizedError, {
          redisErrorType: typeof err,
        });
        this.connectionInfo.lastError = errMsg;
        this.connectionInfo.connected = false;
      });
      client.on("reconnecting", () => {
        this.connectionInfo.connected = false;
      });
      client.on("connect", () => {
        this.connectionInfo.connected = true;
        this.connectionInfo.lastError = undefined;
        logger.info("[REDIS] Connected");
      });
      this.connectionInfo = {
        connected: false,
        mode: "redis",
        url: redisUrl.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"),
        reconnectAttempts: 0,
      };
      logger.info("[REDIS] Connecting...", { url: this.connectionInfo.url });
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Redis init timeout after ${initTimeoutMs}ms`)), initTimeoutMs)
        ),
      ]);

      this.rawClient = client as RedisClientType;
      this.client = this.createWrapper(client as RedisClientType);
      this.strictClient = this.createStrictWrapper(client as RedisClientType);
      return this.client;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("[REDIS] Failed to connect", error, { error: errorMsg });
      if (process.env.NODE_ENV === "production") {
        throw new Error("Failed to connect to Redis in production");
      }
      logger.warn("[REDIS] Falling back to in-memory store");
      this.connectionInfo = {
        connected: true,
        mode: "memory",
        lastError: errorMsg,
        reconnectAttempts: 0,
      };
      this.client = this.fallback;
      this.strictClient = null;
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
      mGet: async (keys: string[]): Promise<(string | null)[]> => {
        try {
          return await client.mGet(keys);
        } catch {
          return this.fallback.mGet(keys);
        }
      },
      set: async (key: string, value: string, options?: { EX?: number }): Promise<void> => {
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
      setNX: async (key: string, value: string, ttlMs: number): Promise<boolean> => {
        try {
          const result = await client.set(key, value, { NX: true, PX: ttlMs });
          return result !== null;
        } catch {
          return this.fallback.setNX(key, value, ttlMs);
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
      decr: async (key: string): Promise<number> => {
        try {
          return await client.decr(key);
        } catch {
          return this.fallback.decr(key);
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
      hGet: async (key: string, field: string): Promise<string | null> => {
        try {
          return (await client.hGet(key, field)) ?? null;
        } catch {
          return this.fallback.hGet(key, field);
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
      hDel: async (key: string, ...fields: string[]): Promise<number> => {
        try {
          return await client.hDel(key, fields);
        } catch {
          return this.fallback.hDel(key, ...fields);
        }
      },
      hIncrBy: async (key: string, field: string, increment: number): Promise<number> => {
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
      scan: async (
        cursor: string,
        pattern: string,
        count: number = 100
      ): Promise<{ cursor: string; keys: string[] }> => {
        try {
          const cursorNum = parseInt(cursor, 10);
          const result = await client.scan(Number.isNaN(cursorNum) ? 0 : cursorNum, { MATCH: pattern, COUNT: count });
          return { cursor: String(result.cursor), keys: result.keys };
        } catch {
          return this.fallback.scan(cursor, pattern, count);
        }
      },
      publish: async (channel: string, message: string): Promise<number> => {
        try {
          return await client.publish(channel, message);
        } catch {
          return this.fallback.publish(channel, message);
        }
      },
      subscribe: async (channel: string, onMessage: (message: string) => void): Promise<() => Promise<void>> => {
        try {
          const subscriber = client.duplicate();
          await subscriber.connect();
          await subscriber.subscribe(channel, (message: string) => {
            try {
              onMessage(message);
            } catch {
              void 0;
            }
          });
          return async () => {
            try {
              await subscriber.unsubscribe(channel);
            } finally {
              await subscriber.quit().catch(() => void 0);
            }
          };
        } catch {
          return this.fallback.subscribe(channel, onMessage);
        }
      },
      eval: async (script: string, keys: string[], args: string[]): Promise<unknown> => {
        try {
          return await client.eval(script, { keys, arguments: args });
        } catch (error) {
          logger.error("[REDIS] EVAL failed", error);
          throw error;
        }
      },
      lPush: async (key: string, ...values: string[]): Promise<number> => {
        try {
          return await client.lPush(key, values);
        } catch {
          return this.fallback.lPush(key, ...values);
        }
      },
      rPop: async (key: string): Promise<string | null> => {
        try {
          return await client.rPop(key);
        } catch {
          return this.fallback.rPop(key);
        }
      },
      lTrim: async (key: string, start: number, stop: number): Promise<void> => {
        try {
          await client.lTrim(key, start, stop);
        } catch {
          await this.fallback.lTrim(key, start, stop);
        }
      },
      lLen: async (key: string): Promise<number> => {
        try {
          return await client.lLen(key);
        } catch {
          return this.fallback.lLen(key);
        }
      },
      lRem: async (key: string, count: number, element: string): Promise<number> => {
        try {
          return await client.lRem(key, count, element);
        } catch {
          return this.fallback.lRem(key, count, element);
        }
      },
      lIndex: async (key: string, index: number): Promise<string | null> => {
        try {
          return await client.lIndex(key, index);
        } catch {
          return this.fallback.lIndex(key, index);
        }
      },
      lSet: async (key: string, index: number, element: string): Promise<void> => {
        try {
          await client.lSet(key, index, element);
        } catch {
          await this.fallback.lSet(key, index, element);
        }
      },
      rPopLPush: async (source: string, destination: string): Promise<string | null> => {
        try {
          if (typeof client.lMove === "function") {
            return await client.lMove(source, destination, "RIGHT", "LEFT");
          }
          return await client.rPopLPush(source, destination);
        } catch {
          return this.fallback.rPopLPush(source, destination);
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
  private createStrictWrapper(client: RedisClientType): RedisClientWrapper {
    return {
      get: async (key: string): Promise<string | null> => client.get(key),
      mGet: async (keys: string[]): Promise<(string | null)[]> => client.mGet(keys),
      set: async (key: string, value: string, options?: { EX?: number }): Promise<void> => {
        if (options?.EX) {
          await client.set(key, value, { EX: options.EX });
        } else {
          await client.set(key, value);
        }
      },
      setNX: async (key: string, value: string, ttlMs: number): Promise<boolean> => {
        const result = await client.set(key, value, { NX: true, PX: ttlMs });
        return result !== null;
      },
      del: async (key: string): Promise<number> => client.del(key),
      incr: async (key: string): Promise<number> => client.incr(key),
      decr: async (key: string): Promise<number> => client.decr(key),
      expire: async (key: string, seconds: number): Promise<boolean> => client.expire(key, seconds),
      ttl: async (key: string): Promise<number> => client.ttl(key),
      hGetAll: async (key: string): Promise<Record<string, string>> => client.hGetAll(key),
      hGet: async (key: string, field: string): Promise<string | null> => (await client.hGet(key, field)) ?? null,
      hSet: async (key: string, field: string, value: string): Promise<number> => client.hSet(key, field, value),
      hMSet: async (key: string, fields: Record<string, string>): Promise<void> => {
        await client.hSet(key, fields);
      },
      hDel: async (key: string, ...fields: string[]): Promise<number> => client.hDel(key, fields),
      hIncrBy: async (key: string, field: string, increment: number): Promise<number> => client.hIncrBy(key, field, increment),
      keys: async (pattern: string): Promise<string[]> => client.keys(pattern),
      scan: async (
        cursor: string,
        pattern: string,
        count: number = 100
      ): Promise<{ cursor: string; keys: string[] }> => {
        const cursorNum = parseInt(cursor, 10);
        const result = await client.scan(Number.isNaN(cursorNum) ? 0 : cursorNum, { MATCH: pattern, COUNT: count });
        return { cursor: String(result.cursor), keys: result.keys };
      },
      publish: async (channel: string, message: string): Promise<number> => client.publish(channel, message),
      subscribe: async (channel: string, onMessage: (message: string) => void): Promise<() => Promise<void>> => {
        const subscriber = client.duplicate();
        await subscriber.connect();
        await subscriber.subscribe(channel, (message: string) => {
          onMessage(message);
        });
        return async () => {
          try {
            await subscriber.unsubscribe(channel);
          } finally {
            await subscriber.quit().catch(() => void 0);
          }
        };
      },
      eval: async (script: string, keys: string[], args: string[]): Promise<unknown> => {
        return client.eval(script, { keys, arguments: args });
      },
      lPush: async (key: string, ...values: string[]): Promise<number> => client.lPush(key, values),
      rPop: async (key: string): Promise<string | null> => client.rPop(key),
      lTrim: async (key: string, start: number, stop: number): Promise<void> => {
        await client.lTrim(key, start, stop);
      },
      lLen: async (key: string): Promise<number> => client.lLen(key),
      lRem: async (key: string, count: number, element: string): Promise<number> => {
        try {
          return await client.lRem(key, count, element);
        } catch {
          return this.fallback.lRem(key, count, element);
        }
      },
      lIndex: async (key: string, index: number): Promise<string | null> => client.lIndex(key, index),
      lSet: async (key: string, index: number, element: string): Promise<void> => {
        await client.lSet(key, index, element);
      },
      rPopLPush: async (source: string, destination: string): Promise<string | null> => {
        try {
          if (typeof client.lMove === "function") {
            return await client.lMove(source, destination, "RIGHT", "LEFT");
          }
          return await client.rPopLPush(source, destination);
        } catch {
          return this.fallback.rPopLPush(source, destination);
        }
      },
      isConnected: (): boolean => this.connectionInfo.connected,
      getConnectionInfo: (): ConnectionInfo => ({ ...this.connectionInfo }),
    };
  }
  getConnectionInfo(): ConnectionInfo {
    return { ...this.connectionInfo };
  }
  async close(): Promise<void> {
    if (this.rawClient) {
      try {
        await this.rawClient.quit();
        logger.info("[REDIS] Connection closed");
      } catch (error) {
        logger.error("[REDIS] Error closing connection", error);
      }
      this.rawClient = null;
      this.client = null;
      this.strictClient = null;
    }
    this.initPromise = null;
  }
  static reset(): void {
    if (RedisClientFactory.instance) {
      const instance = RedisClientFactory.instance;
      RedisClientFactory.instance = null;
      instance.close().catch((error) => {
        logger.error("[REDIS] Error closing connection during reset", error);
      });
    }
  }
  static async resetAsync(): Promise<void> {
    if (RedisClientFactory.instance) {
      const instance = RedisClientFactory.instance;
      RedisClientFactory.instance = null;
      try {
        await instance.close();
      } catch (error) {
        logger.error("[REDIS] Error closing connection during resetAsync", error);
        throw error;
      }
    }
  }
}

export async function getRedisClient(): Promise<RedisClientWrapper> {
  return RedisClientFactory.getInstance().getClient();
}

export async function getRedisClientStrict(): Promise<RedisClientWrapper> {
  return RedisClientFactory.getInstance().getStrictClient();
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

