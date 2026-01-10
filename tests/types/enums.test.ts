import { describe, it, expect } from "vitest";
import {
  JobStatus,
  SignatureStatus,
  TrustLevel,
  Platform,
  ConsentStrategy,
  GDPRJobStatus,
} from "../../app/types/enums";

describe("JobStatus", () => {
  it("should have all expected statuses", () => {
    expect(JobStatus.QUEUED).toBe("queued");
    expect(JobStatus.PROCESSING).toBe("processing");
    expect(JobStatus.COMPLETED).toBe("completed");
    expect(JobStatus.FAILED).toBe("failed");
    expect(JobStatus.LIMIT_EXCEEDED).toBe("limit_exceeded");
    expect(JobStatus.DEAD_LETTER).toBe("dead_letter");
  });
  it("should be usable in switch statements", () => {
    const status = JobStatus.COMPLETED;
    let result = "";
    switch (status) {
      case JobStatus.QUEUED:
        result = "waiting";
        break;
      case JobStatus.PROCESSING:
        result = "working";
        break;
      case JobStatus.COMPLETED:
        result = "done";
        break;
      case JobStatus.FAILED:
        result = "error";
        break;
      default:
        result = "unknown";
    }
    expect(result).toBe("done");
  });
});

describe("SignatureStatus", () => {
  it("should have expected statuses", () => {
    expect(SignatureStatus.KEY_MATCHED).toBe("key_matched");
    expect(SignatureStatus.SIGNED).toBe("signed");
    expect(SignatureStatus.UNSIGNED).toBe("unsigned");
    expect(SignatureStatus.INVALID).toBe("invalid");
  });
});

describe("TrustLevel", () => {
  it("should have all expected levels", () => {
    expect(TrustLevel.TRUSTED).toBe("trusted");
    expect(TrustLevel.PARTIAL).toBe("partial");
    expect(TrustLevel.UNTRUSTED).toBe("untrusted");
    expect(TrustLevel.UNKNOWN).toBe("unknown");
  });
  it("should support comparison logic", () => {
    const trustLevels = [TrustLevel.UNTRUSTED, TrustLevel.PARTIAL, TrustLevel.TRUSTED];
    expect(new Set(trustLevels).size).toBe(3);
  });
});

describe("Platform", () => {
  it("should have all supported platforms", () => {
    expect(Platform.GOOGLE).toBe("google");
    expect(Platform.META).toBe("meta");
    expect(Platform.TIKTOK).toBe("tiktok");
  });
  it("should be usable for platform iteration", () => {
    const platforms = [Platform.GOOGLE, Platform.META, Platform.TIKTOK];
    expect(platforms).toHaveLength(3);
    expect(platforms).toContain("google");
    expect(platforms).toContain("meta");
    expect(platforms).toContain("tiktok");
  });
});

describe("ConsentStrategy", () => {
  it("should have all strategies", () => {
    expect(ConsentStrategy.STRICT).toBe("strict");
    expect(ConsentStrategy.BALANCED).toBe("balanced");
    expect(ConsentStrategy.WEAK).toBe("weak");
  });
});

describe("GDPRJobStatus", () => {
  it("should have all GDPR job statuses", () => {
    expect(GDPRJobStatus.QUEUED).toBe("queued");
    expect(GDPRJobStatus.PROCESSING).toBe("processing");
    expect(GDPRJobStatus.COMPLETED).toBe("completed");
    expect(GDPRJobStatus.FAILED).toBe("failed");
  });
});
