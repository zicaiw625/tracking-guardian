export { loader, action } from "./app.scan";
import { ScanPage } from "./app.scan";

export default function AuditScanPage() {
  return <ScanPage initialTab={0} showTabs={true} pageTitle="Audit 自动扫描" pageSubtitle="自动扫描 ScriptTags 和已安装的像素配置，并给出风险等级与迁移建议" />;
}
