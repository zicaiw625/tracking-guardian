import type { MigrationRecipe } from "./types";

export const GA4_BASIC_RECIPE: MigrationRecipe = {
  id: "ga4-basic",
  version: "1.0.0",
  name: "Google Analytics 4 (GA4) 基础追踪",
  description: "将 GA4 追踪从 ScriptTag/gtag.js 迁移到 Web Pixel + Measurement Protocol",
  category: "analytics",
  difficulty: "easy",
  status: "stable",
  source: {
    type: "script_tag",
    platform: "google",
    detectionPatterns: [
      {
        patterns: [/gtag\s*\(/i, /G-[A-Z0-9]{10,}/i],
        keywords: ["gtag", "google-analytics"],
        confidence: 0.9,
      },
    ],
  },
  target: {
    type: "server_capi",
    fullSupport: true,
  },
  configFields: [
    {
      key: "measurementId",
      label: "Measurement ID",
      type: "text",
      description: "GA4 Measurement ID (格式: G-XXXXXXXX)",
      required: true,
      validationPattern: "^G-[A-Z0-9]+$",
      validationMessage: "请输入有效的 GA4 Measurement ID (以 G- 开头)",
    },
    {
      key: "apiSecret",
      label: "API Secret",
      type: "password",
      description: "在 GA4 管理后台 > 数据流 > Measurement Protocol API secrets 中创建",
      required: true,
    },
  ],
  steps: [
    {
      order: 1,
      title: "安装 Tracking Guardian Web Pixel",
      description: "在「迁移」页面点击「启用 App Pixel」按钮",
      actionType: "auto",
      autoAction: "enable_web_pixel",
      estimatedMinutes: 1,
    },
    {
      order: 2,
      title: "配置 GA4 凭证",
      description: "输入您的 GA4 Measurement ID 和 API Secret",
      actionType: "config",
      estimatedMinutes: 2,
    },
    {
      order: 3,
      title: "验证追踪",
      description: "完成测试订单，检查 GA4 实时报告中是否收到 purchase 事件",
      actionType: "manual",
      estimatedMinutes: 5,
      helpUrl: "https://support.google.com/analytics/answer/9304153",
    },
    {
      order: 4,
      title: "清理旧 ScriptTag",
      description: "确认新追踪正常后，删除旧的 gtag.js ScriptTag",
      actionType: "manual",
      estimatedMinutes: 2,
    },
  ],
  validationTests: [
    {
      name: "purchase_event_received",
      description: "验证 purchase 事件是否发送成功",
      type: "event_received",
      expectedEvent: "purchase",
      timeoutSeconds: 300,
    },
    {
      name: "required_params",
      description: "验证事件包含必需参数",
      type: "parameter_check",
      requiredParams: ["currency", "value", "transaction_id"],
    },
  ],
  trackedEvents: ["purchase"],
  estimatedTimeMinutes: 10,
  tags: ["google", "analytics", "ga4", "measurement-protocol"],
  icon: "📊",
  docsUrl: "https://developers.google.com/analytics/devguides/collection/protocol/ga4",
};
export const META_CAPI_RECIPE: MigrationRecipe = {
  id: "meta-capi",
  version: "1.0.0",
  name: "Meta (Facebook) Conversions API",
  description: "将 Meta Pixel 从 fbq() 迁移到 Conversions API 服务端追踪",
  category: "advertising",
  difficulty: "easy",
  status: "stable",
  source: {
    type: "script_tag",
    platform: "meta",
    detectionPatterns: [
      {
        patterns: [/fbq\s*\(/i, /connect\.facebook\.net/i, /pixel[_-]?id['":\s]+\d{15,16}/i],
        keywords: ["fbq", "facebook-pixel", "fb-pixel"],
        confidence: 0.9,
      },
    ],
  },
  target: {
    type: "server_capi",
    fullSupport: true,
  },
  configFields: [
    {
      key: "pixelId",
      label: "Pixel ID",
      type: "text",
      description: "Meta Pixel ID (15-16位数字)",
      required: true,
      validationPattern: "^\\d{15,16}$",
      validationMessage: "请输入有效的 Meta Pixel ID (15-16位数字)",
    },
    {
      key: "accessToken",
      label: "Conversions API Access Token",
      type: "password",
      description: "在 Meta Events Manager > 设置 > Conversions API 中生成",
      required: true,
    },
    {
      key: "testEventCode",
      label: "Test Event Code (可选)",
      type: "text",
      description: "用于在 Events Manager 测试事件",
      required: false,
    },
  ],
  steps: [
    {
      order: 1,
      title: "安装 Tracking Guardian Web Pixel",
      description: "在「迁移」页面点击「启用 App Pixel」按钮",
      actionType: "auto",
      autoAction: "enable_web_pixel",
      estimatedMinutes: 1,
    },
    {
      order: 2,
      title: "配置 Meta CAPI 凭证",
      description: "输入您的 Pixel ID 和 Access Token",
      actionType: "config",
      estimatedMinutes: 2,
    },
    {
      order: 3,
      title: "设置 Test Event Code",
      description: "（可选）使用测试代码验证事件",
      actionType: "config",
      estimatedMinutes: 1,
    },
    {
      order: 4,
      title: "验证追踪",
      description: "完成测试订单，检查 Events Manager 中是否收到 Purchase 事件",
      actionType: "manual",
      estimatedMinutes: 5,
      helpUrl: "https://support.google.com/analytics/answer/9304153",
    },
    {
      order: 5,
      title: "清理旧 Pixel 代码",
      description: "确认 CAPI 正常后，删除旧的 fbq() 代码",
      actionType: "manual",
      estimatedMinutes: 2,
    },
  ],
  validationTests: [
    {
      name: "purchase_event_received",
      description: "验证 Purchase 事件是否发送成功",
      type: "event_received",
      expectedEvent: "Purchase",
      timeoutSeconds: 300,
    },
    {
      name: "event_id_dedup",
      description: "验证 event_id 用于去重",
      type: "parameter_check",
      requiredParams: ["event_id", "event_source_url"],
    },
  ],
  trackedEvents: ["Purchase"],
  estimatedTimeMinutes: 11,
  tags: ["meta", "facebook", "capi", "advertising"],
  icon: "📘",
  docsUrl: "https://developers.google.com/analytics/devguides/collection/protocol/ga4",
};
export const TIKTOK_EVENTS_RECIPE: MigrationRecipe = {
  id: "tiktok-events",
  version: "1.0.0",
  name: "TikTok Events API",
  description: "将 TikTok Pixel 从 ttq.track() 迁移到 Events API 服务端追踪",
  category: "advertising",
  difficulty: "easy",
  status: "stable",
  source: {
    type: "script_tag",
    platform: "tiktok",
    detectionPatterns: [
      {
        patterns: [/ttq\s*[.(]/i, /analytics\.tiktok\.com/i],
        keywords: ["ttq", "tiktok-pixel"],
        confidence: 0.9,
      },
    ],
  },
  target: {
    type: "server_capi",
    fullSupport: true,
  },
  configFields: [
    {
      key: "pixelId",
      label: "Pixel ID",
      type: "text",
      description: "TikTok Pixel ID",
      required: true,
    },
    {
      key: "accessToken",
      label: "Access Token",
      type: "password",
      description: "在 TikTok Events Manager 中生成",
      required: true,
    },
    {
      key: "testEventCode",
      label: "Test Event Code (可选)",
      type: "text",
      description: "用于在 Events Manager 测试事件",
      required: false,
    },
  ],
  steps: [
    {
      order: 1,
      title: "安装 Tracking Guardian Web Pixel",
      description: "在「迁移」页面点击「启用 App Pixel」按钮",
      actionType: "auto",
      autoAction: "enable_web_pixel",
      estimatedMinutes: 1,
    },
    {
      order: 2,
      title: "配置 TikTok Events API 凭证",
      description: "输入您的 Pixel ID 和 Access Token",
      actionType: "config",
      estimatedMinutes: 2,
    },
    {
      order: 3,
      title: "验证追踪",
      description: "完成测试订单，检查 TikTok Events Manager 中是否收到事件",
      actionType: "manual",
      estimatedMinutes: 5,
    },
    {
      order: 4,
      title: "清理旧 Pixel 代码",
      description: "确认 Events API 正常后，删除旧的 ttq 代码",
      actionType: "manual",
      estimatedMinutes: 2,
    },
  ],
  validationTests: [
    {
      name: "complete_payment_received",
      description: "验证 CompletePayment 事件是否发送成功",
      type: "event_received",
      expectedEvent: "CompletePayment",
      timeoutSeconds: 300,
    },
  ],
  trackedEvents: ["CompletePayment"],
  estimatedTimeMinutes: 10,
  tags: ["tiktok", "events-api", "advertising"],
  icon: "🎵",
  docsUrl: "https://developers.google.com/analytics/devguides/collection/protocol/ga4",
};
export const SURVEY_MIGRATION_RECIPE: MigrationRecipe = {
  id: "survey-migration",
  version: "1.0.0",
  name: "购后问卷迁移",
  description: "将购后问卷从 Additional Scripts 迁移到 Checkout UI Extension",
  category: "survey",
  difficulty: "easy",
  status: "stable",
  source: {
    type: "additional_scripts",
    platform: "survey",
    detectionPatterns: [
      {
        patterns: [/fairing/i, /enquirelabs/i, /knocommerce/i, /zigpoll/i],
        keywords: ["survey", "post-purchase-survey"],
        confidence: 0.8,
      },
    ],
  },
  target: {
    type: "checkout_ui",
    fullSupport: true,
  },
  configFields: [
    {
      key: "surveyTitle",
      label: "问卷标题",
      type: "text",
      description: "显示在问卷顶部的标题",
      required: true,
      defaultValue: "帮助我们改进",
    },
    {
      key: "surveyQuestion",
      label: "问卷问题",
      type: "text",
      description: "要问客户的问题",
      required: true,
      defaultValue: "您是如何了解我们的？",
    },
    {
      key: "webhookUrl",
      label: "数据 Webhook URL (可选)",
      type: "text",
      description: "问卷回复发送到的 webhook 端点",
      required: false,
    },
  ],
  steps: [
    {
      order: 1,
      title: "启用问卷 UI Extension",
      description: "在 Shopify 后台启用 Tracking Guardian 的问卷组件",
      actionType: "manual",
      estimatedMinutes: 2,
    },
    {
      order: 2,
      title: "配置问卷内容",
      description: "设置问卷标题、问题和选项",
      actionType: "config",
      estimatedMinutes: 3,
    },
    {
      order: 3,
      title: "配置数据接收",
      description: "（可选）设置 webhook 接收问卷回复",
      actionType: "config",
      estimatedMinutes: 2,
    },
    {
      order: 4,
      title: "测试问卷",
      description: "完成测试订单，验证问卷显示和数据收集",
      actionType: "manual",
      estimatedMinutes: 5,
    },
    {
      order: 5,
      title: "禁用旧问卷代码",
      description: "删除 Additional Scripts 中的旧问卷代码",
      actionType: "manual",
      estimatedMinutes: 2,
    },
  ],
  validationTests: [
    {
      name: "survey_displayed",
      description: "验证问卷在 Thank You 页面显示",
      type: "manual",
    },
    {
      name: "submission_works",
      description: "验证问卷可以提交",
      type: "manual",
    },
  ],
  trackedEvents: ["survey_submitted"],
  estimatedTimeMinutes: 14,
  tags: ["survey", "checkout-ui", "post-purchase"],
  icon: "📋",
};
export const CUSTOM_WEBHOOK_RECIPE: MigrationRecipe = {
  id: "custom-webhook",
  version: "1.0.0",
  name: "自定义 Webhook 集成",
  description: "将追踪事件发送到自定义 HTTP 端点",
  category: "custom",
  difficulty: "medium",
  status: "stable",
  source: {
    type: "script_tag",
    platform: "custom",
    detectionPatterns: [
      {
        patterns: [/.*/],
        confidence: 0.5,
      },
    ],
  },
  target: {
    type: "webhook_integration",
    fullSupport: true,
  },
  configFields: [
    {
      key: "endpointUrl",
      label: "Webhook URL",
      type: "text",
      description: "事件发送的 HTTPS 端点",
      required: true,
      validationPattern: "^https://",
      validationMessage: "URL 必须使用 HTTPS",
    },
    {
      key: "authType",
      label: "认证方式",
      type: "select",
      description: "选择认证方式",
      required: true,
      defaultValue: "none",
      options: [
        { value: "none", label: "无认证" },
        { value: "bearer", label: "Bearer Token" },
        { value: "basic", label: "Basic Auth" },
        { value: "header", label: "自定义 Header" },
      ],
    },
    {
      key: "authValue",
      label: "认证值",
      type: "password",
      description: "Token 或认证信息",
      required: false,
    },
    {
      key: "payloadTemplate",
      label: "Payload 模板 (可选)",
      type: "textarea",
      description: "自定义 JSON 模板，使用 {{field}} 占位符",
      required: false,
    },
  ],
  steps: [
    {
      order: 1,
      title: "安装 Tracking Guardian Web Pixel",
      description: "启用基础 Web Pixel",
      actionType: "auto",
      autoAction: "enable_web_pixel",
      estimatedMinutes: 1,
    },
    {
      order: 2,
      title: "配置 Webhook 端点",
      description: "输入您的 webhook URL 和认证信息",
      actionType: "config",
      estimatedMinutes: 3,
    },
    {
      order: 3,
      title: "自定义 Payload 格式",
      description: "（可选）定义发送数据的 JSON 格式",
      actionType: "config",
      estimatedMinutes: 5,
    },
    {
      order: 4,
      title: "测试发送",
      description: "完成测试订单，验证 webhook 收到数据",
      actionType: "manual",
      estimatedMinutes: 5,
    },
  ],
  validationTests: [
    {
      name: "webhook_delivery",
      description: "验证 webhook 发送成功",
      type: "event_received",
      expectedEvent: "purchase",
      timeoutSeconds: 60,
    },
  ],
  trackedEvents: ["purchase"],
  estimatedTimeMinutes: 14,
  tags: ["webhook", "custom", "integration"],
  icon: "🔗",
};
export const RECIPE_REGISTRY: MigrationRecipe[] = [
  GA4_BASIC_RECIPE,
  META_CAPI_RECIPE,
  TIKTOK_EVENTS_RECIPE,
  SURVEY_MIGRATION_RECIPE,
  CUSTOM_WEBHOOK_RECIPE,
];
export function getRecipeById(id: string): MigrationRecipe | undefined {
  return RECIPE_REGISTRY.find(recipe => recipe.id === id);
}
export function getRecipesByCategory(category: string): MigrationRecipe[] {
  return RECIPE_REGISTRY.filter(recipe => recipe.category === category);
}
export function getRecipesByPlatform(platform: string): MigrationRecipe[] {
  return RECIPE_REGISTRY.filter(recipe =>
    recipe.source.platform === platform ||
    recipe.tags.includes(platform)
  );
}
export function getStableRecipes(): MigrationRecipe[] {
  return RECIPE_REGISTRY.filter(recipe => recipe.status === "stable");
}
export function searchRecipes(query: string): MigrationRecipe[] {
  const lowerQuery = query.toLowerCase();
  return RECIPE_REGISTRY.filter(recipe =>
    recipe.name.toLowerCase().includes(lowerQuery) ||
    recipe.description.toLowerCase().includes(lowerQuery) ||
    recipe.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}
