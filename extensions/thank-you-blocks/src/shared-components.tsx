import { useState } from "react";
import { PCD_ORDER_UNAVAILABLE_USER } from "./pcd-copy";

export interface SurveyModuleProps {
  question: string;
  options: string[];
  onSubmit: (selectedOption: string) => Promise<boolean>;
  hasOrderContext: boolean;
  components: {
    BlockStack: any;
    View: any;
    Text: any;
    Button: any;
  };
}

export function SurveyModule({ 
  question, 
  options, 
  onSubmit,
  hasOrderContext,
  components
}: SurveyModuleProps) {
  const { BlockStack, View, Text, Button } = components;
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
    } catch {
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

export interface HelpModuleProps {
  faqUrl?: string;
  supportUrl?: string;
  components: {
    BlockStack: any;
    View: any;
    Text: any;
    Link: any;
  };
}

export function HelpModule({ 
  faqUrl, 
  supportUrl,
  components
}: HelpModuleProps) {
  const { BlockStack, View, Text, Link } = components;
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
