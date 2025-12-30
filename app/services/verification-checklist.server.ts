import { logger } from "../utils/logger.server";
import type { VerificationTestItem } from "./verification.server";

export interface TestChecklistItem {
  id: string;
  name: string;
  description: string;
  eventType: string;
  required: boolean;
  platforms: string[];
  steps: string[];
  expectedResults: string[];
  estimatedTime: number; // 分钟
  category: "purchase" | "refund" | "cart" | "subscription" | "order_edit";
}

export interface TestChecklist {
  shopId: string;
  generatedAt: Date;
  testType: "quick" | "full" | "custom";
  items: TestChecklistItem[];
  totalEstimatedTime: number;
  requiredItemsCount: number;
  optionalItemsCount: number;
}

/**
 * 生成测试清单
 */
export function generateTestChecklist(
  shopId: string,
  testType: "quick" | "full" | "custom" = "quick",
  customTestItems?: string[]
): TestChecklist {
  const allItems = getAllTestItems();
  
  let selectedItems: TestChecklistItem[];
  
  if (testType === "quick") {
    // 快速测试：只包含必需的测试项
    selectedItems = allItems.filter((item) => item.required);
  } else if (testType === "custom" && customTestItems) {
    // 自定义测试：选择指定的测试项
    selectedItems = allItems.filter((item) => customTestItems.includes(item.id));
  } else {
    // 完整测试：包含所有测试项
    selectedItems = allItems;
  }

  const requiredItems = selectedItems.filter((item) => item.required);
  const optionalItems = selectedItems.filter((item) => !item.required);
  const totalEstimatedTime = selectedItems.reduce((sum, item) => sum + item.estimatedTime, 0);

  return {
    shopId,
    generatedAt: new Date(),
    testType,
    items: selectedItems,
    totalEstimatedTime,
    requiredItemsCount: requiredItems.length,
    optionalItemsCount: optionalItems.length,
  };
}

/**
 * 获取所有可用的测试项
 */
