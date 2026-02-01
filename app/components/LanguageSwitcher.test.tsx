// @vitest-environment jsdom
import "../../test/setup";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { AppProvider } from "@shopify/polaris";
import enTranslations from "../locales/en.json";

// Mock Polaris Popover to bypass portal/positioning logic
vi.mock("@shopify/polaris", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    Popover: ({ children, activator, active }: any) => (
      <div>
        {activator}
        {active && <div data-testid="popover-content">{children}</div>}
      </div>
    ),
  };
});

// Mock react-i18next
const changeLanguageMock = vi.fn();
const useTranslationMock = vi.fn(() => ({
  t: (key: string) => key,
  i18n: {
    language: "en",
    changeLanguage: changeLanguageMock,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => useTranslationMock(),
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
}));

// Mock Shopify Polaris icons
vi.mock("~/components/icons", () => ({
  GlobeIcon: () => <svg data-testid="globe-icon" />,
}));

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the current language (English)", () => {
    useTranslationMock.mockReturnValue({
      t: (key: string) => key,
      i18n: {
        language: "en",
        changeLanguage: changeLanguageMock,
      },
    });

    render(
      <AppProvider i18n={enTranslations as any}>
        <LanguageSwitcher />
      </AppProvider>
    );

    expect(screen.getByText("English")).toBeDefined();
  });

  it("renders the current language (Chinese)", () => {
    useTranslationMock.mockReturnValue({
      t: (key: string) => key,
      i18n: {
        language: "zh",
        changeLanguage: changeLanguageMock,
      },
    });

    render(
      <AppProvider i18n={enTranslations as any}>
        <LanguageSwitcher />
      </AppProvider>
    );

    expect(screen.getByText("中文")).toBeDefined();
  });

  it("opens popover and switches language to Chinese", async () => {
    useTranslationMock.mockReturnValue({
      t: (key: string) => key,
      i18n: {
        language: "en",
        changeLanguage: changeLanguageMock,
      },
    });

    render(
      <AppProvider i18n={enTranslations as any}>
        <LanguageSwitcher />
      </AppProvider>
    );

    // Click the button to open popover
    const button = screen.getByRole("button", { name: "English" });
    await act(async () => {
      fireEvent.click(button);
    });

    // Find the Chinese option
    // Note: Polaris ActionList items might not be direct buttons, but we can look for text
    const chineseOption = await waitFor(() => screen.getByText("中文"));
    expect(chineseOption).toBeDefined();

    // Click Chinese option
    await act(async () => {
      fireEvent.click(chineseOption);
    });

    expect(changeLanguageMock).toHaveBeenCalledWith("zh");
  });

  it("opens popover and switches language to English", async () => {
    useTranslationMock.mockReturnValue({
      t: (key: string) => key,
      i18n: {
        language: "zh",
        changeLanguage: changeLanguageMock,
      },
    });

    render(
      <AppProvider i18n={enTranslations as any}>
        <LanguageSwitcher />
      </AppProvider>
    );

    // Click the button to open popover
    const button = screen.getByRole("button", { name: "中文" });
    await act(async () => {
      fireEvent.click(button);
    });

    // Find the English option
    const englishOption = await waitFor(() => screen.getByText("English"));
    expect(englishOption).toBeDefined();

    // Click English option
    await act(async () => {
      fireEvent.click(englishOption);
    });

    expect(changeLanguageMock).toHaveBeenCalledWith("en");
  });
});
