
// P0-1: v1.0 版本不包含任何 PCD/PII 处理，因此移除所有订单相关 webhook handlers
// v1.0 仅依赖 Web Pixels 标准事件，不处理订单 webhooks
export { handleAppUninstalled } from "./app-uninstalled.handler";
export {
  handleCustomersDataRequest,
  handleCustomersRedact,
  handleShopRedact,
} from "./gdpr.handler";

