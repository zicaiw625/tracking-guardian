import { escapeCSV } from "~/utils/csv.server";

export interface TestChecklistItem {
  id: string;
  name: string;
  description: string;
  eventType: string;
  required: boolean;
  platforms: string[];
  steps: string[];
  expectedResults: string[];
  estimatedTime: number;
  category: "purchase" | "cart" | "refund" | "order_edit";
}

export interface PixelLayerItem {
  eventName: string;
  description: string;
  required: boolean;
  verificationPoints: string[];
  expectedParams?: string[];
}

export interface OrderLayerItem {
  eventType: string;
  description: string;
  required: boolean;
  verificationPoints: string[];
  expectedFields?: string[];
}

export interface TestChecklist {
  shopId: string;
  generatedAt: Date;
  testType: "quick" | "full" | "custom";
  items: TestChecklistItem[];
  pixelLayer: PixelLayerItem[];
  orderLayer: OrderLayerItem[];
  totalEstimatedTime: number;
  requiredItemsCount: number;
  optionalItemsCount: number;
  shopifyOfficialGuides?: {
    testCheckout: string;
    testPixels: string;
  };
}

const SHOPIFY_OFFICIAL_TEST_GUIDE = "https://help.shopify.com/en/manual/checkout-settings/test-checkout";
const SHOPIFY_PIXEL_TEST_GUIDE = "https://help.shopify.com/en/manual/online-store/themes/customizing-themes/checkout-extensibility/web-pixels-api/test-custom-pixels";

export function generateTestChecklist(
  shopId: string,
  testType: "quick" | "full" | "custom" = "quick",
  customTestItems?: string[]
): TestChecklist {
  const allItems = getAllTestItems();
  let selectedItems: TestChecklistItem[];
  if (testType === "quick") {
        selectedItems = allItems.filter((item) => item.required);
  } else if (testType === "custom" && customTestItems) {
    selectedItems = allItems.filter((item) => customTestItems.includes(item.id));
  } else {
    selectedItems = allItems;
  }
  const requiredItems = selectedItems.filter((item) => item.required);
  const optionalItems = selectedItems.filter((item) => !item.required);
  const totalEstimatedTime = selectedItems.reduce((sum, item) => sum + item.estimatedTime, 0);
  const pixelLayer: PixelLayerItem[] = selectedItems
    .filter((i) => i.category === "purchase" || i.category === "cart")
    .map((i) => ({
      eventName: i.eventType,
      description: i.description,
      required: i.required,
      verificationPoints: i.expectedResults,
      expectedParams: [],
    }));
  const orderLayer: OrderLayerItem[] = [];
  return {
    shopId,
    generatedAt: new Date(),
    testType,
    items: selectedItems,
    pixelLayer,
    orderLayer,
    totalEstimatedTime,
    requiredItemsCount: requiredItems.length,
    optionalItemsCount: optionalItems.length,
    shopifyOfficialGuides: {
      testCheckout: SHOPIFY_OFFICIAL_TEST_GUIDE,
      testPixels: SHOPIFY_PIXEL_TEST_GUIDE,
    },
  };
}

