# Internationalization (i18n) Implementation Plan

I have implemented a comprehensive Internationalization (i18n) system to switch the application's primary language to English while retaining Chinese support via a toggle.

## 1. Core Infrastructure
- **Dependencies**: Installed `i18next`, `react-i18next`, `i18next-browser-languagedetector`, and `i18next-http-backend`.
- **Configuration**: Created `app/i18n.ts` for i18n setup and `app/entry.client.tsx` to initialize it on the client side.
- **Locales**: Created `app/locales/en.json` (English) and `app/locales/zh.json` (Chinese) with extracted strings.

## 2. UI Components
- **Language Switcher**: Created `app/components/LanguageSwitcher.tsx` using a Popover and ActionList.
- **Icons**: Added `GlobeIcon` to `app/components/icons.tsx` for the language switcher.
- **TopBar**: Integrated the `LanguageSwitcher` into `app/components/layout/TopBar.tsx` and translated "Help" and "Documentation" links.

## 3. Page & Layout Refactoring
- **Root Layout (`root.tsx`)**: Changed default HTML language to `en` and translated error boundary messages to English.
- **Navigation (`app.routes/app.tsx`)**: Translated all side navigation menu items (Dashboard, Audit, Pixels, etc.).
- **Dashboard (`app.routes/app._index.tsx`)**: Refactored the main dashboard page to use translation keys for titles, subtitles, and banners.
- **Banners**: Refactored `ScriptTagMigrationBanner` and `MigrationDeadlineBanner` to use `useTranslation` and moved their extensive Chinese text into locale files.

## 4. Default Language
- The application now defaults to **English**.
- Users can switch back to Chinese using the globe icon in the top right corner.
- User preference is persisted via `localStorage`.

## Verification
- **Build**: Verified `resolveJsonModule` is enabled in `tsconfig.json`.
- **Code Structure**: Consistent use of `useTranslation` hook across refactored components.
- **Missing Translations**: Identified ~100 files with Chinese characters; prioritized the main layout and dashboard for this iteration. Future work can incrementally address the remaining files.
