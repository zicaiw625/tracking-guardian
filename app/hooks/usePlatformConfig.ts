

import { useState, useCallback } from "react";
import { useFetcher } from "@remix-run/react";

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

export interface UsePlatformConfigReturn {
  configs: PlatformConfig[];
  loading: boolean;
  error: string | null;
  saving: string | null;
  updateCredentials: (platform: string, credentials: Record<string, string>) => Promise<boolean>;
  updateConfig: (platform: string, update: ConfigUpdate) => Promise<boolean>;
  verifyCredentials: (platform: string) => Promise<boolean>;
  deleteConfig: (platform: string) => Promise<boolean>;
  refresh: () => void;
}

export function usePlatformConfig(
  initialConfigs: PlatformConfig[]
): UsePlatformConfigReturn {
  const [configs, setConfigs] = useState<PlatformConfig[]>(initialConfigs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const fetcher = useFetcher();

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

  const updateConfig = useCallback(
    async (platform: string, update: ConfigUpdate): Promise<boolean> => {
      setSaving(platform);
      setError(null);

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

          setConfigs(previousConfigs);
          setError(result.error || "更新失败");
          return false;
        }

        return true;
      } catch (err) {

        setConfigs(previousConfigs);
        setError(err instanceof Error ? err.message : "网络错误");
        return false;
      } finally {
        setSaving(null);
      }
    },
    [configs]
  );

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

  const refresh = useCallback(() => {
    setLoading(true);
    fetcher.load("/app/settings?_data");
  }, [fetcher]);

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

export function getPlatformDisplayName(platform: string): string {
  const names: Record<string, string> = {
    google: "GA4 (Measurement Protocol)",
    meta: "Meta (Facebook)",
    tiktok: "TikTok",
  };
  return names[platform] || platform;
}

export function getPlatformColor(platform: string): string {
  const colors: Record<string, string> = {
    google: "#4285F4",
    meta: "#1877F2",
    tiktok: "#000000",
  };
  return colors[platform] || "#666666";
}

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