function getAllTestItems(): TestChecklistItem[] {
  return [
    {
      id: "purchase",
      name: "verification.testItems.purchase.name",
      description: "verification.testItems.purchase.description",
      eventType: "purchase",
      required: true,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "verification.testItems.purchase.steps.0",
        "verification.testItems.purchase.steps.1",
        "verification.testItems.purchase.steps.2",
        "verification.testItems.purchase.steps.3",
        "verification.testItems.purchase.steps.4",
        "verification.testItems.purchase.steps.5",
        "verification.testItems.purchase.steps.6",
      ],
      expectedResults: [
        "verification.testItems.purchase.expectedResults.0",
        "verification.testItems.purchase.expectedResults.1",
        "verification.testItems.purchase.expectedResults.2",
        "verification.testItems.purchase.expectedResults.3",
        "verification.testItems.purchase.expectedResults.4",
        "verification.testItems.purchase.expectedResults.5",
        "verification.testItems.purchase.expectedResults.6",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "purchase_multi",
      name: "verification.testItems.purchase_multi.name",
      description: "verification.testItems.purchase_multi.description",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "verification.testItems.purchase_multi.steps.0",
        "verification.testItems.purchase_multi.steps.1",
        "verification.testItems.purchase_multi.steps.2",
        "verification.testItems.purchase_multi.steps.3",
        "verification.testItems.purchase_multi.steps.4",
      ],
      expectedResults: [
        "verification.testItems.purchase_multi.expectedResults.0",
        "verification.testItems.purchase_multi.expectedResults.1",
        "verification.testItems.purchase_multi.expectedResults.2",
        "verification.testItems.purchase_multi.expectedResults.3",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "purchase_discount",
      name: "verification.testItems.purchase_discount.name",
      description: "verification.testItems.purchase_discount.description",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "verification.testItems.purchase_discount.steps.0",
        "verification.testItems.purchase_discount.steps.1",
        "verification.testItems.purchase_discount.steps.2",
        "verification.testItems.purchase_discount.steps.3",
        "verification.testItems.purchase_discount.steps.4",
        "verification.testItems.purchase_discount.steps.5",
      ],
      expectedResults: [
        "verification.testItems.purchase_discount.expectedResults.0",
        "verification.testItems.purchase_discount.expectedResults.1",
        "verification.testItems.purchase_discount.expectedResults.2",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "purchase_shipping",
      name: "verification.testItems.purchase_shipping.name",
      description: "verification.testItems.purchase_shipping.description",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "verification.testItems.purchase_shipping.steps.0",
        "verification.testItems.purchase_shipping.steps.1",
        "verification.testItems.purchase_shipping.steps.2",
        "verification.testItems.purchase_shipping.steps.3",
        "verification.testItems.purchase_shipping.steps.4",
        "verification.testItems.purchase_shipping.steps.5",
      ],
      expectedResults: [
        "verification.testItems.purchase_shipping.expectedResults.0",
        "verification.testItems.purchase_shipping.expectedResults.1",
        "verification.testItems.purchase_shipping.expectedResults.2",
        "verification.testItems.purchase_shipping.expectedResults.3",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "purchase_complex",
      name: "verification.testItems.purchase_complex.name",
      description: "verification.testItems.purchase_complex.description",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "verification.testItems.purchase_complex.steps.0",
        "verification.testItems.purchase_complex.steps.1",
        "verification.testItems.purchase_complex.steps.2",
        "verification.testItems.purchase_complex.steps.3",
        "verification.testItems.purchase_complex.steps.4",
        "verification.testItems.purchase_complex.steps.5",
        "verification.testItems.purchase_complex.steps.6",
      ],
      expectedResults: [
        "verification.testItems.purchase_complex.expectedResults.0",
        "verification.testItems.purchase_complex.expectedResults.1",
        "verification.testItems.purchase_complex.expectedResults.2",
        "verification.testItems.purchase_complex.expectedResults.3",
        "verification.testItems.purchase_complex.expectedResults.4",
        "verification.testItems.purchase_complex.expectedResults.5",
      ],
      estimatedTime: 8,
      category: "purchase",
    },
    {
      id: "currency_test",
      name: "verification.testItems.currency_test.name",
      description: "verification.testItems.currency_test.description",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "verification.testItems.currency_test.steps.0",
        "verification.testItems.currency_test.steps.1",
        "verification.testItems.currency_test.steps.2",
        "verification.testItems.currency_test.steps.3",
      ],
      expectedResults: [
        "verification.testItems.currency_test.expectedResults.0",
        "verification.testItems.currency_test.expectedResults.1",
        "verification.testItems.currency_test.expectedResults.2",
        "verification.testItems.currency_test.expectedResults.3",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "add_to_cart",
      name: "verification.testItems.add_to_cart.name",
      description: "verification.testItems.add_to_cart.description",
      eventType: "add_to_cart",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "verification.testItems.add_to_cart.steps.0",
        "verification.testItems.add_to_cart.steps.1",
        "verification.testItems.add_to_cart.steps.2",
        "verification.testItems.add_to_cart.steps.3",
      ],
      expectedResults: [
        "verification.testItems.add_to_cart.expectedResults.0",
        "verification.testItems.add_to_cart.expectedResults.1",
      ],
      estimatedTime: 2,
      category: "cart",
    },
    {
      id: "begin_checkout",
      name: "verification.testItems.begin_checkout.name",
      description: "verification.testItems.begin_checkout.description",
      eventType: "begin_checkout",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "verification.testItems.begin_checkout.steps.0",
        "verification.testItems.begin_checkout.steps.1",
        "verification.testItems.begin_checkout.steps.2",
      ],
      expectedResults: [
        "verification.testItems.begin_checkout.expectedResults.0",
        "verification.testItems.begin_checkout.expectedResults.1",
      ],
      estimatedTime: 2,
      category: "cart",
    },
    {
      id: "purchase_zero_value",
      name: "verification.testItems.purchase_zero_value.name",
      description: "verification.testItems.purchase_zero_value.description",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta"],
      steps: [
        "verification.testItems.purchase_zero_value.steps.0",
        "verification.testItems.purchase_zero_value.steps.1",
        "verification.testItems.purchase_zero_value.steps.2",
        "verification.testItems.purchase_zero_value.steps.3",
        "verification.testItems.purchase_zero_value.steps.4",
      ],
      expectedResults: [
        "verification.testItems.purchase_zero_value.expectedResults.0",
        "verification.testItems.purchase_zero_value.expectedResults.1",
        "verification.testItems.purchase_zero_value.expectedResults.2",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "purchase_currency_mismatch",
      name: "verification.testItems.purchase_currency_mismatch.name",
      description: "verification.testItems.purchase_currency_mismatch.description",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "verification.testItems.purchase_currency_mismatch.steps.0",
        "verification.testItems.purchase_currency_mismatch.steps.1",
        "verification.testItems.purchase_currency_mismatch.steps.2",
        "verification.testItems.purchase_currency_mismatch.steps.3",
        "verification.testItems.purchase_currency_mismatch.steps.4",
      ],
      expectedResults: [
        "verification.testItems.purchase_currency_mismatch.expectedResults.0",
        "verification.testItems.purchase_currency_mismatch.expectedResults.1",
        "verification.testItems.purchase_currency_mismatch.expectedResults.2",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
  ];
}

export function getTestItemDetails(itemId: string): TestChecklistItem | null {
  const allItems = getAllTestItems();
  return allItems.find((item) => item.id === itemId) || null;
}

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
    .map((row) => row.map((cell) => escapeCSV(String(cell))).join(","))
    .join("\n");
  return csv;
}
