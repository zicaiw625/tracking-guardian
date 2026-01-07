import { ScanPage, loader, action } from "./app.scan";

export { loader, action };

export default function AuditScanRoute() {
  return (
    <ScanPage
      initialTab={0}
      showTabs={false}
      pageTitle="Audit 自动扫描"
      pageSubtitle="自动扫描结果 + 覆盖说明"
    />
  );
}
