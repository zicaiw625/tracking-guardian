import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("app billing embedded redirect flow", () => {
  it("should return confirmationUrl json for subscribe success", () => {
    const filePath = resolve(process.cwd(), "app/routes/app.billing.tsx");
    const source = readFileSync(filePath, "utf-8");

    expect(source).toContain("const { session, admin } = await authenticate.admin(request);");
    expect(source).toContain("actionType: \"subscribe\"");
    expect(source).toContain("confirmationUrl: result.confirmationUrl");
    expect(source).not.toContain("return redirect(result.confirmationUrl, { target: \"_parent\" });");
  });

  it("should include embedded returnUrl parameter and use app bridge remote redirect", () => {
    const filePath = resolve(process.cwd(), "app/routes/app.billing.tsx");
    const source = readFileSync(filePath, "utf-8");

    expect(source).toContain("returnUrlObj.searchParams.set(\"embedded\", \"1\")");
    expect(source).toContain("Redirect.Action.REMOTE");
    expect(source).not.toContain("attemptedUpgradeRef");
    expect(source).not.toContain("url.searchParams.delete(\"upgrade\")");
  });
});
