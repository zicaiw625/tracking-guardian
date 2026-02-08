// @vitest-environment jsdom
import "../../../test/setup";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AppProvider } from "@shopify/polaris";
import enTranslations from "../../locales/en.json";
import { ManualPastePanel } from "./ManualPastePanel";
import type { ScriptCodeEditorProps } from "~/components/scan/ScriptCodeEditor";
import { useState } from "react";

function StubEditor({ value, onChange, onAnalyze, isAnalyzing }: ScriptCodeEditorProps) {
  return (
    <div>
      <textarea aria-label="脚本内容" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" onClick={onAnalyze} disabled={isAnalyzing}>
        分析脚本
      </button>
    </div>
  );
}

function Harness({
  initialValue = "",
  onAnalyze,
}: {
  initialValue?: string;
  onAnalyze: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <ManualPastePanel
      value={value}
      onChange={setValue}
      onAnalyze={onAnalyze}
      analysisResult={null}
      isAnalyzing={false}
      scriptCodeEditor={StubEditor}
    />
  );
}

describe("ManualPastePanel", () => {
  it("blocks analysis when PII is detected", async () => {
    const onAnalyze = () => {};
    const spy = vi.fn(onAnalyze);
    render(
      <AppProvider i18n={enTranslations as any}>
        <Harness onAnalyze={spy} />
      </AppProvider>
    );

    const textarea = screen.getByLabelText("脚本内容");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "<script>var access_token='EAABsbCS1iHg12345678901234567890';</script>" } });
    });

    expect(screen.getByText(/检测到敏感信息/)).toBeDefined();

    const analyzeButton = screen.getByRole("button", { name: "分析脚本" });
    await act(async () => {
      fireEvent.click(analyzeButton);
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("shows analysis results when no PII is detected", async () => {
    const onAnalyze = () => {};
    const spy = vi.fn(onAnalyze);
    render(
      <AppProvider i18n={enTranslations as any}>
        <Harness onAnalyze={spy} />
      </AppProvider>
    );

    const textarea = screen.getByLabelText("脚本内容");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "<script>fbq('init','PIXEL_ID');</script>" } });
    });

    const analyzeButton = screen.getByRole("button", { name: "分析脚本" });
    await act(async () => {
      fireEvent.click(analyzeButton);
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
