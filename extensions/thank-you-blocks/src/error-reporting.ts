import { getValidatedBackendUrl, isDevMode } from "./config";

export interface ErrorReport {
  extension: string;
  endpoint: string;
  error: string;
  stack?: string | null;
  target: string;
  timestamp: string;
  orderId?: string | null;
}

export async function reportExtensionError(
  api: { sessionToken: { get: () => Promise<string> } },
  errorReport: ErrorReport
): Promise<void> {
  try {
    const backendUrl = getValidatedBackendUrl();
    if (!backendUrl) {
      return;
    }
    const token = await api.sessionToken.get().catch(() => null);
    if (!token) {
      return;
    }
    await fetch(`${backendUrl}/api/extension-errors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(errorReport),
    }).catch((reportErr) => {
      if (isDevMode()) {
        console.error(`[${errorReport.extension}] Failed to report error to backend:`, reportErr);
      }
    });
  } catch (reportError) {
    if (isDevMode()) {
      console.error(`[${errorReport.extension}] Failed to report error:`, reportError);
    }
  }
}
