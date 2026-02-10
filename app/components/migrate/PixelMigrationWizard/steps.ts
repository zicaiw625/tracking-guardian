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
    label: "Select Platform",
    number: 1,
    description: "Choose platforms to migrate",
    estimatedTime: "1 min",
  },
  {
    id: "credentials",
    label: "Credentials",
    number: 2,
    description: "Enter API credentials",
    estimatedTime: "3-5 min",
  },
  {
    id: "mappings",
    label: "Event Mappings",
    number: 3,
    description: "Standard event mapping + completeness check",
    estimatedTime: "2-3 min",
  },
  {
    id: "review",
    label: "Review",
    number: 4,
    description: "Review configuration",
    estimatedTime: "1-2 min",
  },
  {
    id: "testing",
    label: "Testing",
    number: 5,
    description: "Verify in test environment",
    estimatedTime: "2-3 min",
  },
];
