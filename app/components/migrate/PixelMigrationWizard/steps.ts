export type WizardStep = "select" | "credentials" | "mappings" | "review" | "testing";

export interface StepDefinition {
  id: WizardStep;
  label: string;
  number: number;
  description: string;
  estimatedTime: string;
}

export const WIZARD_STEPS: StepDefinition[] = [
  {
    id: "select",
    label: "Select Platforms",
    number: 1,
    description: "Choose the advertising platforms to migrate",
    estimatedTime: "1 min",
  },
  {
    id: "credentials",
    label: "Enter Credentials",
    number: 2,
    description: "Provide API credentials for each platform",
    estimatedTime: "3-5 min",
  },
  {
    id: "mappings",
    label: "Event Mapping",
    number: 3,
    description: "Standard event mapping + parameter completeness checks (Shopify events -> platform events)",
    estimatedTime: "2-3 min",
  },
  {
    id: "review",
    label: "Review Configuration",
    number: 4,
    description: "Review and confirm all configuration details",
    estimatedTime: "1-2 min",
  },
  {
    id: "testing",
    label: "Test Verification",
    number: 5,
    description: "Validate configuration in a test environment + download payload evidence",
    estimatedTime: "2-3 min",
  },
];
