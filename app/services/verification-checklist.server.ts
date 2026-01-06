/**
 * P0-1: PRD 对齐 - v1.0 验收范围说明
 * 
 * v1.0 验收范围（符合 PRD 4.5 要求）：
 * - ✅ checkout/purchase 漏斗事件（checkout_started, checkout_completed, product_added_to_cart, product_viewed, page_viewed 等）
 * - ❌ 退款、取消、编辑订单、订阅事件（将在 v1.1+ 中通过订单 webhooks 实现）
 * 
 * 原因：
 * - Web Pixel Extension 运行在 strict sandbox 环境，只能订阅 Shopify 标准 checkout 漏斗事件
 * - 退款、取消、编辑订单、订阅等事件需要订单 webhooks 或后台定时对账才能获取
 * - v1.0 版本仅依赖 Web Pixel Extension，不处理订单相关 webhooks（符合隐私最小化原则）
 * 
 * 审计结论对齐：
 * - ✅ 验收清单中已移除 refund/cancel/edit/subscription 项（已注释，符合 v1.0 范围收敛要求）
 * - ✅ 验收范围收敛为 checkout/purchase 漏斗事件（与 Web Pixel Extension 能力一致）
 * - ✅ 已添加明确说明，这些功能将在 v1.1+ 中通过订单 webhooks 实现
 * 
 * v1.1+ 实现计划：
 * - 启用订单相关 webhooks（orders/updated, refunds/create 等）
 * - 后台定时对账拉取订单变更
 * - 生成对应"事件对账"记录（严格做 PII 最小化）
 */

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
  estimatedTime: number;
  // P0-1: PRD 对齐 - v1.0 只支持 purchase 和 cart 事件验收
  // refund、subscription、order_edit 在 v1.1+ 中通过 webhooks 实现
  category: "purchase" | "cart";
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

