import type { TestChecklist, TestChecklistItem } from "~/services/verification-checklist.server";
import { escapeCSV } from "~/utils/csv";
import type { TFunction } from "i18next";

export type TestChecklistInput = Omit<TestChecklist, "generatedAt"> & { generatedAt?: Date | string };

function formatTime(minutes: number, t?: TFunction): string {
  if (t) {
    if (minutes < 60) return t("verificationChecklist.markdown.minutes", { count: minutes });
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0
      ? t("verificationChecklist.markdown.hoursMinutes", { hours, minutes: mins })
      : t("verificationChecklist.markdown.hours", { count: hours });
  }
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function generateChecklistMarkdown(checklist: TestChecklistInput, t?: TFunction): string {
  const mk = (key: string) => t ? t(`verificationChecklist.markdown.${key}`) : key;
  const testTypeLabel = checklist.testType === "quick"
    ? mk("testTypeQuick")
    : checklist.testType === "full"
      ? mk("testTypeFull")
      : mk("testTypeCustom");

  let markdown = `# ${mk("title")}\n\n`;
  markdown += `**${mk("generatedAt")}**: ${new Date(checklist.generatedAt ?? 0).toLocaleString()}\n`;
  markdown += `**${mk("testType")}**: ${testTypeLabel}\n`;
  markdown += `**${mk("estimatedTotalTime")}**: ${formatTime(checklist.totalEstimatedTime, t)}\n`;
  markdown += `**${mk("requiredItems")}**: ${checklist.requiredItemsCount} | **${mk("optionalItems")}**: ${checklist.optionalItemsCount}\n\n`;
  markdown += `---\n\n`;

  const categories: Record<string, TestChecklistItem[]> = { purchase: [], cart: [] };
  for (const item of checklist.items) {
    if (categories[item.category]) categories[item.category].push(item);
  }
  const categoryLabels: Record<string, string> = {
    purchase: mk("categoryPurchase"),
    cart: mk("categoryCart"),
  };

  for (const [category, items] of Object.entries(categories)) {
    if (items.length === 0) continue;
    markdown += `## ${categoryLabels[category]}\n\n`;
    for (const item of items) {
      markdown += `### ${item.required ? "✅" : "⚪"} ${item.name}\n\n`;
      markdown += `**${mk("description")}**: ${item.description}\n\n`;
      markdown += `**${mk("platforms")}**: ${item.platforms.join(", ")}\n\n`;
      markdown += `**${mk("estimatedTime")}**: ${formatTime(item.estimatedTime, t)}\n\n`;
      markdown += `**${mk("stepsLabel")}**:\n`;
      for (const step of item.steps) markdown += `- ${step}\n`;
      markdown += `\n**${mk("expectedResults")}**:\n`;
      for (const result of item.expectedResults) markdown += `- ${result}\n`;
      markdown += `\n---\n\n`;
    }
  }

  markdown += `## ${mk("completionChecklist")}\n\n`;
  markdown += `- [ ] ${mk("allRequiredDone")}\n`;
  markdown += `- [ ] ${mk("allEventsFired")}\n`;
  markdown += `- [ ] ${mk("paramsComplete")}\n`;
  markdown += `- [ ] ${mk("amountsMatch")}\n`;
  markdown += `- [ ] ${mk("allPlatformsReceived")}\n`;
  markdown += `- [ ] ${mk("thirdPartyVerified")}\n\n`;
  return markdown;
}

export function generateChecklistCSV(checklist: TestChecklistInput, t?: TFunction): string {
  const ck = (key: string) => t ? t(`verificationChecklist.csv.${key}`) : key;
  const headers = [
    ck("id"), ck("name"), ck("description"), ck("eventType"),
    ck("required"), ck("platforms"), ck("estimatedTime"),
    ck("category"), ck("status"),
  ];
  const rows = checklist.items.map((item) => [
    item.id,
    item.name,
    item.description,
    item.eventType,
    item.required ? ck("yes") : ck("no"),
    item.platforms.join(";"),
    String(item.estimatedTime),
    item.category,
    ck("notTested"),
  ]);
  return [headers, ...rows]
    .map((row) => row.map((cell) => escapeCSV(String(cell))).join(","))
    .join("\n");
}
