import { Button, Popover, ActionList } from "@shopify/polaris";
import { GlobeIcon } from "~/components/icons";
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [active, setActive] = useState(false);

  const toggleActive = useCallback(() => setActive((active) => !active), []);

  const handleLanguageChange = useCallback(
    (lng: string) => {
      i18n.changeLanguage(lng);
      setActive(false);
    },
    [i18n]
  );

  const activator = (
    <Button onClick={toggleActive} icon={GlobeIcon} variant="plain">
      {i18n.language?.startsWith("zh") ? "中文" : "English"}
    </Button>
  );

  return (
    <Popover active={active} activator={activator} onClose={toggleActive}>
      <ActionList
        items={[
          {
            content: "English",
            onAction: () => handleLanguageChange("en"),
            active: i18n.language === "en",
          },
          {
            content: "中文",
            onAction: () => handleLanguageChange("zh"),
            active: i18n.language === "zh",
          },
        ]}
      />
    </Popover>
  );
}
