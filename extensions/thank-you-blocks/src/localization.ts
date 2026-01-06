/**
 * P0-1: PRD 对齐 - 本地化支持工具函数
 * 
 * 从 settings 中根据当前 locale 选择对应的本地化文本
 * 支持回退机制: 当前 locale -> 语言代码 (如 zh-CN -> zh) -> 默认值
 */

export interface LocalizationSettings {
  [locale: string]: {
    title?: string;
    subtitle?: string;
    buttonText?: string;
    question?: string;
    description?: string;
  };
}

/**
 * 获取当前 locale
 * 尝试从多个来源获取: API locale -> 浏览器语言 -> 默认 'en'
 */
export function getCurrentLocale(api?: { locale?: string }): string {
  // 尝试从 API 获取 locale
  if (api?.locale) {
    return normalizeLocale(api.locale);
  }

  // 回退到浏览器语言
  if (typeof navigator !== 'undefined' && navigator.language) {
    return normalizeLocale(navigator.language);
  }

  // 默认使用英文
  return 'en';
}

/**
 * 标准化 locale 格式 (如 'zh-CN' -> 'zh-CN', 'zh' -> 'zh')
 */
function normalizeLocale(locale: string): string {
  return locale.toLowerCase().trim();
}

/**
 * 从 settings 中获取本地化文本
 * 
 * @param settings - 包含 localization 和默认字段的 settings 对象
 * @param fieldName - 字段名 (如 'title', 'question')
 * @param defaultValue - 默认值
 * @param locale - 当前 locale (可选,如果不提供会尝试自动检测)
 * @param api - API 对象 (用于获取 locale)
 */
export function getLocalizedText(
  settings: Record<string, unknown>,
  fieldName: string,
  defaultValue: string,
  locale?: string,
  api?: { locale?: string }
): string {
  const currentLocale = locale || getCurrentLocale(api);

  // 方法1: 从 localization 对象中获取
  const localization = settings.localization as LocalizationSettings | undefined;
  if (localization) {
    // 尝试精确匹配 (如 'zh-CN')
    if (localization[currentLocale]?.[fieldName as keyof typeof localization[string]]) {
      return localization[currentLocale][fieldName as keyof typeof localization[string]] as string;
    }

    // 尝试语言代码匹配 (如 'zh-CN' -> 'zh')
    const langCode = currentLocale.split('-')[0];
    if (localization[langCode]?.[fieldName as keyof typeof localization[string]]) {
      return localization[langCode][fieldName as keyof typeof localization[string]] as string;
    }
  }

  // 方法2: 从扁平化的 settings 字段中获取 (如 'survey_title_zh-CN')
  const localizedFieldKey = `${fieldName}_${currentLocale}`;
  if (settings[localizedFieldKey] && typeof settings[localizedFieldKey] === 'string') {
    return settings[localizedFieldKey] as string;
  }

  // 尝试语言代码 (如 'survey_title_zh')
  const langCode = currentLocale.split('-')[0];
  const langFieldKey = `${fieldName}_${langCode}`;
  if (settings[langFieldKey] && typeof settings[langFieldKey] === 'string') {
    return settings[langFieldKey] as string;
  }

  // 方法3: 使用默认字段 (如 'survey_title')
  if (settings[fieldName] && typeof settings[fieldName] === 'string') {
    return settings[fieldName] as string;
  }

  // 最终回退到提供的默认值
  return defaultValue;
}

