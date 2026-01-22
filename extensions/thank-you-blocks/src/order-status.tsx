import {
  reactExtension,
  BlockStack,
  View,
  Text,
  Button,
  Link,
  Divider,
  useApi,
  useOrder,
  useSubscription,
} from "@shopify/ui-extensions-react/customer-account";
import { useState, useEffect } from "react";
import { getValidatedBackendUrl, isDevMode } from "./config";
import { reportExtensionError } from "./error-reporting";
import { getOrderContextFromCustomerAccount } from "./order-context";
import { PCD_ORDER_UNAVAILABLE_USER } from "./pcd-copy";
import { SurveyModule as SharedSurveyModule, HelpModule as SharedHelpModule } from "./shared-components";

const uiComponents = {
  BlockStack,
  View,
  Text,
  Button,
  Link,
};


function ReorderModule({ 
  title, 
  subtitle, 
  buttonText,
  reorderUrl,
  onReorder,
  hasOrderContext
}: {
  title?: string;
  subtitle?: string;
  buttonText?: string;
  reorderUrl?: string | null;
  onReorder: () => Promise<void>;
  hasOrderContext: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleReorder = async () => {
    setLoading(true);
    setError(null);
    try {
      await onReorder();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_err) {
      setError("操作失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };
  if (!hasOrderContext) {
    return (
      <View border="base" cornerRadius="base" padding="base" background="bg-surface-critical-subdued">
        <BlockStack spacing="base">
          {title && <Text size="medium" emphasis="bold">{title}</Text>}
          <Text size="large" appearance="critical" emphasis="bold">⚠️ 订单信息不可用 - 功能暂时无法使用</Text>
          <Text appearance="subdued">再次购买功能暂时不可用。</Text>
          <Text appearance="subdued">{PCD_ORDER_UNAVAILABLE_USER}</Text>
        </BlockStack>
      </View>
    );
  }
  return (
    <View border="base" cornerRadius="base" padding="base">
      <BlockStack spacing="base">
        {title && <Text size="medium" emphasis="bold">{title}</Text>}
        {subtitle && <Text appearance="subdued">{subtitle}</Text>}
        {error && <Text appearance="critical">{error}</Text>}
        {reorderUrl ? (
          <Link to={reorderUrl} external>
            <Button
              kind="primary"
              loading={loading}
            >
              {buttonText || "再次购买"}
            </Button>
          </Link>
        ) : (
          <Button
            kind="primary"
            onPress={handleReorder}
            loading={loading}
          >
            {buttonText || "再次购买"}
          </Button>
        )}
      </BlockStack>
    </View>
  );
}

function OrderStatusBlocks() {
  const api = useApi<"customer-account.order-status.block.render">();
  const order = useOrder();
  const checkoutToken = useSubscription(api.checkoutToken);
  const [moduleState, setModuleState] = useState<{
    surveyEnabled: boolean;
    helpEnabled: boolean;
    reorderEnabled?: boolean;
    surveyConfig?: {
      question: string;
      options: string[];
    };
    helpConfig?: {
      faqUrl?: string;
      supportUrl?: string;
    };
    reorderConfig?: {
      title?: string;
      subtitle?: string;
      buttonText?: string;
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [reorderUrl, setReorderUrl] = useState<string | null>(null);
  const [, setReorderLoading] = useState(false);

  useEffect(() => {
    const fetchModuleState = async () => {
      try {
        const backendUrl = getValidatedBackendUrl();
        if (!backendUrl) {
          if (isDevMode()) {
            console.warn("[OrderStatusBlocks] Backend URL not configured");
          }
          setModuleState({
            surveyEnabled: false,
            helpEnabled: false,
            reorderEnabled: false,
          });
          setLoading(false);
          return;
        }
        const orderContext = getOrderContextFromCustomerAccount({
          order,
          checkoutToken,
        });
        if (!orderContext.orderId) {
          if (isDevMode()) {
            console.warn("[OrderStatusBlocks] Order ID not available, skipping module state fetch");
          }
          setModuleState({
            surveyEnabled: false,
            helpEnabled: false,
            reorderEnabled: false,
          });
          setLoading(false);
          return;
        }
        const token = await api.sessionToken.get();
        let lastError: Error | null = null;
        let retryCount = 0;
        const maxRetries = 1;
        while (retryCount <= maxRetries) {
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 5000);
          try {
            const response = await fetch(`${backendUrl}/api/ui-modules-state?target=order-status&orderId=${encodeURIComponent(orderContext.orderId)}`, {
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
              return;
            } else {
              const errorText = await response.text().catch(() => `HTTP ${response.status}`);
              const errorMessage = `Failed to fetch module state: ${response.status} ${errorText}`;
              lastError = new Error(errorMessage);
              if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 500));
                retryCount++;
                continue;
              }
              if (isDevMode()) {
                console.error("[OrderStatusBlocks] Module state fetch failed:", errorMessage);
              }
              reportExtensionError(api, {
                extension: "order-status",
                endpoint: "ui-modules-state",
                error: errorMessage,
                stack: null,
                target: "order-status",
                timestamp: new Date().toISOString(),
              });
              setModuleState({
                surveyEnabled: false,
                helpEnabled: false,
                reorderEnabled: false,
              });
              return;
            }
          } catch (fetchErr) {
            clearTimeout(tid);
            if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
              if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 500));
                retryCount++;
                continue;
              }
              setModuleState({
                surveyEnabled: false,
                helpEnabled: false,
                reorderEnabled: false,
              });
              return;
            } else {
              lastError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
              if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 500));
                retryCount++;
                continue;
              }
              const errorMessage = lastError.message;
              const errorStack = lastError.stack;
              if (isDevMode()) {
                console.error("[OrderStatusBlocks] Failed to fetch module state:", fetchErr);
              }
              reportExtensionError(api, {
                extension: "order-status",
                endpoint: "ui-modules-state",
                error: errorMessage,
                stack: errorStack,
                target: "order-status",
                timestamp: new Date().toISOString(),
              });
              setModuleState({
                surveyEnabled: false,
                helpEnabled: false,
                reorderEnabled: false,
              });
              return;
            }
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        if (isDevMode()) {
          console.error("[OrderStatusBlocks] Failed to fetch module state:", error);
        }
        reportExtensionError(api, {
          extension: "order-status",
          endpoint: "ui-modules-state",
          error: errorMessage,
          stack: errorStack,
          target: "order-status",
          timestamp: new Date().toISOString(),
        });
        setModuleState({
          surveyEnabled: false,
          helpEnabled: false,
          reorderEnabled: false,
        });
      } finally {
        setLoading(false);
      }
    };
    fetchModuleState();
  }, [api, order, checkoutToken]);
  if (!moduleState || (!moduleState.surveyEnabled && !moduleState.helpEnabled && !moduleState.reorderEnabled)) {
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
      const orderContext = getOrderContextFromCustomerAccount({
        order,
        checkoutToken,
      });
      if (!orderContext.orderId && !orderContext.checkoutToken) {
        const errorMessage = `订单信息不可用（Order ID 和 checkout token 均为空）。${PCD_ORDER_UNAVAILABLE_USER}`;
        if (isDevMode()) {
          console.error("[OrderStatusBlocks] " + errorMessage);
        }
        reportExtensionError(api, {
          extension: "order-status",
          endpoint: "survey",
          error: errorMessage,
          stack: null,
          target: "order-status",
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
          console.error("[OrderStatusBlocks] Survey submit failed:", errorMessage);
        }
        reportExtensionError(api, {
          extension: "order-status",
          endpoint: "survey",
          error: errorMessage,
          stack: null,
          target: "order-status",
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
        console.error("[OrderStatusBlocks] Survey submit failed:", error);
      }
      reportExtensionError(api, {
        extension: "order-status",
        endpoint: "survey",
        error: errorMessage,
        stack: errorStack,
        target: "order-status",
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
  const reorderEnabled = moduleState?.reorderEnabled ?? false;
  const reorderConfig = moduleState?.reorderConfig;
  const orderContext = getOrderContextFromCustomerAccount({
    order,
    checkoutToken,
  });
  const hasOrderContext = !!(orderContext.orderId || orderContext.checkoutToken);
  const handleReorder = async (): Promise<void> => {
    try {
      setReorderLoading(true);
      const backendUrl = getValidatedBackendUrl();
      if (!backendUrl) {
        throw new Error("Backend URL not configured");
      }
      const orderContext = getOrderContextFromCustomerAccount({
        order,
        checkoutToken,
      });
      if (!orderContext.orderId) {
        const errorMessage = `订单 ID 不可用。${PCD_ORDER_UNAVAILABLE_USER}`;
        if (isDevMode()) {
          console.error("[OrderStatusBlocks] " + errorMessage);
        }
        reportExtensionError(api, {
          extension: "order-status",
          endpoint: "reorder",
          error: errorMessage,
          stack: null,
          target: "order-status",
          timestamp: new Date().toISOString(),
        });
        throw new Error(errorMessage);
      }
      const nonce = moduleState?.reorderConfig?.nonce;
      if (!nonce) {
        const errorMessage = "再次购买功能暂时不可用（缺少安全令牌）";
        if (isDevMode()) {
          console.error("[OrderStatusBlocks] " + errorMessage);
        }
        reportExtensionError(api, {
          extension: "order-status",
          endpoint: "reorder",
          error: errorMessage,
          stack: null,
          target: "order-status",
          orderId: orderContext.orderId,
          timestamp: new Date().toISOString(),
        });
        throw new Error(errorMessage);
      }
      const token = await api.sessionToken.get();
      const response = await fetch(`${backendUrl}/api/reorder?orderId=${encodeURIComponent(orderContext.orderId)}&nonce=${encodeURIComponent(nonce)}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => `HTTP ${response.status}`);
        let errorMessage = `Failed to get reorder URL: ${response.status} ${errorText}`;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData && typeof errorData === "object" && "error" in errorData && typeof errorData.error === "string") {
            errorMessage = errorData.error;
          }
        } catch {
          // no-op: use errorMessage from errorText
        }
        if (isDevMode()) {
          console.error("[OrderStatusBlocks] Reorder failed:", errorMessage);
        }
        reportExtensionError(api, {
          extension: "order-status",
          endpoint: "reorder",
          error: errorMessage,
          stack: null,
          target: "order-status",
          orderId: orderContext.orderId,
          timestamp: new Date().toISOString(),
        });
        throw new Error(errorMessage);
      }
      const data = await response.json();
      if (data.reorderUrl) {
        setReorderUrl(data.reorderUrl);
      } else {
        throw new Error("Reorder URL not returned");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      if (isDevMode()) {
        console.error("[OrderStatusBlocks] Reorder failed:", error);
      }
      const orderContext = getOrderContextFromCustomerAccount({
        order,
        checkoutToken,
      });
      reportExtensionError(api, {
        extension: "order-status",
        endpoint: "reorder",
        error: errorMessage,
        stack: errorStack,
        target: "order-status",
        orderId: orderContext.orderId,
        timestamp: new Date().toISOString(),
      });
      throw error;
    } finally {
      setReorderLoading(false);
    }
  };
  return (
    <BlockStack spacing="base">
      {!hasOrderContext && (surveyEnabled || helpEnabled || reorderEnabled) && (
        <View border="base" cornerRadius="base" padding="base" background="bg-surface-critical-subdued">
          <BlockStack spacing="base">
            <Text size="large" emphasis="bold" appearance="critical">⚠️ 订单信息不可用 - 功能暂时无法使用</Text>
            <Text appearance="subdued">问卷功能、再购功能和帮助中心可能暂时不可用。</Text>
            <Text appearance="subdued">{PCD_ORDER_UNAVAILABLE_USER}</Text>
          </BlockStack>
        </View>
      )}
      {reorderEnabled && (
        <>
          <ReorderModule
            title={reorderConfig?.title}
            subtitle={reorderConfig?.subtitle}
            buttonText={reorderConfig?.buttonText}
            reorderUrl={reorderUrl}
            onReorder={handleReorder}
            hasOrderContext={hasOrderContext}
          />
          <Divider />
        </>
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
        <SharedHelpModule
          faqUrl={helpFaqUrl}
          supportUrl={helpSupportUrl}
          components={uiComponents}
        />
      )}
    </BlockStack>
  );
}

export default reactExtension(
  "customer-account.order-status.block.render",
  () => <OrderStatusBlocks />
);
