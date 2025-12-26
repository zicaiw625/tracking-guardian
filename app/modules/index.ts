/**
 * Modules Entry Point
 *
 * P2-1: Modular architecture for better code organization.
 * Each module is self-contained with clear boundaries.
 *
 * Module Structure:
 * - shopify/     - Shopify API client, auth, scopes
 * - alerts/      - Notification channels (email, slack, telegram)
 * - scan/        - Script scanning and analysis
 * - conversions/ - CAPI job processing and platform adapters
 * - ingest/      - Pixel event ingestion and validation
 * - upgrade/     - Checkout upgrade guidance and deprecation dates
 * - reconciliation/ - Receipt matching and delivery health
 */

// Re-export all modules for convenient access
export * from "./shopify";
export * from "./alerts";
export * from "./scan";
export * from "./conversions";
export * from "./ingest";
export * from "./upgrade";
export * from "./reconciliation";

