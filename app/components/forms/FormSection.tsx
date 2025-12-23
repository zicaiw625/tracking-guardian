/**
 * FormSection Component
 *
 * A container for grouping related form fields with a title and description.
 */

import { BlockStack, Text, Divider, Box } from "@shopify/polaris";
import type { ReactNode } from "react";

export interface FormSectionProps {
  /**
   * Section title
   */
  title: string;

  /**
   * Optional section description
   */
  description?: string;

  /**
   * Whether to show a divider before the section
   */
  showDivider?: boolean;

  /**
   * Children to render inside the section
   */
  children: ReactNode;
}

export function FormSection({
  title,
  description,
  showDivider = false,
  children,
}: FormSectionProps) {
  return (
    <BlockStack gap="300">
      {showDivider && <Divider />}

      <BlockStack gap="100">
        <Text as="h3" variant="headingMd">
          {title}
        </Text>
        {description && (
          <Text as="p" variant="bodySm" tone="subdued">
            {description}
          </Text>
        )}
      </BlockStack>

      <Box>{children}</Box>
    </BlockStack>
  );
}

export default FormSection;

