/**
 * P0-T7: checkout_completed 已知行为的产品内提示组件
 * 
 * 根据 Shopify 官方文档，checkout_completed 事件有以下已知行为：
 * 1. 有 upsell 时，在第一个 upsell 页触发且 Thank you 不再触发
 * 2. 若应触发页面加载失败则不触发
 * 3. 同意/隐私导致数据被过滤
 */

import { Banner, BlockStack, Text, List, Collapsible } from "@shopify/polaris";
import { useState } from "react";
import { AlertCircleIcon, InfoIcon } from "~/components/icons";

export interface CheckoutCompletedBehaviorHintProps {
  /**
   * 显示模式
   * - "missing": 事件缺失时的提示
   * - "drop": 事件量骤降告警时的提示
   * - "info": 一般信息提示
   */
  mode?: "missing" | "drop" | "info";
  /**
   * 是否可折叠（默认 true）
   */
  collapsible?: boolean;
  /**
   * 自定义标题
   */
  title?: string;
}

export function CheckoutCompletedBehaviorHint({
  mode = "info",
  collapsible = true,
  title,
}: CheckoutCompletedBehaviorHintProps) {
  const [expanded, setExpanded] = useState(!collapsible);

  const tone = mode === "missing" ? "warning" : mode === "drop" ? "critical" : "info";
  const icon = mode === "missing" || mode === "drop" ? AlertCircleIcon : InfoIcon;

  const defaultTitle = mode === "missing"
    ? "checkout_completed 事件缺失的可能原因"
    : mode === "drop"
    ? "checkout_completed 事件量骤降的可能原因"
    : "checkout_completed 事件的已知行为";

  const displayTitle = title || defaultTitle;

  const content = (
    <BlockStack gap="200">
      <Text as="p" variant="bodySm">
        <strong>checkout_completed</strong> 事件可能因以下 Shopify 平台行为而缺失或减少：
      </Text>
      <List type="bullet">
        <List.Item>
          <Text as="span" variant="bodySm">
            <strong>Upsell/Post-purchase 导致触发位置改变：</strong>
            当存在 upsell 或 post-purchase offer 时，事件会在第一个 upsell 页面触发，
            且不会在 Thank you 页面再次触发。这是 Shopify 的预期行为。
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm">
            <strong>页面未完全加载/用户快速离开：</strong>
            如果应触发事件的页面加载失败或用户快速离开页面，事件可能不会触发。
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm">
            <strong>同意/隐私导致数据被过滤：</strong>
            在需要用户同意的地区，如果用户未同意 analytics consent，
            事件可能不会触发或数据会被过滤（PII 字段为 null）。
          </Text>
        </List.Item>
      </List>
      <Text as="p" variant="bodySm" tone="subdued">
        💡 <strong>建议排查步骤：</strong>
      </Text>
      <List type="bullet">
        <List.Item>
          <Text as="span" variant="bodySm" tone="subdued">
            检查是否启用了 upsell/post-purchase offer（Shopify Admin → Settings → Checkout）
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm" tone="subdued">
            v1.0 版本：仅依赖 Web Pixels 标准事件（checkout_completed），不处理订单 webhooks
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm" tone="subdued">
            检查 Verification 页面中的实时事件监控，查看是否有其他事件类型正常触发
          </Text>
        </List.Item>
        <List.Item>
          <Text as="span" variant="bodySm" tone="subdued">
            如果启用了 Protected Customer Data (PCD)，确认已正确配置权限和披露
          </Text>
        </List.Item>
      </List>
    </BlockStack>
  );

  if (!collapsible) {
    return (
      <Banner tone={tone} icon={icon} title={displayTitle}>
        {content}
      </Banner>
    );
  }

  return (
    <Banner tone={tone} icon={icon}>
      <BlockStack gap="200">
        <Text
          as="button"
          variant="bodySm"
          fontWeight="semibold"
          onClick={() => setExpanded(!expanded)}
          style={{
            cursor: "pointer",
            textAlign: "left",
            background: "none",
            border: "none",
            padding: 0,
            color: "inherit",
          }}
        >
          {displayTitle} {expanded ? "▼" : "▶"}
        </Text>
        <Collapsible open={expanded} id="checkout-completed-hint">
          {content}
        </Collapsible>
      </BlockStack>
    </Banner>
  );
}

