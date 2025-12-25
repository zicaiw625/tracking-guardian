Based on the code review report and codebase analysis, I have identified two high-priority issues to address:

### 1. Security: Enforce HASH_SALT in Production
The current implementation of `hashForStorage` in `app/utils/security.ts` falls back to a default salt if `HASH_SALT` is missing. This is insecure for production environments.

**Plan:**
- Modify `app/utils/security.ts`.
- In `hashForStorage`, check if `process.env.HASH_SALT` is defined.
- If undefined and `process.env.NODE_ENV === 'production'`, throw a critical security error.
- Ensure the application fails fast if security configuration is missing.

### 2. UX/Stability: Add Global Error Boundary
The application lacks a global Error Boundary in `app/root.tsx`. Uncaught errors will result in a white screen or a broken UI for the user.

**Plan:**
- Modify `app/root.tsx`.
- Import `useRouteError`, `isRouteErrorResponse` from `@remix-run/react`.
- Import the existing `ErrorDisplay` component from `app/components/ui/ErrorDisplay`.
- Implement and export an `ErrorBoundary` component that catches both 404s (Route Error Responses) and unexpected 500 errors.
- Display a user-friendly error message with options to retry or navigate home.
