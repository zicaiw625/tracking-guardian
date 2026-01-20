import {
  reactExtension,
  BlockStack,
  View,
  Text,
  Button,
  Link,
  Divider,
  useApi,
} from "@shopify/ui-extensions-react/checkout";
import { useState, useEffect } from "react";
import { getValidatedBackendUrl, isDevMode } from "./config";
import { reportExtensionError } from "./error-reporting";
import { getOrderContext } from "./order-context";
import { PCD_ORDER_UNAVAILABLE_USER } from "./pcd-copy";

function SurveyModule({ 
  question, 
  options, 
  onSubmit,
  hasOrderContext
}: {
  question: string;
  options: string[];
  onSubmit: (selectedOption: string) => Promise<boolean>;
  hasOrderContext: boolean;
}) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (submitted) {
    return (
      <View>
        <Text appearance="subdued">感谢您的反馈！</Text>
      </View>
    );
  }
  if (!hasOrderContext) {
    return (
      <View border="base" cornerRadius="base" padding="base" background="bg-surface-critical-subdued">
        <BlockStack spacing="base">
          <Text size="medium" emphasis="bold">{question}</Text>
          <Text size="large" appearance="critical" emphasis="bold">⚠️ 订单信息不可用 - 功能暂时无法使用</Text>
          <Text appearance="subdued">问卷功能暂时不可用。</Text>
          <Text appearance="subdued">{PCD_ORDER_UNAVAILABLE_USER}</Text>
        </BlockStack>
      </View>
    );
  }
  const handleSubmit = async () => {
    if (!selectedOption) return;
    setSubmitting(true);
    setError(null);
    try {
      const success = await onSubmit(selectedOption);
      if (success) {
        setSubmitted(true);
      } else {
        setError("提交失败，请稍后重试");
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_err) {
      setError("提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <View border="base" cornerRadius="base" padding="base">
      <BlockStack spacing="base">
        <Text size="medium" emphasis="bold">{question}</Text>
        <BlockStack spacing="tight">
          {options.map((option, index) => (
            <Button
              key={index}
              kind={selectedOption === option ? "primary" : "secondary"}
              onPress={() => setSelectedOption(option)}
              disabled={submitting}
            >
              {option}
            </Button>
          ))}
        </BlockStack>
        {error && (
          <Text appearance="critical">{error}</Text>
        )}
        {selectedOption && (
          <Button
            kind="primary"
            onPress={handleSubmit}
            loading={submitting}
          >
            提交
          </Button>
        )}
      </BlockStack>
    </View>
  );
}

function HelpModule({ 
  faqUrl, 
  supportUrl 
}: {
  faqUrl?: string;
  supportUrl?: string;
}) {
  return (
    <View border="base" cornerRadius="base" padding="base">
      <BlockStack spacing="base">
        <Text size="medium" emphasis="bold">需要帮助？</Text>
        <BlockStack spacing="tight">
          {faqUrl && (
            <Link to={faqUrl} external>
              <Text>查看常见问题</Text>
            </Link>
          )}
          {supportUrl && (
            <Link to={supportUrl} external>
              <Text>联系客服</Text>
            </Link>
          )}
        </BlockStack>
      </BlockStack>
    </View>
  );
}


function ThankYouBlocks() {
  const api = useApi();
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
  useEffect(() => {
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
        const tid = setTimeout(() => controller.abort(), 1000);
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
      }
    };
    fetchModuleState();
  }, [api]);
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
      const orderContext = getOrderContext(api);
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
  let orderContext: { orderId: string | null; checkoutToken: string | null };
  let hasOrderContext = false;
  try {
    orderContext = getOrderContext(api);
    hasOrderContext = !!(orderContext.orderId || orderContext.checkoutToken);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_error) {
    orderContext = { orderId: null, checkoutToken: null };
    hasOrderContext = false;
  }
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
          <SurveyModule
            question={surveyQuestion}
            options={surveyOptions}
            onSubmit={handleSurveySubmit}
            hasOrderContext={hasOrderContext}
          />
          <Divider />
        </>
      )}
      {helpEnabled && (helpFaqUrl || helpSupportUrl) && (
        <>
          <HelpModule
            faqUrl={helpFaqUrl}
            supportUrl={helpSupportUrl}
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
