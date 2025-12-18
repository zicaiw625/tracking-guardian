import {
  reactExtension,
  BlockStack,
  Text,
  Button,
  InlineLayout,
  View,
  Pressable,
  Icon,
  useSettings,
  useOrder,
  useAppMetafields,
} from "@shopify/ui-extensions-react/checkout";
import { useState } from "react";

export default reactExtension(
  "purchase.thank-you.block.render",
  () => <Survey />
);

function Survey() {
  const settings = useSettings();
  const order = useOrder();
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);

  const title = settings.survey_title || "我们想听听您的意见";
  const question = settings.survey_question || "您是如何了解到我们的？";

  const sources = [
    { id: "search", label: "搜索引擎" },
    { id: "social", label: "社交媒体" },
    { id: "friend", label: "朋友推荐" },
    { id: "ad", label: "广告" },
    { id: "other", label: "其他" },
  ];

  const handleSubmit = async () => {
    if (selectedRating === null && selectedSource === null) return;

    // In production, this would send data to your backend
    console.log("Survey submitted:", {
      orderId: order?.id,
      rating: selectedRating,
      source: selectedSource,
    });

    setSubmitted(true);
  };

  if (submitted) {
    return (
      <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
        <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
          <Text size="medium" emphasis="bold">
            感谢您的反馈！
          </Text>
          <Icon source="checkmark" appearance="accent" />
        </InlineLayout>
        <Text size="small" appearance="subdued">
          您的意见对我们非常重要，我们会不断改进服务。
        </Text>
      </BlockStack>
    );
  }

  return (
    <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
      <Text size="medium" emphasis="bold">
        {title}
      </Text>

      {/* Star Rating */}
      <BlockStack spacing="tight">
        <Text size="small">请为本次购物体验打分：</Text>
        <InlineLayout spacing="tight" columns={["auto", "auto", "auto", "auto", "auto"]}>
          {[1, 2, 3, 4, 5].map((rating) => (
            <Pressable key={rating} onPress={() => setSelectedRating(rating)}>
              <View
                padding="extraTight"
                cornerRadius="base"
                background={selectedRating && selectedRating >= rating ? "accent" : "transparent"}
              >
                <Text size="large">
                  {selectedRating && selectedRating >= rating ? "★" : "☆"}
                </Text>
              </View>
            </Pressable>
          ))}
        </InlineLayout>
      </BlockStack>

      {/* Source Question */}
      <BlockStack spacing="tight">
        <Text size="small">{question}</Text>
        <InlineLayout spacing="tight" columns={["auto", "auto", "auto"]}>
          {sources.slice(0, 3).map((source) => (
            <Pressable key={source.id} onPress={() => setSelectedSource(source.id)}>
              <View
                padding="tight"
                cornerRadius="base"
                border={selectedSource === source.id ? "accent" : "base"}
                background={selectedSource === source.id ? "accent" : "transparent"}
              >
                <Text size="small">{source.label}</Text>
              </View>
            </Pressable>
          ))}
        </InlineLayout>
        <InlineLayout spacing="tight" columns={["auto", "auto"]}>
          {sources.slice(3).map((source) => (
            <Pressable key={source.id} onPress={() => setSelectedSource(source.id)}>
              <View
                padding="tight"
                cornerRadius="base"
                border={selectedSource === source.id ? "accent" : "base"}
                background={selectedSource === source.id ? "accent" : "transparent"}
              >
                <Text size="small">{source.label}</Text>
              </View>
            </Pressable>
          ))}
        </InlineLayout>
      </BlockStack>

      <Button
        kind="secondary"
        onPress={handleSubmit}
        disabled={selectedRating === null && selectedSource === null}
      >
        提交反馈
      </Button>
    </BlockStack>
  );
}

