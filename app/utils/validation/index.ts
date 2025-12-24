/**
 * Validation Module
 *
 * Unified validation utilities for the entire application.
 * This module consolidates validation logic from:
 * - app/middleware/validation.ts (Remix middleware style)
 * - app/utils/validate-request.ts (utility function style)
 *
 * Both modules now re-export from here to avoid duplication.
 */

export * from "./core";
export * from "./formatters";
export * from "./middleware";
export * from "./helpers";

