import {
  reactExtension,
  BlockStack,
  View,
  Text,
  Button,
  Link,
  Divider,
  useApi,
} from "@shopify/ui-extensions-react/customer-account";
import { useState, useEffect } from "react";
import { getValidatedBackendUrl, isDevMode } from "./config";
import { reportExtensionError } from "./error-reporting";
import { getOrderContext } from "./order-context";

function SurveyModule({ 
  question, 
  options, 
  onSubmit 
}: {
  question: string;
  options: string[];
  onSubmit: (selectedOption: string) => Promise<boolean>;
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
    } catch (err) {
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

function ReorderModule({ 
  title, 
  subtitle, 
  buttonText,
  reorderUrl,
  onReorder 
}: {
  title?: string;
  subtitle?: string;
  buttonText?: string;
  reorderUrl?: string | null;
  onReorder: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleReorder = async () => {
    setLoading(true);
    setError(null);
    try {
      await onReorder();
    } catch (err) {
      setError("操作失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };
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
  const [reorderLoading, setReorderLoading] = useState(false);
  
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
        const token = await api.sessionToken.get();
        const response = await fetch(`${backendUrl}/api/ui-modules-state?target=order-status`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
          },
        });
        if (response.ok) {
          const state = await response.json();
          setModuleState(state);
          if (isDevMode()) {
            console.log("[OrderStatusBlocks] Module state loaded:", state);
          }
        } else {
          const errorText = await response.text().catch(() => `HTTP ${response.status}`);
          const errorMessage = `Failed to fetch module state: ${response.status} ${errorText}`;
          if (isDevMode()) {
            console.error("[OrderStatusBlocks] Module state fetch failed:", errorMessage);
          }
          await reportExtensionError(api, {
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
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        if (isDevMode()) {
          console.error("[OrderStatusBlocks] Failed to fetch module state:", error);
        }
        await reportExtensionError(api, {
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
  }, [api]);
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
      const orderContext = getOrderContext(api);
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
        await reportExtensionError(api, {
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
      await reportExtensionError(api, {
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
  const handleReorder = async (): Promise<void> => {
    try {
      setReorderLoading(true);
      const backendUrl = getValidatedBackendUrl();
      if (!backendUrl) {
        throw new Error("Backend URL not configured");
      }
      const orderContext = getOrderContext(api);
      if (!orderContext.orderId) {
        throw new Error("Order ID not available");
      }
      const token = await api.sessionToken.get();
      const response = await fetch(`${backendUrl}/api/reorder?orderId=${encodeURIComponent(orderContext.orderId)}`, {
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
        }
        if (isDevMode()) {
          console.error("[OrderStatusBlocks] Reorder failed:", errorMessage);
        }
        await reportExtensionError(api, {
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
      const orderContext = getOrderContext(api);
      await reportExtensionError(api, {
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
      {reorderEnabled && (
        <>
          <ReorderModule
            title={reorderConfig?.title}
            subtitle={reorderConfig?.subtitle}
            buttonText={reorderConfig?.buttonText}
            reorderUrl={reorderUrl}
            onReorder={handleReorder}
          />
          <Divider />
        </>
      )}
      {surveyEnabled && surveyQuestion && surveyOptions && surveyOptions.length > 0 && (
        <>
          <SurveyModule
            question={surveyQuestion}
            options={surveyOptions}
            onSubmit={handleSurveySubmit}
          />
          <Divider />
        </>
      )}
      {helpEnabled && (helpFaqUrl || helpSupportUrl) && (
        <HelpModule
          faqUrl={helpFaqUrl}
          supportUrl={helpSupportUrl}
        />
      )}
    </BlockStack>
  );
}

export default reactExtension(
  "customer-account.order-status.block.render",
  () => <OrderStatusBlocks />
);
