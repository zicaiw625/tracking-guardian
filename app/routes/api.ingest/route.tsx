/**
 * P0-1: PRD 对齐 - POST /api/ingest 端点
 * 
 * PRD 8.2 要求：
 * - POST /ingest: PRD 中定义的主要端点（推荐使用）
 * - POST /api/ingest: 向后兼容别名，支持批量格式
 * - POST /api/pixel-events: 实际实现端点（内部使用，单事件格式）
 * 
 * 此路由实现 PRD 要求的批量事件接口，完全符合 PRD 8.2 规范：
 * - 支持批量事件格式：{ events: [event1, event2, ...] }
 * - 支持 HMAC 签名验证（X-Tracking-Guardian-Signature header）
 * - 支持时间戳验证（X-Tracking-Guardian-Timestamp header 或 body 中的 timestamp）
 * - 同时保留对单事件格式的向后兼容（自动检测格式）
 * 
 * 注意：
 * - 批量格式：{ events: [event1, event2, ...], timestamp?: number }
 * - 单事件格式（向后兼容）：直接发送单个事件对象，委托给 /api/pixel-events
 * - /api/pixel-events 作为向后兼容别名，继续支持单事件格式
 * - Web Pixel Extension 使用批量格式发送事件，提高性能
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { action as ingestAction, loader as ingestLoader } from "../ingest";

/**
 * POST /api/ingest 端点
 * 委托给 /ingest 的实现（支持批量格式，符合 PRD 8.2）
 */
export const action = async (args: ActionFunctionArgs) => {
  return ingestAction(args);
};

/**
 * GET /api/ingest 端点（用于健康检查）
 */
export const loader = async (args: LoaderFunctionArgs) => {
  return ingestLoader(args);
};

