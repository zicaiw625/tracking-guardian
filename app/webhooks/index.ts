
/**
 * P0-1: PRD 对齐 - v1.0 Webhook 模块导出
 * 
 * v1.0 版本策略：
 * - ✅ 仅导出 GDPR 相关 webhook handlers（CUSTOMERS_DATA_REQUEST, CUSTOMERS_REDACT, SHOP_REDACT）
 * - ✅ 导出 APP_UNINSTALLED handler（应用卸载处理）
 * - ❌ 不导出任何订单相关 webhook handlers（orders/paid, orders/cancelled, orders/updated, refunds/create 等）
 * 
 * 原因：
 * - v1.0 版本不包含任何 PCD/PII 处理，完全依赖 Web Pixels 标准事件
 * - 订单相关 webhooks 需要 read_orders scope，v1.0 已移除该 scope
 * - 符合 Shopify 2025-12-10 起强制 PCD/PII 新规（未获批 protected scopes 不会收到 PII 字段）
 * 
 * 审计结论对齐：
 * - ✅ 已移除所有订单相关 webhook handlers（handleOrdersPaid 等）
 * - ✅ 仅保留 GDPR 和 APP_UNINSTALLED handlers
 * - ✅ 确保 TypeScript 编译通过，无缺失导出错误
 */

export type {
  WebhookContext,
  WebhookHandlerResult,
  WebhookLockResult,
  ShopWithPixelConfigs,
  WebhookHandler,
  GDPRJobType,
} from "./types";

export { dispatchWebhook } from "./dispatcher";

// P0-1: v1.0 仅导出 GDPR 和 APP_UNINSTALLED handlers
// 注意：不导出 handleOrdersPaid 或其他订单相关 handlers（v1.0 已移除）
export {
  handleAppUninstalled,
  handleCustomersDataRequest,
  handleCustomersRedact,
  handleShopRedact,
} from "./handlers";

export {
  tryAcquireWebhookLock,
  updateWebhookStatus,
  withIdempotency,
} from "./middleware";

