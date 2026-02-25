import { escapeCSV } from "~/utils/csv.server";
import type { TFunction } from "i18next";

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

const SHOPIFY_OFFICIAL_TEST_GUIDE = "https://help.shopify.com/en/manual/checkout-settings/test-orders";
const SHOPIFY_PIXEL_TEST_GUIDE = "https://help.shopify.com/en/manual/promoting-marketing/pixels/custom-pixels/testing";

export function generateTestChecklist(
  shopId: string,
  testType: "quick" | "full" | "custom" = "quick",
  customTestItems?: string[],
  t?: TFunction
): TestChecklist {
  const allItems = getAllTestItems(t);
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

const TEST_ITEM_IDS = [
  "purchase",
  "purchase_multi",
  "purchase_discount",
  "purchase_shipping",
  "purchase_complex",
  "currency_test",
  "add_to_cart",
  "begin_checkout",
  "purchase_zero_value",
  "purchase_currency_mismatch",
] as const;

interface TestItemMeta {
  eventType: string;
  required: boolean;
  platforms: string[];
  estimatedTime: number;
  category: "purchase" | "cart" | "refund" | "order_edit";
}

const TEST_ITEM_META: Record<string, TestItemMeta> = {
  purchase: { eventType: "purchase", required: true, platforms: ["google", "meta", "tiktok"], estimatedTime: 5, category: "purchase" },
  purchase_multi: { eventType: "purchase", required: false, platforms: ["google", "meta", "tiktok"], estimatedTime: 5, category: "purchase" },
  purchase_discount: { eventType: "purchase", required: false, platforms: ["google", "meta", "tiktok"], estimatedTime: 5, category: "purchase" },
  purchase_shipping: { eventType: "purchase", required: false, platforms: ["google", "meta", "tiktok"], estimatedTime: 5, category: "purchase" },
  purchase_complex: { eventType: "purchase", required: false, platforms: ["google", "meta", "tiktok"], estimatedTime: 8, category: "purchase" },
  currency_test: { eventType: "purchase", required: false, platforms: ["google", "meta", "tiktok"], estimatedTime: 5, category: "purchase" },
  add_to_cart: { eventType: "add_to_cart", required: false, platforms: ["google", "meta", "tiktok"], estimatedTime: 2, category: "cart" },
  begin_checkout: { eventType: "begin_checkout", required: false, platforms: ["google", "meta", "tiktok"], estimatedTime: 2, category: "cart" },
  purchase_zero_value: { eventType: "purchase", required: false, platforms: ["google", "meta"], estimatedTime: 5, category: "purchase" },
  purchase_currency_mismatch: { eventType: "purchase", required: false, platforms: ["google", "meta", "tiktok"], estimatedTime: 5, category: "purchase" },
};

function getAllTestItems(t?: TFunction): TestChecklistItem[] {
  return TEST_ITEM_IDS.map((id) => {
    const meta = TEST_ITEM_META[id];
    const name = t ? t(`verificationChecklist.items.${id}.name`) : id;
    const description = t ? t(`verificationChecklist.items.${id}.description`) : "";
    const steps: string[] = t
      ? (t(`verificationChecklist.items.${id}.steps`, { returnObjects: true }) as string[])
      : [];
    const expectedResults: string[] = t
      ? (t(`verificationChecklist.items.${id}.expectedResults`, { returnObjects: true }) as string[])
      : [];
    return {
      id,
      name,
      description,
      eventType: meta.eventType,
      required: meta.required,
      platforms: meta.platforms,
      steps: Array.isArray(steps) ? steps : [],
      expectedResults: Array.isArray(expectedResults) ? expectedResults : [],
      estimatedTime: meta.estimatedTime,
      category: meta.category,
    };
  });
}

export function getTestItemDetails(itemId: string, t?: TFunction): TestChecklistItem | null {
  const allItems = getAllTestItems(t);
  return allItems.find((item) => item.id === itemId) || null;
}

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

export function generateChecklistMarkdown(checklist: TestChecklist, t?: TFunction): string {
  const mk = (key: string) => t ? t(`verificationChecklist.markdown.${key}`) : key;
  const testTypeLabel = checklist.testType === "quick"
    ? mk("testTypeQuick")
    : checklist.testType === "full"
      ? mk("testTypeFull")
      : mk("testTypeCustom");

  let markdown = `# ${mk("title")}\n\n`;
  markdown += `**${mk("generatedAt")}**: ${checklist.generatedAt.toLocaleString()}\n`;
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

export function generateChecklistCSV(checklist: TestChecklist, t?: TFunction): string {
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
