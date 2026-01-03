/**
 * P0-1: PRD 对齐 - POST /ingest 端点
 * 
 * PRD 中定义的端点是 POST /ingest，此路由作为主入口点
 * 实际实现委托给 /api/pixel-events，保持功能一致性
 * 
 * 注意：
 * - 此路由是 PRD 中定义的主要端点
 * - /api/ingest 和 /api/pixel-events 作为向后兼容别名
 * - 所有三个端点功能完全一致，只是路径不同
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { action as pixelEventsAction, loader as pixelEventsLoader } from "./api.pixel-events/route";

/**
 * PRD 定义的 POST /ingest 端点
 * 委托给 /api/pixel-events 的实际实现
 */
export const action = async (args: ActionFunctionArgs) => {
  return pixelEventsAction(args);
};

/**
 * GET /ingest 端点（用于健康检查）
 */
export const loader = async (args: LoaderFunctionArgs) => {
  return pixelEventsLoader(args);
};

