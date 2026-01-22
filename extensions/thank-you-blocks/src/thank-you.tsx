import {
  reactExtension,
  BlockStack,
  View,
  Text,
  Button,
  Link,
  Divider,
  useApi,
  useSubscription,
} from "@shopify/ui-extensions-react/checkout";
import { useState, useEffect } from "react";
import { getValidatedBackendUrl, isDevMode } from "./config";
import { reportExtensionError } from "./error-reporting";
import { getOrderContextFromCheckout } from "./order-context";
import { PCD_ORDER_UNAVAILABLE_USER } from "./pcd-copy";
import { SurveyModule as SharedSurveyModule, HelpModule as SharedHelpModule } from "./shared-components";

const uiComponents = {
  BlockStack,
  View,
  Text,
  Button,
  Link,
};



function ThankYouBlocks() {
  const api = useApi();
  const checkoutToken = useSubscription(api.checkoutToken);
  const orderConfirmation = useSubscription(api.orderConfirmation);
  const [moduleState, setModuleState] = useState<{
    surveyEnabled: boolean;
    helpEnabled: boolean;
    surveyConfig?: {
      question: string;
      options: string[];
    };
    helpConfig?: {
      faqUrl?: string;
      supportUrl?: string;
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasFetched, setHasFetched] = useState(false);
  useEffect(() => {
    if (hasFetched) {
      return;
    }
    const fetchModuleState = async () => {
      try {
        const backendUrl = getValidatedBackendUrl();
        if (!backendUrl) {
          if (isDevMode()) {
            console.warn("[ThankYouBlocks] Backend URL not configured");
          }
          setModuleState({
            surveyEnabled: false,
            helpEnabled: false,
          });
          setLoading(false);
          return;
        }
        const token = await api.sessionToken.get();
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 1800);
        try {
          const response = await fetch(`${backendUrl}/api/ui-modules-state`, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${token}`,
            },
            signal: controller.signal,
          });
          clearTimeout(tid);
          if (response.ok) {
            const state = await response.json();
            setModuleState(state);
          } else {
            const errorText = await response.text().catch(() => `HTTP ${response.status}`);
            const errorMessage = `Failed to fetch module state: ${response.status} ${errorText}`;
            if (isDevMode()) {
              console.error("[ThankYouBlocks] Module state fetch failed:", errorMessage);
            }
            reportExtensionError(api, {
              extension: "thank-you",
              endpoint: "ui-modules-state",
              error: errorMessage,
              stack: null,
              target: "thank-you",
              timestamp: new Date().toISOString(),
            });
            setModuleState({
              surveyEnabled: false,
              helpEnabled: false,
            });
          }
        } catch (fetchErr) {
          clearTimeout(tid);
          if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
            setModuleState({
              surveyEnabled: false,
              helpEnabled: false,
            });
          } else {
            const errorMessage = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
            const errorStack = fetchErr instanceof Error ? fetchErr.stack : undefined;
            if (isDevMode()) {
              console.error("[ThankYouBlocks] Failed to fetch module state:", fetchErr);
            }
            reportExtensionError(api, {
              extension: "thank-you",
              endpoint: "ui-modules-state",
              error: errorMessage,
              stack: errorStack,
              target: "thank-you",
              timestamp: new Date().toISOString(),
            });
            setModuleState({
              surveyEnabled: false,
              helpEnabled: false,
            });
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        if (isDevMode()) {
          console.error("[ThankYouBlocks] Failed to fetch module state:", error);
        }
        reportExtensionError(api, {
          extension: "thank-you",
          endpoint: "ui-modules-state",
          error: errorMessage,
          stack: errorStack,
          target: "thank-you",
          timestamp: new Date().toISOString(),
        });
        setModuleState({
          surveyEnabled: false,
          helpEnabled: false,
        });
      } finally {
        setLoading(false);
        setHasFetched(true);
      }
    };
    fetchModuleState();
  }, [api, hasFetched]);
  if (!moduleState || !moduleState.surveyEnabled && !moduleState.helpEnabled) {
    return null;
  }
  const surveyQuestion = moduleState?.surveyConfig?.question;
  const surveyOptions = moduleState?.surveyConfig?.options;
  const helpFaqUrl = moduleState?.helpConfig?.faqUrl;
  const helpSupportUrl = moduleState?.helpConfig?.supportUrl;
  const handleSurveySubmit = async (selectedOption: string): Promise<boolean> => {
    try {
      const backendUrl = getValidatedBackendUrl();
      if (!backendUrl) {
        return false;
      }
      const token = await api.sessionToken.get();
      const orderContext = getOrderContextFromCheckout({
        checkoutToken,
        orderConfirmation,
      });
      if (!orderContext.orderId && !orderContext.checkoutToken) {
        const errorMessage = `订单信息不可用（Order ID 和 checkout token 均为空）。${PCD_ORDER_UNAVAILABLE_USER}`;
        if (isDevMode()) {
          console.error("[ThankYouBlocks] " + errorMessage);
        }
        reportExtensionError(api, {
          extension: "thank-you",
          endpoint: "survey",
          error: errorMessage,
          stack: null,
          target: "thank-you",
          timestamp: new Date().toISOString(),
        });
        return false;
      }
      const response = await fetch(`${backendUrl}/api/survey`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          option: selectedOption,
          timestamp: new Date().toISOString(),
          orderId: orderContext.orderId,
          checkoutToken: orderContext.checkoutToken,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => `HTTP ${response.status}`);
        const errorMessage = `Survey submit failed: ${response.status} ${errorText}`;
        if (isDevMode()) {
          console.error("[ThankYouBlocks] Survey submit failed:", errorMessage);
        }
        reportExtensionError(api, {
          extension: "thank-you",
          endpoint: "survey",
          error: errorMessage,
          stack: null,
          target: "thank-you",
          timestamp: new Date().toISOString(),
        });
        return false;
      }
      const data = await response.json().catch(() => ({}));
      if (data && data.success === true) {
        return true;
      }
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      if (isDevMode()) {
        console.error("[ThankYouBlocks] Survey submit failed:", error);
      }
      reportExtensionError(api, {
        extension: "thank-you",
        endpoint: "survey",
        error: errorMessage,
        stack: errorStack,
        target: "thank-you",
        timestamp: new Date().toISOString(),
      });
      return false;
    }
  };
  if (loading) {
    return null;
  }
  const surveyEnabled = moduleState?.surveyEnabled ?? false;
  const helpEnabled = moduleState?.helpEnabled ?? false;
  const orderContext = getOrderContextFromCheckout({
    checkoutToken,
    orderConfirmation,
  });
  const hasOrderContext = !!(orderContext.orderId || orderContext.checkoutToken);
  return (
    <BlockStack spacing="base">
      {!hasOrderContext && (surveyEnabled || helpEnabled) && (
        <View border="base" cornerRadius="base" padding="base" background="bg-surface-critical-subdued">
          <BlockStack spacing="base">
            <Text size="large" emphasis="bold" appearance="critical">⚠️ 订单信息不可用 - 功能暂时无法使用</Text>
            <Text appearance="subdued">问卷功能和帮助中心可能暂时不可用。</Text>
            <Text appearance="subdued">{PCD_ORDER_UNAVAILABLE_USER}</Text>
          </BlockStack>
        </View>
      )}
      {surveyEnabled && surveyQuestion && surveyOptions && surveyOptions.length > 0 && (
        <>
          <SharedSurveyModule
            question={surveyQuestion}
            options={surveyOptions}
            onSubmit={handleSurveySubmit}
            hasOrderContext={hasOrderContext}
            components={uiComponents}
          />
          <Divider />
        </>
      )}
      {helpEnabled && (helpFaqUrl || helpSupportUrl) && (
        <>
          <SharedHelpModule
            faqUrl={helpFaqUrl}
            supportUrl={helpSupportUrl}
            components={uiComponents}
          />
          <Divider />
        </>
      )}
    </BlockStack>
  );
}

export default reactExtension(
  "purchase.thank-you.block.render",
  () => <ThankYouBlocks />
);
