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
import { getValidatedBackendUrl } from "./config";

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
          setModuleState({
            surveyEnabled: false,
            helpEnabled: false,
          });
          setLoading(false);
          return;
        }
        const token = await api.sessionToken.get();
        const response = await fetch(`${backendUrl}/api/ui-modules-state`, {
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
          });
        }
      } catch (error) {
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
      const response = await fetch(`${backendUrl}/api/survey`, {
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
  return (
    <BlockStack spacing="base">
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
