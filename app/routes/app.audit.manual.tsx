export { loader, action } from "./app.scan";
import { ScanPage } from "./app.scan";

export default function AuditManualPage() {
  return <ScanPage initialTab={1} showTabs={true} pageTitle="Audit 手动分析" pageSubtitle="手动粘贴 Additional Scripts 代码进行分析，Shopify API 无法自动读取 checkout.liquid 中的 Additional Scripts" />;
}
