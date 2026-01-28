export { loader, action } from "./app.scan";
import { ScanPage } from "./app.scan";

export default function AuditReportPage() {
  return <ScanPage initialTab={2} showTabs={true} pageTitle="Audit 迁移清单" pageSubtitle="迁移清单 + 风险分级 + 替代路径（Web Pixel / 不可迁移）• 可导出 CSV" showMigrationButtons={true} />;
}
