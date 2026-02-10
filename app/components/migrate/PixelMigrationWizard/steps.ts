export type WizardStep = "select" | "credentials" | "mappings" | "review" | "testing";

export interface StepDefinition {
  id: WizardStep;
  label: string;
  number: number;
  description: string;
  estimatedTime: string;
}

export const WIZARD_STEPS: StepDefinition[] = [
  {
    id: "select",
    label: "选择平台",
    number: 1,
    description: "选择需要迁移的广告平台",
    estimatedTime: "1 分钟",
  },
  {
    id: "credentials",
    label: "填写凭证",
    number: 2,
    description: "输入各平台的 API 凭证",
    estimatedTime: "3-5 分钟",
  },
  {
    id: "mappings",
    label: "事件映射",
    number: 3,
    description: "标准事件映射 + 参数完整率检查（Shopify 事件 → 平台事件）",
    estimatedTime: "2-3 分钟",
  },
  {
    id: "review",
    label: "检查配置",
    number: 4,
    description: "检查并确认所有配置信息",
    estimatedTime: "1-2 分钟",
  },
  {
    id: "testing",
    label: "测试验证",
    number: 5,
    description: "在测试环境中验证配置 + 可下载 payload 证据",
    estimatedTime: "2-3 分钟",
  },
];
