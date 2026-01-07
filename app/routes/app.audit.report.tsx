import { ScanPage, loader, action } from "./app.scan";

export { loader, action };

export default function AuditReportRoute() {
  return (
    <ScanPage
      initialTab={2}
      showTabs={false}
      pageTitle="Audit 迁移报告"
      pageSubtitle="迁移清单 • 资产/风险 • 推荐路径 • 预计工时"
    />
  );
}
