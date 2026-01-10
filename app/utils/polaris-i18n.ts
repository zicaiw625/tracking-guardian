type PolarisTranslations = Record<string, unknown>;

export function getPolarisTranslations(
  translations: PolarisTranslations | { default: PolarisTranslations }
): PolarisTranslations {
  if (
    typeof translations === "object" &&
    translations !== null &&
    "default" in translations &&
    typeof translations.default === "object" &&
    translations.default !== null
  ) {
    return translations.default as PolarisTranslations;
  }
  return translations as PolarisTranslations;
}
