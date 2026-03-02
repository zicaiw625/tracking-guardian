import { describe, expect, it } from "vitest";
import { headers as verificationShareHeaders } from "../../app/routes/r.$token";
import { headers as scanShareHeaders } from "../../app/routes/s.$token";

describe("share route headers", () => {
  it("inherits cache and robots headers for verification share page", () => {
    const loaderHeaders = new Headers({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "X-Robots-Tag": "noindex, nofollow",
    });
    const result = verificationShareHeaders({ loaderHeaders } as any);
    expect(result["Cache-Control"]).toContain("no-store");
    expect(result["X-Robots-Tag"]).toBe("noindex, nofollow");
  });

  it("inherits cache and robots headers for scan share page", () => {
    const loaderHeaders = new Headers({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "X-Robots-Tag": "noindex, nofollow",
    });
    const result = scanShareHeaders({ loaderHeaders } as any);
    expect(result["Cache-Control"]).toContain("no-store");
    expect(result["X-Robots-Tag"]).toBe("noindex, nofollow");
  });
});
