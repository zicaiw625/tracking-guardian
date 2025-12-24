/**
 * Request Validation Utilities
 *
 * Re-exports from the unified validation module.
 * This file is kept for backward compatibility.
 *
 * @see app/utils/validation/index.ts for the canonical implementation
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
