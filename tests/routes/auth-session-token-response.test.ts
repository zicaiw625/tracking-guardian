import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("auth session-token loader", () => {
  it("should preserve response returned by authenticate.admin", () => {
    const filePath = resolve(process.cwd(), "app/routes/auth.$.tsx");
    const source = readFileSync(filePath, "utf-8");

    expect(source).toContain("const authResult = await authenticate.admin(request);");
    expect(source).toContain("if (authResult instanceof Response)");
    expect(source).toContain("const headers = new Headers(authResult.headers);");
    expect(source).toContain("addDocumentResponseHeaders(request, headers);");
    expect(source).toContain("headers.delete(\"X-Frame-Options\");");
    expect(source).toContain("return new Response(authResult.body, {");
    expect(source).toContain("const shopifyReload = currentUrl.searchParams.get(\"shopify-reload\");");
    expect(source).toContain("process.env.SHOPIFY_APP_URL?.trim()");
    expect(source).toContain("allowedOrigins.has(targetUrl.origin)");
    expect(source).toContain("for (const key of [\"charge_id\", \"host\", \"shop\", \"embedded\"])");
    expect(source).toContain("return redirect(targetUrl.toString());");
  });
});
