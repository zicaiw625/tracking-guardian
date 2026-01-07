import { ScanPage, loader, action } from "./app.scan";

export { loader, action };

export default function AuditManualRoute() {
  return (
    <ScanPage
      initialTab={1}
      showTabs={false}
      pageTitle="Audit 手动补充"
      pageSubtitle="Additional Scripts 粘贴 • 渠道勾选 • 上传清单"
    />
  );
}
