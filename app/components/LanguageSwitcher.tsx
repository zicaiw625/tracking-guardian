import { Button, Popover, ActionList } from "@shopify/polaris";
import { GlobeIcon } from "~/components/icons";
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const [active, setActive] = useState(false);

  const toggleActive = useCallback(() => setActive((active) => !active), []);

  const handleLanguageChange = useCallback(
    (lng: string) => {
      i18n.changeLanguage(lng);
      setActive(false);
    },
    [i18n]
  );

  const currentLang = i18n.resolvedLanguage ?? i18n.language;
  const isZh = currentLang?.toLowerCase().startsWith("zh");

  const activator = (
    <Button onClick={toggleActive} icon={GlobeIcon} variant="plain">
      {isZh ? t("common.language.chinese") : t("common.language.english")}
    </Button>
  );

  return (
    <Popover active={active} activator={activator} onClose={toggleActive}>
      <ActionList
        items={[
          {
            content: t("common.language.english"),
            onAction: () => handleLanguageChange("en"),
            active: !isZh,
          },
          {
            content: t("common.language.chinese"),
            onAction: () => handleLanguageChange("zh"),
            active: !!isZh,
          },
        ]}
      />
    </Popover>
  );
}
