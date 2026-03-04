import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("app billing embedded redirect flow", () => {
  it("should use authenticate.admin redirect with embedded parent target", () => {
    const filePath = resolve(process.cwd(), "app/routes/app.billing.tsx");
    const source = readFileSync(filePath, "utf-8");

    expect(source).toContain("const { session, admin, redirect } = await authenticate.admin(request);");
    expect(source).toContain("return redirect(result.confirmationUrl, { target: \"_parent\" });");
  });

  it("should include embedded returnUrl parameter and remove old client-side redirect flow", () => {
    const filePath = resolve(process.cwd(), "app/routes/app.billing.tsx");
    const source = readFileSync(filePath, "utf-8");

    expect(source).toContain("returnUrlObj.searchParams.set(\"embedded\", \"1\")");
    expect(source).not.toContain("Redirect.Action.REMOTE");
    expect(source).not.toContain("attemptedUpgradeRef");
    expect(source).not.toContain("url.searchParams.delete(\"upgrade\")");
  });
});