function getAllTestItems(): TestChecklistItem[] {
  return [
    {
      id: "purchase",
      name: "标准购买",
      description: "完成一个包含单个商品的标准订单",
      eventType: "purchase",
      required: true,
      platforms: ["google", "meta", "tiktok", "pinterest"],
      steps: [
        "1. 前往商店首页",
        "2. 选择一个商品加入购物车",
        "3. 进入结账流程",
        "4. 填写收货信息",
        "5. 选择支付方式（可使用测试支付）",
        "6. 完成订单",
        "7. 在验收页面查看事件触发情况",
      ],
      expectedResults: [
        "Purchase 事件已触发",
        "事件包含 value（订单金额）",
        "事件包含 currency（币种）",
        "事件包含 items（商品列表）",
        "事件包含 order_id（订单ID）",
        "所有配置的平台都收到事件",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "purchase_multi",
      name: "多商品购买",
      description: "完成一个包含多个不同商品的订单",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "1. 前往商店首页",
        "2. 选择 2-3 个不同商品加入购物车",
        "3. 进入结账流程",
        "4. 完成订单",
        "5. 验证事件中的 items 数组包含所有商品",
      ],
      expectedResults: [
        "Purchase 事件已触发",
        "items 数组包含所有商品",
        "value 等于所有商品总价",
        "每个商品包含 item_id、item_name、price、quantity",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "purchase_discount",
      name: "折扣订单",
      description: "使用折扣码完成订单，验证金额计算正确",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "1. 前往商店首页",
        "2. 选择一个商品加入购物车",
        "3. 在结账页面输入折扣码",
        "4. 验证折扣已应用",
        "5. 完成订单",
        "6. 验证事件中的 value 是折扣后的金额",
      ],
      expectedResults: [
        "Purchase 事件已触发",
        "value 等于折扣后的订单金额",
        "事件包含 coupon 参数（如果平台支持）",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "purchase_shipping",
      name: "含运费订单",
      description: "完成一个包含运费的订单",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta"],
      steps: [
        "1. 前往商店首页",
        "2. 选择一个商品加入购物车",
        "3. 进入结账流程",
        "4. 选择需要付费的配送方式",
        "5. 完成订单",
        "6. 验证事件中的 value 包含运费",
      ],
      expectedResults: [
        "Purchase 事件已触发",
        "value 等于商品价格 + 运费",
        "事件包含 shipping 参数（如果平台支持）",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "refund",
      name: "退款",
      description: "对已完成订单进行退款，验证退款事件",
      eventType: "refund",
      required: false,
      platforms: ["google", "meta"],
      steps: [
        "1. 在 Shopify Admin 中找到已完成的测试订单",
        "2. 进入订单详情页",
        "3. 点击「退款」按钮",
        "4. 选择退款金额（部分或全额）",
        "5. 确认退款",
        "6. 在验收页面查看退款事件",
      ],
      expectedResults: [
        "Refund 事件已触发（如果平台支持）",
        "事件包含 refund_value（退款金额）",
        "事件包含 refund_currency（币种）",
        "事件关联到原始订单",
      ],
      estimatedTime: 10,
      category: "refund",
    },
    {
      id: "order_cancel",
      name: "订单取消",
      description: "取消一个待处理的订单",
      eventType: "cancel",
      required: false,
      platforms: ["google", "meta"],
      steps: [
        "1. 在 Shopify Admin 中找到待处理的订单",
        "2. 进入订单详情页",
        "3. 点击「取消订单」",
        "4. 确认取消",
        "5. 验证取消事件（如果平台支持）",
      ],
      expectedResults: [
        "Cancel 事件已触发（如果平台支持）",
        "事件关联到原始订单",
      ],
      estimatedTime: 5,
      category: "order_edit",
    },
    {
      id: "order_edit",
      name: "订单编辑",
      description: "编辑已完成的订单（修改商品、地址等）",
      eventType: "order_edit",
      required: false,
      platforms: ["google"],
      steps: [
        "1. 在 Shopify Admin 中找到已完成的订单",
        "2. 进入订单详情页",
        "3. 编辑订单（添加商品、修改地址等）",
        "4. 保存更改",
        "5. 验证更新事件（如果平台支持）",
      ],
      expectedResults: [
        "Order Update 事件已触发（如果平台支持）",
        "事件包含更新后的订单信息",
      ],
      estimatedTime: 10,
      category: "order_edit",
    },
    {
      id: "subscription",
      name: "订阅订单",
      description: "完成一个订阅类型的订单（如果商店支持）",
      eventType: "subscription",
      required: false,
      platforms: ["google", "meta"],
      steps: [
        "1. 选择一个订阅商品",
        "2. 完成订阅订单",
        "3. 验证订阅事件（如果平台支持）",
      ],
      expectedResults: [
        "Subscription 事件已触发（如果平台支持）",
        "事件包含订阅相关信息",
      ],
      estimatedTime: 5,
      category: "subscription",
    },
    {
      id: "add_to_cart",
      name: "添加到购物车",
      description: "将商品添加到购物车",
      eventType: "add_to_cart",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "1. 前往商店首页",
        "2. 选择一个商品",
        "3. 点击「加入购物车」",
        "4. 在验收页面查看事件",
      ],
      expectedResults: [
        "AddToCart 事件已触发",
        "事件包含商品信息",
      ],
      estimatedTime: 2,
      category: "cart",
    },
    {
      id: "begin_checkout",
      name: "开始结账",
      description: "进入结账流程",
      eventType: "begin_checkout",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "1. 将商品加入购物车",
        "2. 点击「结账」",
        "3. 在验收页面查看事件",
      ],
      expectedResults: [
        "BeginCheckout 事件已触发",
        "事件包含购物车信息",
      ],
      estimatedTime: 2,
      category: "cart",
    },
    {
      id: "order_fulfillment",
      name: "订单发货",
      description: "对订单进行发货操作，验证发货事件",
      eventType: "fulfillment",
      required: false,
      platforms: ["google", "meta"],
      steps: [
        "1. 在 Shopify Admin 中找到已完成的订单",
        "2. 进入订单详情页",
        "3. 创建发货单（Fulfillment）",
        "4. 添加物流追踪号（可选）",
        "5. 标记为已发货",
        "6. 验证发货事件（如果平台支持）",
      ],
      expectedResults: [
        "Fulfillment 事件已触发（如果平台支持）",
        "事件包含发货信息",
        "事件关联到原始订单",
      ],
      estimatedTime: 5,
      category: "order_edit",
    },
    {
      id: "order_partial_refund",
      name: "部分退款",
      description: "对订单进行部分退款，验证退款金额正确",
      eventType: "refund",
      required: false,
      platforms: ["google", "meta"],
      steps: [
        "1. 在 Shopify Admin 中找到已完成的订单",
        "2. 进入订单详情页",
        "3. 点击「退款」",
        "4. 选择部分商品或部分金额进行退款",
        "5. 确认退款",
        "6. 验证退款事件中的金额是部分退款金额",
      ],
      expectedResults: [
        "Refund 事件已触发",
        "refund_value 等于部分退款金额（不是全额）",
        "事件关联到原始订单",
      ],
      estimatedTime: 8,
      category: "refund",
    },
    {
      id: "order_full_refund",
      name: "全额退款",
      description: "对订单进行全额退款",
      eventType: "refund",
      required: false,
      platforms: ["google", "meta"],
      steps: [
        "1. 在 Shopify Admin 中找到已完成的订单",
        "2. 进入订单详情页",
        "3. 点击「退款」",
        "4. 选择全额退款",
        "5. 确认退款",
        "6. 验证退款事件中的金额等于订单金额",
      ],
      expectedResults: [
        "Refund 事件已触发",
        "refund_value 等于原始订单金额",
        "事件关联到原始订单",
      ],
      estimatedTime: 5,
      category: "refund",
    },
    {
      id: "subscription_first",
      name: "首次订阅订单",
      description: "完成首次订阅订单（如果商店支持订阅）",
      eventType: "subscription",
      required: false,
      platforms: ["google", "meta"],
      steps: [
        "1. 选择一个订阅商品（Subscription Product）",
        "2. 完成首次订阅订单",
        "3. 验证订阅事件已触发",
        "4. 检查事件中的订阅相关信息",
      ],
      expectedResults: [
        "Subscription 事件已触发（如果平台支持）",
        "事件包含订阅周期信息",
        "事件包含首次订阅标识",
      ],
      estimatedTime: 5,
      category: "subscription",
    },
    {
      id: "subscription_renewal",
      name: "订阅续费",
      description: "验证订阅自动续费事件（如果商店支持）",
      eventType: "subscription_renewal",
      required: false,
      platforms: ["google", "meta"],
      steps: [
        "1. 等待订阅自动续费（或手动触发续费）",
        "2. 在验收页面查看续费事件",
        "3. 验证事件关联到原始订阅",
      ],
      expectedResults: [
        "Subscription Renewal 事件已触发（如果平台支持）",
        "事件包含续费金额",
        "事件关联到原始订阅订单",
      ],
      estimatedTime: 10,
      category: "subscription",
    },
    {
      id: "order_edit_add_item",
      name: "订单编辑 - 添加商品",
      description: "在已完成的订单中添加商品",
      eventType: "order_edit",
      required: false,
      platforms: ["google"],
      steps: [
        "1. 在 Shopify Admin 中找到已完成的订单",
        "2. 进入订单详情页",
        "3. 点击「编辑订单」",
        "4. 添加新商品到订单",
        "5. 保存更改",
        "6. 验证订单更新事件",
      ],
      expectedResults: [
        "Order Update 事件已触发（如果平台支持）",
        "事件包含更新后的订单金额",
        "事件包含新增的商品信息",
      ],
      estimatedTime: 8,
      category: "order_edit",
    },
    {
      id: "order_edit_change_address",
      name: "订单编辑 - 修改地址",
      description: "修改订单的收货地址",
      eventType: "order_edit",
      required: false,
      platforms: ["google"],
      steps: [
        "1. 在 Shopify Admin 中找到已完成的订单",
        "2. 进入订单详情页",
        "3. 编辑收货地址",
        "4. 保存更改",
        "5. 验证订单更新事件（如果平台支持）",
      ],
      expectedResults: [
        "Order Update 事件已触发（如果平台支持）",
        "事件包含更新后的地址信息",
      ],
      estimatedTime: 5,
      category: "order_edit",
    },
    {
      id: "purchase_zero_value",
      name: "零金额订单",
      description: "完成一个零金额订单（如使用100%折扣码）",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta"],
      steps: [
        "1. 创建一个100%折扣码",
        "2. 选择一个商品加入购物车",
        "3. 在结账页面使用100%折扣码",
        "4. 完成订单（金额为0）",
        "5. 验证事件中的 value 为 0",
      ],
      expectedResults: [
        "Purchase 事件已触发",
        "value 为 0（或接近0，如果包含运费）",
        "事件仍然包含商品信息",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "purchase_currency_mismatch",
      name: "多币种订单",
      description: "完成一个使用非默认币种的订单（如果商店支持多币种）",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "1. 切换到非默认币种（如 EUR、GBP）",
        "2. 选择一个商品加入购物车",
        "3. 完成订单",
        "4. 验证事件中的 currency 是正确的币种代码",
        "5. 验证 value 是正确币种的金额",
      ],
      expectedResults: [
        "Purchase 事件已触发",
        "currency 字段是正确的币种代码（如 EUR、GBP）",
        "value 是正确币种的金额",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
  ];
}

/**
 * 获取测试项的详细说明
 */
export function getTestItemDetails(itemId: string): TestChecklistItem | null {
  const allItems = getAllTestItems();
  return allItems.find((item) => item.id === itemId) || null;
}

/**
 * 生成测试清单的 Markdown 格式
 */
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

  // 按类别分组
  const categories: Record<string, TestChecklistItem[]> = {
    purchase: [],
    refund: [],
    cart: [],
    subscription: [],
    order_edit: [],
  };

  for (const item of checklist.items) {
    categories[item.category].push(item);
  }

  const categoryLabels: Record<string, string> = {
    purchase: "购买事件",
    refund: "退款事件",
    cart: "购物车事件",
    subscription: "订阅事件",
    order_edit: "订单编辑",
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

/**
 * 生成测试清单的 CSV 格式
 */
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

