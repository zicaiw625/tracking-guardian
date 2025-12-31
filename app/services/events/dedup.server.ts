/**
 * 去重服务 - 生成 event_id、检测重复
 * 
 * 这个服务负责生成唯一的事件 ID，并检测重复事件
 */

import { generateEventId as generateCryptoEventId } from "~/utils/crypto.server";
import type { PixelEventPayload } from "~/routes/api.pixel-events/types";

export interface DeduplicationResult {
  eventId: string;
  isDuplicate: boolean;
  existingEventId?: string;
  deduplicationKey: string;
}

/**
 * 生成事件 ID
 */
export function generateEventId(
  shopDomain: string,
  orderId: string | null,
  eventName: string,
  checkoutToken?: string | null
): string {
  // 优先使用订单 ID
  if (orderId) {
    return generateCryptoEventId(orderId, eventName, shopDomain);
  }

  // 如果没有订单 ID，使用 checkout token
  if (checkoutToken) {
    const hashInput = `${shopDomain}:${checkoutToken}:${eventName}`;
    return require("crypto")
      .createHash("sha256")
      .update(hashInput, "utf8")
      .digest("hex")
      .substring(0, 32);
  }

  // 最后使用时间戳 + 随机数
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const hashInput = `${shopDomain}:${timestamp}:${random}:${eventName}`;
  return require("crypto")
    .createHash("sha256")
    .update(hashInput, "utf8")
    .digest("hex")
    .substring(0, 32);
}

/**
 * 生成去重键（用于检测重复）
 */
export function generateDeduplicationKey(
  shopId: string,
  eventId: string,
  destinationType: string
): string {
  return `${shopId}:${eventId}:${destinationType}`;
}

/**
 * 从 payload 提取去重信息
 */
export function extractDeduplicationInfo(
  payload: PixelEventPayload,
  shopDomain: string
): {
  orderId: string | null;
  checkoutToken: string | null;
  eventName: string;
} {
  return {
    orderId: payload.data?.orderId || payload.data?.order_id || null,
    checkoutToken: payload.data?.checkoutToken || payload.data?.checkout_token || null,
    eventName: payload.eventName,
  };
}

/**
 * 创建去重结果
 */
export function createDeduplicationResult(
  eventId: string,
  isDuplicate: boolean,
  existingEventId?: string
): DeduplicationResult {
  return {
    eventId,
    isDuplicate,
    existingEventId,
    deduplicationKey: eventId, // 简化版本，实际应该包含更多信息
  };
}

/**
 * 验证事件 ID 格式
 */
export function isValidEventId(eventId: string): boolean {
  // Event ID 应该是 32 字符的十六进制字符串
  return /^[a-f0-9]{32}$/i.test(eventId);
}

/**
 * 生成客户端 + 服务端混合去重键（v2 功能）
 */
export function generateHybridDeduplicationKey(
  clientEventId: string | null,
  serverEventId: string,
  destinationType: string
): string {
  if (clientEventId && isValidEventId(clientEventId)) {
    return `${destinationType}:client:${clientEventId}`;
  }
  return `${destinationType}:server:${serverEventId}`;
}

