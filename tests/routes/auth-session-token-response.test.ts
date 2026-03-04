import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("auth session-token loader", () => {
  it("should preserve response returned by authenticate.admin", () => {
    const filePath = resolve(process.cwd(), "app/routes/auth.$.tsx");
    const source = readFileSync(filePath, "utf-8");

    expect(source).toContain("const authResult = await authenticate.admin(request);");
    expect(source).toContain("if (authResult instanceof Response)");
    expect(source).toContain("return authResult;");
    expect(source).toContain("const shopifyReload = currentUrl.searchParams.get(\"shopify-reload\");");
    expect(source).toContain("return redirect(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);");
  });
});
