import type { TestChecklist, TestChecklistItem } from "~/services/verification-checklist.server";

export function generateChecklistMarkdown(checklist: TestChecklist): string {
  const formatTime = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} 分钟`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
  };

  let markdown = `# 验收测试清单\n\n`;
  markdown += `**生成时间**: ${checklist.generatedAt.toLocaleString("zh-CN")}\n`;
  markdown += `**测试类型**: ${checklist.testType === "quick" ? "快速测试" : checklist.testType === "full" ? "完整测试" : "自定义测试"}\n`;
  markdown += `**预计总时间**: ${formatTime(checklist.totalEstimatedTime)}\n`;
  markdown += `**必需项**: ${checklist.requiredItemsCount} | **可选项**: ${checklist.optionalItemsCount}\n\n`;
  markdown += `---\n\n`;

  // P0-1: PRD 对齐 - v1.0 只支持 purchase 和 cart 事件验收
  const categories: Record<string, TestChecklistItem[]> = {
    purchase: [],
    cart: [],
  };

  for (const item of checklist.items) {
    categories[item.category].push(item);
  }

  // P0-1: PRD 对齐 - v1.0 只支持 purchase 和 cart 事件验收
  const categoryLabels: Record<string, string> = {
    purchase: "购买事件",
    cart: "购物车事件",
  };

  for (const [category, items] of Object.entries(categories)) {
    if (items.length === 0) continue;

    markdown += `## ${categoryLabels[category]}\n\n`;

    for (const item of items) {
      markdown += `### ${item.required ? "✅" : "⚪"} ${item.name}\n\n`;
      markdown += `**描述**: ${item.description}\n\n`;
      markdown += `**支持平台**: ${item.platforms.join(", ")}\n\n`;
      markdown += `**预计时间**: ${formatTime(item.estimatedTime)}\n\n`;

      markdown += `**操作步骤**:\n`;
      for (const step of item.steps) {
        markdown += `- ${step}\n`;
      }
      markdown += `\n`;

      markdown += `**预期结果**:\n`;
      for (const result of item.expectedResults) {
        markdown += `- ${result}\n`;
      }
      markdown += `\n`;

      markdown += `---\n\n`;
    }
  }

  markdown += `## 测试完成检查清单\n\n`;
  markdown += `- [ ] 所有必需测试项已完成\n`;
  markdown += `- [ ] 所有事件都正确触发\n`;
  markdown += `- [ ] 事件参数完整（value、currency、items 等）\n`;
  markdown += `- [ ] 订单金额与事件 value 一致\n`;
  markdown += `- [ ] 所有配置的平台都收到事件\n`;
  markdown += `- [ ] 在第三方平台（GA4/Meta/TikTok）中验证事件已接收\n\n`;

  return markdown;
}

export function generateChecklistCSV(checklist: TestChecklist): string {
  const headers = [
    "ID",
    "名称",
    "描述",
    "事件类型",
    "必需",
    "平台",
    "预计时间（分钟）",
    "类别",
    "状态",
  ];

  const rows = checklist.items.map((item) => [
    item.id,
    item.name,
    item.description,
    item.eventType,
    item.required ? "是" : "否",
    item.platforms.join(";"),
    String(item.estimatedTime),
    item.category,
    "未测试",
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  return csv;
}

