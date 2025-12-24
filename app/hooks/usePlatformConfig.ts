/**
 * Platform Configuration Hook
 *
 * Manages platform configuration state with optimistic updates.
 */

import { useState, useCallback } from "react";
import { useFetcher } from "@remix-run/react";

// =============================================================================
// Types
// =============================================================================

export interface PlatformConfig {
  id: string;
  platform: "google" | "meta" | "tiktok";
  platformId: string | null;
  isActive: boolean;
  clientSideEnabled: boolean;
  serverSideEnabled: boolean;
  migrationStatus: "not_started" | "in_progress" | "completed";
  migratedAt: string | null;
  hasCredentials: boolean;
  lastVerifiedAt: string | null;
}

export interface CredentialsUpdate {
  platform: "google" | "meta" | "tiktok";
  credentials: Record<string, string>;
}

export interface ConfigUpdate {
  isActive?: boolean;
  serverSideEnabled?: boolean;
  clientSideEnabled?: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export interface UsePlatformConfigReturn {
  configs: PlatformConfig[];
  loading: boolean;
  error: string | null;
  saving: string | null; // Platform being saved
  updateCredentials: (platform: string, credentials: Record<string, string>) => Promise<boolean>;
  updateConfig: (platform: string, update: ConfigUpdate) => Promise<boolean>;
  verifyCredentials: (platform: string) => Promise<boolean>;
  deleteConfig: (platform: string) => Promise<boolean>;
  refresh: () => void;
}

/**
 * Hook for managing platform configurations.
 *
 * @example
 * ```tsx
 * function PlatformSettings() {
 *   const {
 *     configs,
 *     loading,
 *     saving,
 *     updateCredentials,
 *     updateConfig,
 *   } = usePlatformConfig(initialConfigs);
 *
 *   const handleSave = async (platform: string, credentials: Record<string, string>) => {
 *     const success = await updateCredentials(platform, credentials);
 *     if (success) {
 *       toast.success('保存成功');
 *     }
 *   };
 *
 *   return (
 *     <PlatformList
 *       configs={configs}
 *       onSave={handleSave}
 *       loading={saving}
 *     />
 *   );
 * }
 * ```
 */
export function usePlatformConfig(
  initialConfigs: PlatformConfig[]
): UsePlatformConfigReturn {
  const [configs, setConfigs] = useState<PlatformConfig[]>(initialConfigs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const fetcher = useFetcher();

  // Update credentials
  const updateCredentials = useCallback(
    async (platform: string, credentials: Record<string, string>): Promise<boolean> => {
      setSaving(platform);
      setError(null);

      try {
        const response = await fetch(`/app/settings/${platform}/credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credentials }),
        });

        const result = await response.json();

        if (!result.success) {
          setError(result.error || "保存失败");
          return false;
        }

        // Optimistic update - mark as having credentials
        setConfigs((prev) =>
          prev.map((c) =>
            c.platform === platform
              ? { ...c, hasCredentials: true, lastVerifiedAt: new Date().toISOString() }
              : c
          )
        );

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "网络错误");
        return false;
      } finally {
        setSaving(null);
      }
    },
    []
  );

  // Update config settings
  const updateConfig = useCallback(
    async (platform: string, update: ConfigUpdate): Promise<boolean> => {
      setSaving(platform);
      setError(null);

      // Optimistic update
      const previousConfigs = [...configs];
      setConfigs((prev) =>
        prev.map((c) =>
          c.platform === platform ? { ...c, ...update } : c
        )
      );

      try {
        const response = await fetch(`/app/settings/${platform}/config`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });

        const result = await response.json();

        if (!result.success) {
          // Rollback on failure
          setConfigs(previousConfigs);
          setError(result.error || "更新失败");
          return false;
        }

        return true;
      } catch (err) {
        // Rollback on error
        setConfigs(previousConfigs);
        setError(err instanceof Error ? err.message : "网络错误");
        return false;
      } finally {
        setSaving(null);
      }
    },
    [configs]
  );

  // Verify credentials
  const verifyCredentials = useCallback(
    async (platform: string): Promise<boolean> => {
      setSaving(platform);
      setError(null);

      try {
        const response = await fetch(`/app/settings/${platform}/verify`, {
          method: "POST",
        });

        const result = await response.json();

        if (!result.success) {
          setError(result.error || "验证失败");
          return false;
        }

        // Update last verified timestamp
        setConfigs((prev) =>
          prev.map((c) =>
            c.platform === platform
              ? { ...c, lastVerifiedAt: new Date().toISOString() }
              : c
          )
        );

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "网络错误");
        return false;
      } finally {
        setSaving(null);
      }
    },
    []
  );

  // Delete config
  const deleteConfig = useCallback(
    async (platform: string): Promise<boolean> => {
      setSaving(platform);
      setError(null);

      try {
        const response = await fetch(`/app/settings/${platform}`, {
          method: "DELETE",
        });

        const result = await response.json();

        if (!result.success) {
          setError(result.error || "删除失败");
          return false;
        }

        // Remove from list or mark as inactive
        setConfigs((prev) =>
          prev.map((c) =>
            c.platform === platform
              ? { ...c, isActive: false, hasCredentials: false }
              : c
          )
        );

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "网络错误");
        return false;
      } finally {
        setSaving(null);
      }
    },
    []
  );

  // Refresh configs
  const refresh = useCallback(() => {
    setLoading(true);
    fetcher.load("/app/settings?_data");
  }, [fetcher]);

  // Update from fetcher
  if (fetcher.data && fetcher.state === "idle" && loading) {
    setLoading(false);
    if ((fetcher.data as { configs?: PlatformConfig[] }).configs) {
      setConfigs((fetcher.data as { configs: PlatformConfig[] }).configs);
    }
  }

  return {
    configs,
    loading,
    error,
    saving,
    updateCredentials,
    updateConfig,
    verifyCredentials,
    deleteConfig,
    refresh,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get platform display name
 */
export function getPlatformDisplayName(platform: string): string {
  const names: Record<string, string> = {
    google: "GA4 (Measurement Protocol)",
    meta: "Meta (Facebook)",
    tiktok: "TikTok",
  };
  return names[platform] || platform;
}

/**
 * Get platform icon color
 */
export function getPlatformColor(platform: string): string {
  const colors: Record<string, string> = {
    google: "#4285F4",
    meta: "#1877F2",
    tiktok: "#000000",
  };
  return colors[platform] || "#666666";
}

/**
 * Check if platform has required credentials
 */
export function hasRequiredCredentials(
  platform: string,
  credentials: Record<string, string> | null
): boolean {
  if (!credentials) return false;

  switch (platform) {
    case "google":
      return !!(credentials.measurementId && credentials.apiSecret);
    case "meta":
      return !!(credentials.pixelId && credentials.accessToken);
    case "tiktok":
      return !!(credentials.pixelCode && credentials.accessToken);
    default:
      return false;
  }
}

