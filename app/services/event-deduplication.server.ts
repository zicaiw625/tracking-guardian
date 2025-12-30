

import crypto from "crypto";
import { logger } from "../utils/logger.server";

/**
 * 生成确定性事件 ID，用于平台去重
 * 
 * 策略：
 * - 对于 purchase 事件：使用 orderId + platform + eventType 的哈希
 * - 对于其他事件：使用 orderId/checkoutToken + platform + eventType + timestampBucket 的哈希
 * 
 * 这样可以确保：
 * 1. 同一订单的同一平台同一事件类型总是生成相同 ID
 * 2. 客户端和服务端发送的事件可以正确去重
 */
export interface GenerateEventIdOptions {
  orderId?: string;
  checkoutToken?: string;
  platform: string;
  eventType: string;
  timestampBucket?: number; // 时间桶（秒），用于非 purchase 事件
  shopDomain?: string;
}

/**
 * 生成事件 ID
 */
export function generateEventId(options: GenerateEventIdOptions): string {
  const {
    orderId,
    checkoutToken,
    platform,
    eventType,
    timestampBucket,
    shopDomain,
  } = options;

  // Purchase 事件使用订单 ID（最可靠）
  if (eventType === "purchase" || eventType === "checkout_completed") {
    if (!orderId) {
      logger.warn("Missing orderId for purchase event, falling back to checkoutToken", {
        checkoutToken,
        platform,
        shopDomain,
      });
      if (checkoutToken) {
        return generateEventIdFromToken(checkoutToken, platform, eventType);
      }
      throw new Error("Cannot generate event ID for purchase event without orderId or checkoutToken");
    }
    
    return generateEventIdFromOrder(orderId, platform, eventType);
  }

  // 其他事件可以使用 checkoutToken 或 orderId，加上时间桶
  const identifier = orderId || checkoutToken;
  if (!identifier) {
    throw new Error("Cannot generate event ID without orderId or checkoutToken");
  }

  const bucket = timestampBucket || getCurrentTimestampBucket();
  return generateEventIdFromIdentifier(identifier, platform, eventType, bucket);
}

/**
 * 从订单 ID 生成事件 ID
 */
function generateEventIdFromOrder(
  orderId: string,
  platform: string,
  eventType: string
): string {
  const normalizedOrderId = normalizeOrderId(orderId);
  const content = `${normalizedOrderId}:${platform}:${eventType}`;
  return hashContent(content);
}

/**
 * 从 checkoutToken 生成事件 ID
 */
function generateEventIdFromToken(
  checkoutToken: string,
  platform: string,
  eventType: string
): string {
  const content = `${checkoutToken}:${platform}:${eventType}`;
  return hashContent(content);
}

/**
 * 从标识符和时间桶生成事件 ID
 */
function generateEventIdFromIdentifier(
  identifier: string,
  platform: string,
  eventType: string,
  timestampBucket: number
): string {
  const content = `${identifier}:${platform}:${eventType}:${timestampBucket}`;
  return hashContent(content);
}

/**
 * 规范化订单 ID（处理 GID 格式）
 */
function normalizeOrderId(orderId: string): string {
  // 如果是 Shopify GID 格式，提取数字 ID
  const gidMatch = orderId.match(/gid:\/\/shopify\/Order\/(\d+)/i);
  if (gidMatch) {
    return gidMatch[1];
  }
  
  // 如果直接是数字，返回数字字符串
  if (/^\d+$/.test(orderId)) {
    return orderId;
  }
  
  // 其他情况直接返回（可能是自定义 ID）
  return orderId;
}

/**
 * 哈希内容生成事件 ID
 */
function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").substring(0, 32);
}

/**
 * 获取当前时间桶（以分钟为单位）
 */
function getCurrentTimestampBucket(): number {
  const now = Math.floor(Date.now() / 1000);
  // 5 分钟时间桶（确保同一时间窗口内的事件可以正确去重）
  return Math.floor(now / 300) * 300;
}

/**
 * 验证事件 ID 格式
 */
export function isValidEventId(eventId: string): boolean {
  // 事件 ID 应该是 32 字符的十六进制字符串
  return /^[a-f0-9]{32}$/i.test(eventId);
}

/**
 * 平台特定的事件 ID 字段名
 */
export function getEventIdFieldName(platform: string): string {
  switch (platform) {
    case "google":
      return "transaction_id"; // GA4 使用 transaction_id
    case "meta":
      return "event_id"; // Meta Pixel 使用 event_id
    case "tiktok":
      return "event_id"; // TikTok 使用 event_id
    case "pinterest":
      return "event_id"; // Pinterest 使用 event_id
    default:
      return "event_id";
  }
}

/**
 * 检查事件是否已发送（基于事件 ID）
 * 这个函数用于在发送前检查，避免重复发送
 */
export interface EventDeduplicationCheck {
  eventId: string;
  platform: string;
  orderId?: string;
  timestamp: Date;
}

/**
 * 生成去重检查键
 */
export function generateDedupKey(eventId: string, platform: string): string {
  return `${platform}:${eventId}`;
}

/**
 * 客户端和服务端混合去重策略
 * 
 * 由于我们同时支持客户端 Web Pixel 和服务端 CAPI，
 * 需要确保同一事件不会被重复计算。
 * 
 * 策略：
 * 1. 客户端像素事件使用 event_id 发送
 * 2. 服务端 CAPI 也使用相同的 event_id
 * 3. 平台根据 event_id 自动去重
 * 
 * 但是，我们需要在应用层面也做一层去重检查，
 * 以避免同一事件被客户端和服务端都发送。
 */
export interface DeduplicationStrategy {
  strategy: "client_priority" | "server_priority" | "first_wins";
  graceWindowSeconds?: number; // 允许的时间窗口
}

/**
 * 默认去重策略：服务端优先（因为服务端更可靠）
 */
export const DEFAULT_DEDUP_STRATEGY: DeduplicationStrategy = {
  strategy: "server_priority",
  graceWindowSeconds: 60, // 60 秒内的重复事件会被忽略
};

/**
 * 检查是否应该发送事件（基于去重策略）
 */
export function shouldSendEvent(
  eventId: string,
  source: "client" | "server",
  strategy: DeduplicationStrategy = DEFAULT_DEDUP_STRATEGY
): boolean {
  // 这个函数应该在应用层面实现，结合数据库查询
  // 这里只是逻辑定义
  
  switch (strategy.strategy) {
    case "server_priority":
      // 服务端优先：如果服务端已发送，客户端不发送
      return source === "server";
      
    case "client_priority":
      // 客户端优先：如果客户端已发送，服务端不发送
      return source === "client";
      
    case "first_wins":
      // 先到先得：需要检查数据库
      return true;
      
    default:
      return true;
  }
}

