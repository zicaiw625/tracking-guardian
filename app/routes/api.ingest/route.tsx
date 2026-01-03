/**
 * P0-1: 向后兼容路由：/api/ingest
 * 
 * 路径说明：
 * - POST /ingest: PRD 中定义的主要端点（推荐使用）
 * - POST /api/ingest: 向后兼容别名
 * - POST /api/pixel-events: 实际实现端点（内部使用）
 * 
 * 所有三个端点功能完全一致，都委托给 /api/pixel-events 的实际实现
 * 
 * 注意：
 * - 对外文档应推荐使用 /ingest（符合 PRD）
 * - 现有集成可以继续使用 /api/ingest 或 /api/pixel-events
 * - 所有请求都会转发到 /api/pixel-events 的实际实现，保持功能一致性
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { action as pixelEventsAction, loader as pixelEventsLoader } from "../api.pixel-events/route";

/**
 * 向后兼容的 POST /api/ingest 端点
 * 重定向到 /api/pixel-events 的实际实现
 */
export const action = async (args: ActionFunctionArgs) => {
  return pixelEventsAction(args);
};

/**
 * 向后兼容的 GET /api/ingest 端点
 */
export const loader = async (args: LoaderFunctionArgs) => {
  return pixelEventsLoader(args);
};

