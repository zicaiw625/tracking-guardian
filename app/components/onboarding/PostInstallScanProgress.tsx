
import { useState, useEffect } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  ProgressBar,
  Spinner,
  Badge,
} from "@shopify/polaris";
import { useRevalidator } from "@remix-run/react";

interface PostInstallScanProgressProps {
  shopId: string;
  scanStartedAt: Date;
  onComplete?: () => void;
}

export function PostInstallScanProgress({
  shopId,
  scanStartedAt,
  onComplete,
}: PostInstallScanProgressProps) {
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [scanStatus, setScanStatus] = useState<"scanning" | "completed" | "error">("scanning");
  const revalidator = useRevalidator();

  const steps = [
    { label: "检查升级状态", duration: 2000 },
    { label: "扫描 ScriptTags", duration: 3000 },
    { label: "识别追踪平台", duration: 2000 },
    { label: "生成迁移清单", duration: 2000 },
  ];

  useEffect(() => {
    let accumulatedTime = 0;
    const totalDuration = steps.reduce((sum, step) => sum + step.duration, 0);
    let checkInterval: ReturnType<typeof setInterval> | null = null;
    let completionTimeout: ReturnType<typeof setTimeout> | null = null;
    let mainInterval: ReturnType<typeof setInterval> | null = null;
    let isMounted = true;

    mainInterval = setInterval(() => {
      if (!isMounted) {
        if (mainInterval) {
          clearInterval(mainInterval);
          mainInterval = null;
        }
        return;
      }

      accumulatedTime += 100;
      const newProgress = Math.min((accumulatedTime / totalDuration) * 100, 95);
      setProgress(newProgress);

      let stepAccumulated = 0;
      for (let i = 0; i < steps.length; i++) {
        stepAccumulated += steps[i].duration;
        if (accumulatedTime <= stepAccumulated) {
          setCurrentStep(i);
          break;
        }
      }

      if (accumulatedTime >= totalDuration) {
        if (mainInterval) {
          clearInterval(mainInterval);
          mainInterval = null;
        }

        if (isMounted) {
          checkInterval = setInterval(() => {
            if (!isMounted) {
              if (checkInterval) {
                clearInterval(checkInterval);
                checkInterval = null;
              }
              return;
            }
            revalidator.revalidate();
          }, 2000);

          completionTimeout = setTimeout(() => {
            if (!isMounted) return;
            if (checkInterval) {
              clearInterval(checkInterval);
              checkInterval = null;
            }
            if (isMounted) {
              setProgress(100);
              setScanStatus("completed");
              onComplete?.();
            }
          }, 15000);
        }
      }
    }, 100);

    return () => {
      isMounted = false;

      if (mainInterval) {
        clearInterval(mainInterval);
        mainInterval = null;
      }
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
      if (completionTimeout) {
        clearTimeout(completionTimeout);
        completionTimeout = null;
      }
    };
  }, [onComplete, revalidator]);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            🔍 正在进行升级体检
          </Text>
          <Badge tone="info">进行中</Badge>
        </InlineStack>

        <ProgressBar progress={progress} size="large" />

        <BlockStack gap="200">
          {steps.map((step, index) => (
            <InlineStack
              key={index}
              gap="300"
              blockAlign="center"
            >
              {index < currentStep ? (
                <Text as="span" tone="success">✓</Text>
              ) : index === currentStep ? (
                <Spinner size="small" />
              ) : (
                <Text as="span" tone="subdued">○</Text>
              )}
              <Text
                as="span"
                variant="bodySm"
                tone={index <= currentStep ? undefined : "subdued"}
                fontWeight={index === currentStep ? "semibold" : undefined}
              >
                {step.label}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>

        <Text as="p" variant="bodySm" tone="subdued">
          预计耗时约 10 秒，请稍候...
        </Text>
      </BlockStack>
    </Card>
  );
}

