// @vitest-environment jsdom
import "../../test/setup";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { AppProvider } from "@shopify/polaris";
import enTranslations from "../locales/en.json";

const { submitMock, revalidateMock } = vi.hoisted(() => ({
  submitMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

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

vi.mock("@remix-run/react", async (importOriginal) => {
      const actual: any = await importOriginal();
      return {
        ...actual,
        useFetcher: () => ({
          submit: submitMock,
          state: "idle",
          data: { ok: true }
        }),
        useSubmit: () => submitMock,
        useRevalidator: () => ({
          revalidate: revalidateMock
        }),
      };
    });

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

    expect(screen.getByText("Chinese")).toBeDefined();
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

    const button = screen.getByRole("button", { name: "English" });
    await act(async () => {
      fireEvent.click(button);
    });

    const chineseOption = await waitFor(() => screen.getByText("Chinese"));
    expect(chineseOption).toBeDefined();

    await act(async () => {
      fireEvent.click(chineseOption);
    });

    expect(submitMock).toHaveBeenCalled();
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

    const button = screen.getByRole("button", { name: "Chinese" });
    await act(async () => {
      fireEvent.click(button);
    });

    const englishOption = await waitFor(() => screen.getByText("English"));
    expect(englishOption).toBeDefined();

    await act(async () => {
      fireEvent.click(englishOption);
    });

    expect(submitMock).toHaveBeenCalled();
    expect(changeLanguageMock).toHaveBeenCalledWith("en");
  });
});
