export interface SecurityViolation {
  type: "fatal" | "warning";
  message: string;
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  missingRequired: string[];
  missingRecommended: string[];
}
