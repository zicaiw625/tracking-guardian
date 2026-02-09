import { Button, Popover, ActionList } from "@shopify/polaris";
import { GlobeIcon } from "~/components/icons";
import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher, useRevalidator } from "@remix-run/react";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const fetcher = useFetcher<{ ok?: boolean; locale?: string }>();
  const revalidator = useRevalidator();
  const [active, setActive] = useState(false);

  const toggleActive = useCallback(() => setActive((active) => !active), []);

  const handleLanguageChange = useCallback(
    async (lng: string) => {
      // 1) Immediately switch client-side language (UI updates instantly)
      await i18n.changeLanguage(lng);
      // document.documentElement.lang = lng; // handled by root.tsx/i18n but good to have if needed, sticking to user's code which didn't strictly require it but i18n.changeLanguage does the heavy lifting. The user's snippet removed the manual document.documentElement.lang assignment, relying on revalidation and i18n.

      // 2) Silently write preference to server cookie (no redirect)
      const formData = new FormData();
      formData.append("locale", lng);
      fetcher.submit(formData, { method: "post", action: "/actions/set-locale" });
      
      setActive(false);
    },
    [fetcher, i18n]
  );

  // 3) Force revalidate after cookie is written to sync root.loader locale
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

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
