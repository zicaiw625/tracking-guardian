/**
 * Request Validation Utilities
 *
 * BACKWARDS COMPATIBILITY LAYER
 * =============================
 * 
 * This file provides backwards compatibility for existing imports.
 * 
 * RECOMMENDED:
 *   import { validateJsonBody, withValidation } from "~/utils/validation"
 * 
 * LEGACY (still works):
 *   import { validateJsonBody } from "~/utils/validate-request"
 * 
 * @see app/utils/validation/index.ts for the canonical implementation
 * @deprecated Prefer importing from "~/utils/validation" directly
 */

// Re-export everything from the unified validation module
export {
  // Types
  type ValidateResult,
  type ValidationResult,
  type ValidationError,
  type ValidationErrorDetail,

  // Core validation functions
  validateJsonBody,
  requireValidJsonBody,
  validateFormData,
  requireValidFormData,
  validateQueryParams,
  requireValidQueryParams,

  // Formatters
  formatZodErrorsToRecord as formatZodErrors,
  getFirstZodError,

  // Middleware
  createSimpleValidationErrorResponse as validationErrorResponse,
  withValidationHandler as withValidation,
} from "./validation";
