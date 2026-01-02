/**
 * 类型安全的Polaris i18n翻译对象处理
 * 处理JSON导入可能返回的default属性或直接返回对象的情况
 */

type PolarisTranslations = Record<string, unknown>;

/**
 * 安全地提取Polaris翻译对象
 * 处理JSON模块导入可能返回 { default: translations } 或直接返回 translations 的情况
 */
export function getPolarisTranslations(
  translations: PolarisTranslations | { default: PolarisTranslations }
): PolarisTranslations {
  // 检查是否是带有default属性的对象（某些构建工具的行为）
  if (
    typeof translations === "object" &&
    translations !== null &&
    "default" in translations &&
    typeof translations.default === "object" &&
    translations.default !== null
  ) {
    return translations.default as PolarisTranslations;
  }
  
  // 直接返回翻译对象
  return translations as PolarisTranslations;
}

