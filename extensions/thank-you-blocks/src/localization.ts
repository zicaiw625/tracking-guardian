

export interface LocalizationSettings {
  [locale: string]: {
    title?: string;
    subtitle?: string;
    buttonText?: string;
    question?: string;
    description?: string;
  };
}

export function getCurrentLocale(api?: { locale?: string }): string {

  if (api?.locale) {
    return normalizeLocale(api.locale);
  }

  if (typeof navigator !== 'undefined' && navigator.language) {
    return normalizeLocale(navigator.language);
  }

  return 'en';
}

function normalizeLocale(locale: string): string {
  return locale.toLowerCase().trim();
}

export function getLocalizedText(
  settings: Record<string, unknown>,
  fieldName: string,
  defaultValue: string,
  locale?: string,
  api?: { locale?: string }
): string {
  const currentLocale = locale || getCurrentLocale(api);

  const localization = settings.localization as LocalizationSettings | undefined;
  if (localization) {

    if (localization[currentLocale]?.[fieldName as keyof typeof localization[string]]) {
      return localization[currentLocale][fieldName as keyof typeof localization[string]] as string;
    }

    const langCode = currentLocale.split('-')[0];
    if (localization[langCode]?.[fieldName as keyof typeof localization[string]]) {
      return localization[langCode][fieldName as keyof typeof localization[string]] as string;
    }
  }

  const localizedFieldKey = `${fieldName}_${currentLocale}`;
  if (settings[localizedFieldKey] && typeof settings[localizedFieldKey] === 'string') {
    return settings[localizedFieldKey] as string;
  }

  const langCode = currentLocale.split('-')[0];
  const langFieldKey = `${fieldName}_${langCode}`;
  if (settings[langFieldKey] && typeof settings[langFieldKey] === 'string') {
    return settings[langFieldKey] as string;
  }

  if (settings[fieldName] && typeof settings[fieldName] === 'string') {
    return settings[fieldName] as string;
  }

  return defaultValue;
}

