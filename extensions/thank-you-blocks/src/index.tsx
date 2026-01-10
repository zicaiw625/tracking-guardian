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
} from "@shopify/ui-extensions-react/checkout";
import { useState } from "react";

import { BUILD_TIME_URL } from "./config";

function SurveyModule({ 
  question, 
  options, 
  onSubmit 
}: {
  question: string;
  options: string[];
  onSubmit: (selectedOption: string) => void;
}) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  if (submitted) {
    return (
      <View>
        <Text appearance="subdued">感谢您的反馈！</Text>
      </View>
    );
  }
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
            >
              {option}
            </Button>
          ))}
        </BlockStack>
        {selectedOption && (
          <Button
            kind="primary"
            onPress={() => {
              onSubmit(selectedOption);
              setSubmitted(true);
            }}
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
            <Button kind="secondary" to={faqUrl}>
              查看常见问题
            </Button>
          )}
          {supportUrl && (
            <Button kind="secondary" to={supportUrl}>
              联系客服
            </Button>
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
  const api = useApi();
  const [loading, setLoading] = useState(false);
  const handleReorder = async () => {
    setLoading(true);
    try {
      const purchase = (api as any).purchase;
      let orderId: string | undefined;
      if (purchase?.order?.id) {
        orderId = purchase.order.id;
      } else if (purchase?.orderId) {
        orderId = purchase.orderId;
      } else if ((api as any).order?.id) {
        orderId = (api as any).order.id;
      }
      if (!orderId) {
        console.error("Reorder failed: No order ID available from checkout API. Purchase object:", purchase);
        setLoading(false);
        return;
      }
      const response = await api.fetch(`${BUILD_TIME_URL}/api/reorder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId: orderId,
        }),
      });
      if (response.ok) {
        const data = await response.json();
      }
    } catch (error) {
      console.error("Reorder failed:", error);
    } finally {
      setLoading(false);
    }
  };
  return (
    <View border="base" cornerRadius="base" padding="base">
      <Button 
        kind="primary" 
        onPress={handleReorder}
        loading={loading}
      >
        {buttonText || "再次购买"}
      </Button>
    </View>
  );
}

export default reactExtension(
  "purchase.thank-you.block.render",
  () => <ThankYouBlocks />
);

export const OrderStatusExtension = reactExtension(
  "customer-account.order-status.block.render",
  () => <ThankYouBlocks />
);

function ThankYouBlocks() {
  const api = useApi();
  const settings = useSettings();
  const [surveySubmitted, setSurveySubmitted] = useState(false);
  const surveyEnabled = settings.survey_enabled ?? true;
  const surveyQuestion = settings.survey_question ?? "您对我们的服务满意吗？";
  const surveyOptions = (settings.survey_options as string)?.split(",") || 
    ["非常满意", "满意", "一般", "不满意"];
  const helpEnabled = settings.help_enabled ?? true;
  const helpFaqUrl = settings.help_faq_url as string | undefined;
  const helpSupportUrl = settings.help_support_url as string | undefined;
  const reorderEnabled = settings.reorder_enabled ?? false;
  const reorderButtonText = (settings.reorder_button_text as string) || "再次购买";
  const handleSurveySubmit = async (selectedOption: string) => {
    try {
      await api.fetch(`${BUILD_TIME_URL}/api/survey`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          option: selectedOption,
          timestamp: new Date().toISOString(),
        }),
      });
      setSurveySubmitted(true);
    } catch (error) {
      console.error("Survey submission failed:", error);
    }
  };
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