function getAllTestItems(): TestChecklistItem[] {
  return [
    {
      id: "purchase",
      name: "标准购买",
      description: "完成一个包含单个商品的标准订单，验证 purchase 事件触发",
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
        "订单金额与 Shopify 订单数据一致",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "purchase_multi",
      name: "多商品购买",
      description: "完成一个包含多个不同商品的订单，验证 items 数组完整性",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok", "pinterest"],
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
      description: "完成一个包含运费的订单，验证总金额（商品 + 运费）正确",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok"],
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
        "订单金额与 Shopify 订单数据一致",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    {
      id: "purchase_complex",
      name: "复杂订单（多商品 + 折扣 + 运费）",
      description: "完成一个包含多商品、折扣码和运费的完整订单，验证所有参数正确",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "1. 前往商店首页",
        "2. 选择 2-3 个不同商品加入购物车",
        "3. 进入结账流程",
        "4. 输入折扣码（如 THANKYOU10）",
        "5. 选择付费配送方式",
        "6. 完成订单",
        "7. 验证所有参数正确",
      ],
      expectedResults: [
        "Purchase 事件已触发",
        "items 数组包含所有商品",
        "value 等于（商品总价 - 折扣 + 运费）",
        "currency 参数正确",
        "所有配置的平台都收到事件",
        "订单金额与 Shopify 订单数据完全一致",
      ],
      estimatedTime: 8,
      category: "purchase",
    },
    {
      id: "currency_test",
      name: "多币种测试",
      description: "使用非 USD 币种完成订单，验证 currency 参数正确",
      eventType: "purchase",
      required: false,
      platforms: ["google", "meta", "tiktok"],
      steps: [
        "1. 切换商店币种为非 USD（如 EUR、GBP、CNY）",
        "2. 选择一个商品加入购物车",
        "3. 完成订单",
        "4. 验证 currency 参数与商店币种一致",
      ],
      expectedResults: [
        "Purchase 事件已触发",
        "currency 参数正确（如 EUR、GBP、CNY）",
        "value 使用正确的币种",
        "所有平台收到正确币种的事件",
      ],
      estimatedTime: 5,
      category: "purchase",
    },
    // P0-1: PRD 对齐 - v1.0 验收范围收敛
    // 
    // ⚠️ 重要说明：以下事件类型（refund、cancel、order_edit、subscription）在 v1.0 中不可验收
    // 
    // 原因：
    // - Web Pixel Extension 运行在 strict sandbox 环境，只能订阅 Shopify 标准 checkout 漏斗事件
    // - 退款、取消、编辑订单、订阅等事件需要订单 webhooks 或后台定时对账才能获取
    // - v1.0 版本仅依赖 Web Pixel Extension，不处理订单相关 webhooks（符合隐私最小化原则）
    // 
    // v1.0 验收范围：
    // - ✅ checkout/purchase 漏斗事件（checkout_started, checkout_completed, product_added_to_cart, product_viewed, page_viewed 等）
    // - ❌ 退款、取消、编辑订单、订阅事件（将在 v1.1+ 中通过订单 webhooks 实现）
    // 
    // 这些功能将在 v1.1+ 版本中通过以下方式实现：
    // - 启用订单相关 webhooks（orders/updated, refunds/create 等）
    // - 后台定时对账拉取订单变更
    // - 生成对应"事件对账"记录（严格做 PII 最小化）
    // 
    // {
    //   id: "refund",
    //   name: "退款",
    //   description: "对已完成订单进行退款，验证退款事件",
    //   eventType: "refund",
    //   required: false,
    //   platforms: ["google", "meta"],
    //   steps: [...],
    //   expectedResults: [...],
    //   estimatedTime: 10,
    //   category: "refund",
    // },
    // 
    // {
    //   id: "order_cancel",
    //   name: "订单取消",
    //   description: "取消一个待处理的订单",
    //   eventType: "cancel",
    //   required: false,
    //   platforms: ["google", "meta"],
    //   steps: [...],
    //   expectedResults: [...],
    //   estimatedTime: 5,
    //   category: "order_edit",
    // },
    // 
    // {
    //   id: "order_edit",
    //   name: "订单编辑",
    //   description: "编辑已完成的订单（修改商品、地址等）",
    //   eventType: "order_edit",
    //   required: false,
    //   platforms: ["google"],
    //   steps: [...],
    //   expectedResults: [...],
    //   estimatedTime: 10,
    //   category: "order_edit",
    // },
    // 
    // {
    //   id: "subscription",
    //   name: "订阅订单",
    //   description: "完成一个订阅类型的订单（如果商店支持）",
    //   eventType: "subscription",
    //   required: false,
    //   platforms: ["google", "meta"],
    //   steps: [...],
    //   expectedResults: [...],
    //   estimatedTime: 5,
    //   category: "subscription",
    // },
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
    // P0-1: PRD 对齐 - v1.0 验收范围收敛
    // 以下测试项（fulfillment、refund、subscription、order_edit）在 v1.0 中不可验收
    // 原因：Web Pixel Extension 无法获取这些事件（它们需要订单 webhooks 或后台对账）
    // 这些功能将在 v1.1+ 中通过订单 webhooks 实现
    // 
    // {
    //   id: "order_fulfillment",
    //   name: "订单发货",
    //   description: "对订单进行发货操作，验证发货事件",
    //   eventType: "fulfillment",
    //   required: false,
    //   platforms: ["google", "meta"],
    //   steps: [...],
    //   expectedResults: [...],
    //   estimatedTime: 5,
    //   category: "order_edit",
    // },
    // {
    //   id: "order_partial_refund",
    //   name: "部分退款",
    //   description: "对订单进行部分退款，验证退款金额正确",
    //   eventType: "refund",
    //   required: false,
    //   platforms: ["google", "meta"],
    //   steps: [...],
    //   expectedResults: [...],
    //   estimatedTime: 8,
    //   category: "refund",
    // },
    // {
    //   id: "order_full_refund",
    //   name: "全额退款",
    //   description: "对订单进行全额退款",
    //   eventType: "refund",
    //   required: false,
    //   platforms: ["google", "meta"],
    //   steps: [...],
    //   expectedResults: [...],
    //   estimatedTime: 5,
    //   category: "refund",
    // },
    // {
    //   id: "subscription_first",
    //   name: "首次订阅订单",
    //   description: "完成首次订阅订单（如果商店支持订阅）",
    //   eventType: "subscription",
    //   required: false,
    //   platforms: ["google", "meta"],
    //   steps: [...],
    //   expectedResults: [...],
    //   estimatedTime: 5,
    //   category: "subscription",
    // },
    // {
    //   id: "subscription_renewal",
    //   name: "订阅续费",
    //   description: "验证订阅自动续费事件（如果商店支持）",
    //   eventType: "subscription_renewal",
    //   required: false,
    //   platforms: ["google", "meta"],
    //   steps: [...],
    //   expectedResults: [...],
    //   estimatedTime: 10,
    //   category: "subscription",
    // },
    // {
    //   id: "order_edit_add_item",
    //   name: "订单编辑 - 添加商品",
    //   description: "在已完成的订单中添加商品",
    //   eventType: "order_edit",
    //   required: false,
    //   platforms: ["google"],
    //   steps: [...],
    //   expectedResults: [...],
    //   estimatedTime: 8,
    //   category: "order_edit",
    // },
    // {
    //   id: "order_edit_change_address",
    //   name: "订单编辑 - 修改地址",
    //   description: "修改订单的收货地址",
    //   eventType: "order_edit",
    //   required: false,
    //   platforms: ["google"],
    //   steps: [...],
    //   expectedResults: [...],
    //   estimatedTime: 5,
    //   category: "order_edit",
    // },
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

  // P0-1: PRD 对齐 - v1.0 只支持 purchase 和 cart 事件验收
  const categories: Record<string, TestChecklistItem[]> = {
    purchase: [],
    cart: [],
    // refund、subscription、order_edit 在 v1.1+ 中通过 webhooks 实现
  };

  for (const item of checklist.items) {
    if (categories[item.category]) {
      categories[item.category].push(item);
    }
  }

  const categoryLabels: Record<string, string> = {
    purchase: "购买事件",
    cart: "购物车事件",
    // refund、subscription、order_edit 在 v1.1+ 中实现
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

