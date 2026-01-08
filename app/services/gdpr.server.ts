export type {
  GDPRJobType,
  DataRequestPayload,
  CustomerRedactPayload,
  ShopRedactPayload,
  DataRequestResult,
  CustomerRedactResult,
  ShopRedactResult,
  GDPRComplianceResult,
  GDPRDeletionSummary,
} from "./gdpr";

export {
  processGDPRJob,
  processGDPRJobs,
  getGDPRJobStatus,
} from "./gdpr";

export {
  checkGDPRCompliance,
  getGDPRDeletionSummary,
} from "./gdpr";
