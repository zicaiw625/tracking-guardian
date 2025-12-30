import { useState, useCallback } from "react";
import {
  BlockStack,
  InlineStack,
  Text,
  Checkbox,
  TextField,
  Select,
  FormLayout,
  Tag,
  Box,
  Banner,
  Button,
} from "@shopify/polaris";
import type { DisplayRules } from "~/types/ui-extension";

export interface DisplayRulesEditorProps {
  displayRules: DisplayRules;
  onChange: (rules: DisplayRules) => void;
  moduleKey: string;
}

const COMMON_COUNTRIES = [
  { value: "US", label: "美国" },
  { value: "CA", label: "加拿大" },
  { value: "GB", label: "英国" },
  { value: "AU", label: "澳大利亚" },
  { value: "DE", label: "德国" },
  { value: "FR", label: "法国" },
  { value: "JP", label: "日本" },
  { value: "CN", label: "中国" },
  { value: "KR", label: "韩国" },
  { value: "SG", label: "新加坡" },
  { value: "HK", label: "香港" },
  { value: "TW", label: "台湾" },
];

export function DisplayRulesEditor({
  displayRules,
  onChange,
  moduleKey,
}: DisplayRulesEditorProps) {
  const [customerTagInput, setCustomerTagInput] = useState("");

  const handleTargetToggle = useCallback(
    (target: "thank_you" | "order_status", checked: boolean) => {
      const currentTargets = displayRules.targets || [];
      if (checked) {
        onChange({
          ...displayRules,
          targets: [...currentTargets, target],
        });
      } else {
        onChange({
          ...displayRules,
          targets: currentTargets.filter((t) => t !== target),
        });
      }
    },
    [displayRules, onChange]
  );

  const handleMinOrderValueChange = useCallback(
    (value: string) => {
      const numValue = value ? parseFloat(value) : undefined;
      onChange({
        ...displayRules,
        conditions: {
          ...displayRules.conditions,
          minOrderValue: numValue && !isNaN(numValue) ? numValue : undefined,
        },
      });
    },
    [displayRules, onChange]
  );

  const handleAddCustomerTag = useCallback(() => {
    const tag = customerTagInput.trim();
    if (!tag) return;

    const currentTags = displayRules.conditions?.customerTags || [];
    if (!currentTags.includes(tag)) {
      onChange({
        ...displayRules,
        conditions: {
          ...displayRules.conditions,
          customerTags: [...currentTags, tag],
        },
      });
      setCustomerTagInput("");
    }
  }, [customerTagInput, displayRules, onChange]);

  const handleRemoveCustomerTag = useCallback(
    (tag: string) => {
      const currentTags = displayRules.conditions?.customerTags || [];
      onChange({
        ...displayRules,
        conditions: {
          ...displayRules.conditions,
          customerTags: currentTags.filter((t) => t !== tag),
        },
      });
    },
    [displayRules, onChange]
  );

  const handleCountryToggle = useCallback(
    (country: string, checked: boolean) => {
      const currentCountries = displayRules.conditions?.countries || [];
      if (checked) {
        onChange({
          ...displayRules,
          conditions: {
            ...displayRules.conditions,
            countries: [...currentCountries, country],
          },
        });
      } else {
        onChange({
          ...displayRules,
          conditions: {
            ...displayRules.conditions,
            countries: currentCountries.filter((c) => c !== country),
          },
        });
      }
    },
    [displayRules, onChange]
  );

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        <Text as="p" variant="bodySm">
          配置模块在哪些页面显示，以及显示的条件。如果不设置条件，模块将在所有符合条件的页面显示。
        </Text>
      </Banner>

      <FormLayout>
        <FormLayout.Group>
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              显示目标
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              选择模块要显示的页面
            </Text>
            <BlockStack gap="200">
              <Checkbox
                label="Thank You 页面"
                checked={displayRules.targets?.includes("thank_you") || false}
                onChange={(checked) => handleTargetToggle("thank_you", checked)}
                helpText="订单完成后的感谢页面"
              />
              <Checkbox
                label="Order Status 页面"
                checked={displayRules.targets?.includes("order_status") || false}
                onChange={(checked) => handleTargetToggle("order_status", checked)}
                helpText="订单状态查询页面"
              />
            </BlockStack>
          </BlockStack>
        </FormLayout.Group>

        <FormLayout.Group>
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              显示条件（可选）
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              设置模块显示的条件，只有满足条件的订单才会显示此模块
            </Text>

            <TextField
              label="最小订单金额"
              type="number"
              value={
                displayRules.conditions?.minOrderValue
                  ? String(displayRules.conditions.minOrderValue)
                  : ""
              }
              onChange={handleMinOrderValueChange}
              prefix="¥"
              helpText="只有订单金额大于等于此值时，模块才会显示"
              placeholder="0"
            />
          </BlockStack>
        </FormLayout.Group>

        <FormLayout.Group>
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              客户标签筛选（可选）
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              只有拥有指定标签的客户才会看到此模块
            </Text>
            <InlineStack gap="200" blockAlign="end">
              <Box minWidth="300px">
                <TextField
                  label="添加客户标签"
                  value={customerTagInput}
                  onChange={setCustomerTagInput}
                  onKeyPress={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustomerTag();
                    }
                  }}
                  placeholder="VIP"
                  helpText="输入标签名称后按 Enter 添加"
                />
              </Box>
              <Button onClick={handleAddCustomerTag} disabled={!customerTagInput.trim()}>
                添加
              </Button>
            </InlineStack>
            {displayRules.conditions?.customerTags &&
              displayRules.conditions.customerTags.length > 0 && (
                <Box paddingBlockStart="200">
                  <InlineStack gap="100" wrap>
                    {displayRules.conditions.customerTags.map((tag) => (
                      <Tag key={tag} onRemove={() => handleRemoveCustomerTag(tag)}>
                        {tag}
                      </Tag>
                    ))}
                  </InlineStack>
                </Box>
              )}
          </BlockStack>
        </FormLayout.Group>

        <FormLayout.Group>
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              国家/地区筛选（可选）
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              只有来自指定国家/地区的订单才会显示此模块
            </Text>
            <Box maxHeight="200px" overflowY="auto" padding="300" background="bg-surface-secondary" borderRadius="200">
              <BlockStack gap="200">
                {COMMON_COUNTRIES.map((country) => (
                  <Checkbox
                    key={country.value}
                    label={country.label}
                    checked={
                      displayRules.conditions?.countries?.includes(country.value) || false
                    }
                    onChange={(checked) => handleCountryToggle(country.value, checked)}
                  />
                ))}
              </BlockStack>
            </Box>
            {displayRules.conditions?.countries &&
              displayRules.conditions.countries.length > 0 && (
                <Box paddingBlockStart="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    已选择 {displayRules.conditions.countries.length} 个国家/地区
                  </Text>
                </Box>
              )}
          </BlockStack>
        </FormLayout.Group>
      </FormLayout>
    </BlockStack>
  );
}

