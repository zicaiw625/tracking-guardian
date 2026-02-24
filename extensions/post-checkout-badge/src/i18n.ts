export type ExtensionLanguage = "zh" | "en";

type ExtensionCopy = {
  invoice: string;
  survey: string;
  aftersales: string;
  thankYouBannerBody: string;
  orderStatusBannerBody: string;
};

const COPY: Record<ExtensionLanguage, ExtensionCopy> = {
  zh: {
    invoice: "发票",
    survey: "填写问卷",
    aftersales: "售后入口",
    thankYouBannerBody: "本区块为静态提示；详细状态请查看应用后台。",
    orderStatusBannerBody: "本区块为静态提示；实时追踪状态与异常请前往应用后台的 Verification / Monitoring 查看。",
  },
  en: {
    invoice: "Invoice",
    survey: "Survey",
    aftersales: "After-sales",
    thankYouBannerBody: "This block shows static guidance. Check the app admin for detailed status.",
    orderStatusBannerBody: "This block shows static guidance. Check Verification / Monitoring in the app admin for real-time status and exceptions.",
  },
};

export function resolveExtensionLanguage(value: unknown): ExtensionLanguage {
  if (typeof value !== "string") {
    return "en";
  }
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("zh") ? "zh" : "en";
}

export function getExtensionCopy(language: ExtensionLanguage): ExtensionCopy {
  return COPY[language];
}
