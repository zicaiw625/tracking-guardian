import type { TestChecklist, TestChecklistItem } from "~/services/verification-checklist.server";
import { escapeCSV } from "~/utils/csv";
import type { TFunction } from "i18next";

export type TestChecklistInput = Omit<TestChecklist, "generatedAt"> & { generatedAt?: Date | string };

export function generateChecklistMarkdown(checklist: TestChecklistInput, t: TFunction): string {
  const formatTime = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} ${t("verification.checklist.minutes", "min")}`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 
      ? `${hours} ${t("verification.checklist.hours", "h")} ${mins} ${t("verification.checklist.minutes", "min")}`
      : `${hours} ${t("verification.checklist.hours", "h")}`;
  };

  const tr = (key: string) => t(key);

  let markdown = `# ${tr("verification.checklist.title")}\n\n`;
  markdown += `**${tr("verification.checklist.generatedAt")}**: ${new Date(checklist.generatedAt ?? 0).toLocaleString()}\n`;
  markdown += `**${tr("verification.checklist.testType")}**: ${t(`verification.checklist.types.${checklist.testType}`)}\n`;
  markdown += `**${tr("verification.checklist.totalTime")}**: ${formatTime(checklist.totalEstimatedTime)}\n`;
  markdown += `**${tr("verification.checklist.required")}**: ${checklist.requiredItemsCount} | **${tr("verification.checklist.optional")}**: ${checklist.optionalItemsCount}\n\n`;
  markdown += `---\n\n`;

  const categories: Record<string, TestChecklistItem[]> = {
    purchase: [],
    cart: [],
  };
  for (const item of checklist.items) {
    if (categories[item.category]) {
      categories[item.category].push(item);
    }
  }

  const categoryLabels: Record<string, string> = {
    purchase: tr("verification.checklist.purchaseEvents"),
    cart: tr("verification.checklist.cartEvents"),
  };

  for (const [category, items] of Object.entries(categories)) {
    if (items.length === 0) continue;
    markdown += `## ${categoryLabels[category] || category}\n\n`;
    for (const item of items) {
      markdown += `### ${item.required ? "✅" : "⚪"} ${tr(item.name)}\n\n`;
      markdown += `**${tr("verification.checklist.desc")}**: ${tr(item.description)}\n\n`;
      markdown += `**${tr("verification.checklist.platforms")}**: ${item.platforms.join(", ")}\n\n`;
      markdown += `**${tr("verification.checklist.estTime")}**: ${formatTime(item.estimatedTime)}\n\n`;
      
      markdown += `**${tr("verification.checklist.steps")}**:\n`;
      for (const step of item.steps) {
        markdown += `- ${tr(step)}\n`;
      }
      markdown += `\n`;
      
      markdown += `**${tr("verification.checklist.expectedResults")}**:\n`;
      for (const result of item.expectedResults) {
        markdown += `- ${tr(result)}\n`;
      }
      markdown += `\n`;
      markdown += `---\n\n`;
    }
  }

  markdown += `## ${tr("verification.checklist.completeCheck")}\n\n`;
  markdown += `- [ ] ${tr("verification.checklist.checks.required")}\n`;
  markdown += `- [ ] ${tr("verification.checklist.checks.triggered")}\n`;
  markdown += `- [ ] ${tr("verification.checklist.checks.params")}\n`;
  markdown += `- [ ] ${tr("verification.checklist.checks.amount")}\n`;
  markdown += `- [ ] ${tr("verification.checklist.checks.platforms")}\n`;
  markdown += `- [ ] ${tr("verification.checklist.checks.thirdParty")}\n\n`;

  return markdown;
}

export function generateChecklistCSV(checklist: TestChecklistInput, t: TFunction): string {
  const tr = (key: string) => t(key);
  const headers = [
    tr("verification.checklist.headers.id"),
    tr("verification.checklist.headers.name"),
    tr("verification.checklist.headers.desc"),
    tr("verification.checklist.headers.eventType"),
    tr("verification.checklist.headers.required"),
    tr("verification.checklist.headers.platforms"),
    tr("verification.checklist.headers.estTime"),
    tr("verification.checklist.headers.category"),
    tr("verification.checklist.headers.status"),
  ];

  const rows = checklist.items.map((item) => [
    item.id,
    tr(item.name),
    tr(item.description),
    item.eventType,
    item.required ? tr("verification.checklist.status.yes") : tr("verification.checklist.status.no"),
    item.platforms.join(";"),
    String(item.estimatedTime),
    item.category,
    tr("verification.checklist.status.untested"),
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => escapeCSV(String(cell))).join(","))
    .join("\n");
  return csv;
}
