/**
 * 向后兼容路由：/api/ingest
 * 
 * PRD 中定义的端点是 POST /ingest，但实际实现是 /api/pixel-events
 * 此路由作为向后兼容别名，重定向到实际的实现
 * 
 * 注意：此路由仅用于向后兼容，新代码应直接使用 /api/pixel-events
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

