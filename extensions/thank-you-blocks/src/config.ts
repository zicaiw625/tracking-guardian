import { BACKEND_URL, isAllowedBackendUrl } from "../../shared/config";

export function getValidatedBackendUrl(): string | null {
  if (!BACKEND_URL) {
    return null;
  }
  if (!isAllowedBackendUrl(BACKEND_URL)) {
    return null;
  }
  return BACKEND_URL;
}
