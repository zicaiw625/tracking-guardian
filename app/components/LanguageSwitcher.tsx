import { Button, Popover, ActionList } from "@shopify/polaris";
import { GlobeIcon } from "~/components/icons";
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "@remix-run/react";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const fetcher = useFetcher();
  const [active, setActive] = useState(false);

  const toggleActive = useCallback(() => setActive((active) => !active), []);

  const handleLanguageChange = useCallback(
    (lng: string) => {
      const formData = new FormData();
      formData.append("locale", lng);
      fetcher.submit(formData, { method: "post", action: "/actions/set-locale" });
      i18n.changeLanguage(lng);
      setActive(false);
    },
    [fetcher, i18n]
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
            active: i18n.language?.startsWith("en") || i18n.language === "en-US",
          },
          {
            content: "中文",
            onAction: () => handleLanguageChange("zh"),
            active: i18n.language?.startsWith("zh"),
          },
        ]}
      />
    </Popover>
  );
}
