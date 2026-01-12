import {
  reactExtension,
  BlockStack,
  View,
  Text,
  Button,
  Link,
  Divider,
  useApi,
  useSettings,
} from "@shopify/ui-extensions-react/customer-account";
import { useState, useEffect } from "react";
import { BUILD_TIME_URL } from "./config";

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
  buttonText 
}: {
  buttonText: string;
}) {
  const api = useApi<"customer-account.order-status.block.render">();
  const [loading, setLoading] = useState(false);
  const [reorderUrl, setReorderUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleReorder = async () => {
    setLoading(true);
    setError(null);
    try {
      const orderId =
        (api as any)?.order?.current?.id ??
        (api as any)?.order?.value?.id ??
        (api as any)?.purchase?.order?.id ??
        (api as any)?.purchase?.orderId;
      if (!orderId) {
        setError("无法获取订单信息，请稍后重试");
        setLoading(false);
        return;
      }
      const token = await api.sessionToken.get();
      const response = await fetch(`${BUILD_TIME_URL}/api/reorder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: orderId,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.reorderUrl) {
          setReorderUrl(data.reorderUrl);
        } else {
          setError("无法生成再次购买链接，请稍后重试");
        }
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        setError(errorData.error || errorData.message || "操作失败，请稍后重试");
      }
    } catch (error) {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };
  if (reorderUrl) {
    return (
      <View border="base" cornerRadius="base" padding="base">
        <Link to={reorderUrl} external>
          <Button kind="primary">
            {buttonText || "再次购买"}
          </Button>
        </Link>
      </View>
    );
  }
  return (
    <View border="base" cornerRadius="base" padding="base">
      <BlockStack spacing="base">
        <Button 
          kind="primary" 
          onPress={handleReorder}
          loading={loading}
        >
          {buttonText || "再次购买"}
        </Button>
        {error && (
          <Text appearance="critical">{error}</Text>
        )}
      </BlockStack>
    </View>
  );
}

function ThankYouBlocks() {
  const api = useApi<"customer-account.order-status.block.render">();
  const settings = useSettings();
  const [moduleState, setModuleState] = useState<{
    surveyEnabled: boolean;
    helpEnabled: boolean;
    reorderEnabled: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const fetchModuleState = async () => {
      try {
        const token = await api.sessionToken.get();
        const response = await fetch(`${BUILD_TIME_URL}/api/ui-modules-state?target=order-status`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
          },
        });
        if (response.ok) {
          const state = await response.json();
          setModuleState(state);
        } else {
          setModuleState({
            surveyEnabled: false,
            helpEnabled: false,
            reorderEnabled: false,
          });
        }
      } catch (error) {
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
  const surveyQuestion = settings.survey_question ?? "您对我们的服务满意吗？";
  const surveyOptions = (settings.survey_options as string)?.split(",") || 
    ["非常满意", "满意", "一般", "不满意"];
  const helpFaqUrl = settings.help_faq_url as string | undefined;
  const helpSupportUrl = settings.help_support_url as string | undefined;
  const reorderButtonText = (settings.reorder_button_text as string) || "再次购买";
  const handleSurveySubmit = async (selectedOption: string): Promise<boolean> => {
    try {
      const token = await api.sessionToken.get();
      const response = await fetch(`${BUILD_TIME_URL}/api/survey`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          option: selectedOption,
          timestamp: new Date().toISOString(),
        }),
      });
      if (!response.ok) {
        return false;
      }
      const data = await response.json().catch(() => ({}));
      if (data && data.success === true) {
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  };
  if (loading) {
    return null;
  }
  const surveyEnabled = moduleState?.surveyEnabled ?? false;
  const helpEnabled = moduleState?.helpEnabled ?? false;
  const reorderEnabled = moduleState?.reorderEnabled ?? false;
  return (
    <BlockStack spacing="base">
      {surveyEnabled && (
        <>
          <SurveyModule
            question={surveyQuestion}
            options={surveyOptions}
            onSubmit={handleSurveySubmit}
          />
          <Divider />
        </>
      )}
      {helpEnabled && (
        <>
          <HelpModule
            faqUrl={helpFaqUrl}
            supportUrl={helpSupportUrl}
          />
          <Divider />
        </>
      )}
      {reorderEnabled && (
        <ReorderModule buttonText={reorderButtonText} />
      )}
    </BlockStack>
  );
}

export default reactExtension(
  "customer-account.order-status.block.render",
  () => <ThankYouBlocks />
);
