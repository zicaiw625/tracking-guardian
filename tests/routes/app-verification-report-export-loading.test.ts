import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("verification report export loading state", () => {
  it("derives exporting state from navigation form action", () => {
    const filePath = resolve(process.cwd(), "app/routes/app.verification.report.$runId.tsx");
    const source = readFileSync(filePath, "utf-8");

    expect(source).toContain("const navigation = useNavigation()");
    expect(source).toContain("navigation.formData?.get(\"_action\") === \"export_csv\"");
    expect(source).not.toContain("setTimeout(() => setIsExporting(false), 2000)");
  });
});
