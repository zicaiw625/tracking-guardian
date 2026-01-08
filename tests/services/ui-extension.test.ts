import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
    },
    uiExtensionSetting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import prisma from "../../app/db.server";
import {
  getUiModuleConfigs,
  getUiModuleConfig,
  updateUiModuleConfig,
  batchToggleModules,
  resetModuleToDefault,
  getEnabledModulesCount,
  getModuleStats,
  canUseModule,
  getDefaultSettings,
  getDefaultDisplayRules,
  MODULE_KEYS,
  UI_MODULES,
} from "../../app/services/ui-extension.server";
import type { ModuleKey } from "../../app/types/ui-extension";

describe("UI Extension Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getDefaultSettings", () => {
    it("should return default settings for survey module", () => {
      const settings = getDefaultSettings("survey");
      expect(settings).toBeDefined();
      expect(settings).toHaveProperty("title");
      expect(settings).toHaveProperty("question");
      expect(settings).toHaveProperty("sources");
    });

    it("should return default settings for helpdesk module", () => {
      const settings = getDefaultSettings("helpdesk");
      expect(settings).toBeDefined();
      expect(settings).toHaveProperty("title");
    });

    it("should return default settings for order_tracking module", () => {
      const settings = getDefaultSettings("order_tracking");
      expect(settings).toBeDefined();
      expect(settings).toHaveProperty("provider");
    });

    it("should return default settings for reorder module", () => {
      const settings = getDefaultSettings("reorder");
      expect(settings).toBeDefined();
      expect(settings).toHaveProperty("title");
      expect(settings).toHaveProperty("buttonText");
    });

    it("should return default settings for upsell module", () => {
      const settings = getDefaultSettings("upsell");
      expect(settings).toBeDefined();
      expect(settings).toHaveProperty("title");
      expect(settings).toHaveProperty("products");
    });
  });

  describe("getDefaultDisplayRules", () => {
    it("should return default display rules", () => {
      const rules = getDefaultDisplayRules("survey");
      expect(rules).toBeDefined();
      expect(rules.enabled).toBe(false);
      expect(rules.targets).toBeDefined();
      expect(Array.isArray(rules.targets)).toBe(true);
    });
  });

  describe("canUseModule", () => {
    it("should allow free plan to use starter modules", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        plan: "free",
      } as any);
      vi.mocked(prisma.uiExtensionSetting.count).mockResolvedValue(0);

      const result = await canUseModule("shop-1", "survey");

      expect(result).toBeDefined();
      expect(result).toHaveProperty("allowed");
      expect(result).toHaveProperty("requiredPlan");
      expect(result).toHaveProperty("currentPlan");
    });

    it("should allow starter plan to use starter modules", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        plan: "starter",
      } as any);
      vi.mocked(prisma.uiExtensionSetting.count).mockResolvedValue(0);

      const result = await canUseModule("shop-1", "survey");

      expect(result).toBeDefined();
    });

    it("should enforce module limit for starter plan", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        plan: "starter",
      } as any);

      vi.mocked(prisma.uiExtensionSetting.count).mockResolvedValue(1);

      const result = await canUseModule("shop-1", "survey");

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it("should return error when shop not found", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue(null);

      const result = await canUseModule("non-existent", "survey");

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe("getUiModuleConfigs", () => {
    it("should return all module configs with defaults when none exist", async () => {
      vi.mocked(prisma.uiExtensionSetting.findMany).mockResolvedValue([]);

      const configs = await getUiModuleConfigs("shop-1");

      expect(configs).toBeDefined();
      expect(configs.length).toBe(MODULE_KEYS.length);
      configs.forEach((config) => {
        expect(config.isEnabled).toBe(false);
        expect(config.settings).toBeDefined();
        expect(config.displayRules).toBeDefined();
      });
    });

    it("should merge existing settings with defaults", async () => {
      const mockSettings = [
        {
          shopId: "shop-1",
          moduleKey: "survey",
          isEnabled: true,
          settingsJson: { title: "Custom Title" },
          displayRules: { enabled: true, targets: ["thank_you"] },
          localization: null,
        },
      ];

      vi.mocked(prisma.uiExtensionSetting.findMany).mockResolvedValue(mockSettings as any);

      const configs = await getUiModuleConfigs("shop-1");

      const surveyConfig = configs.find((c) => c.moduleKey === "survey");
      expect(surveyConfig).toBeDefined();
      expect(surveyConfig?.isEnabled).toBe(true);
      expect(surveyConfig?.settings).toHaveProperty("title", "Custom Title");
    });
  });

  describe("getUiModuleConfig", () => {
    it("should return default config when module not configured", async () => {
      vi.mocked(prisma.uiExtensionSetting.findUnique).mockResolvedValue(null);

      const config = await getUiModuleConfig("shop-1", "survey");

      expect(config).toBeDefined();
      expect(config.moduleKey).toBe("survey");
      expect(config.isEnabled).toBe(false);
      expect(config.settings).toBeDefined();
    });

    it("should return existing config when module is configured", async () => {
      const mockSetting = {
        shopId: "shop-1",
        moduleKey: "survey",
        isEnabled: true,
        settingsJson: { title: "Test Survey" },
        displayRules: { enabled: true, targets: ["thank_you"] },
        localization: null,
      };

      vi.mocked(prisma.uiExtensionSetting.findUnique).mockResolvedValue(mockSetting as any);

      const config = await getUiModuleConfig("shop-1", "survey");

      expect(config).toBeDefined();
      expect(config.moduleKey).toBe("survey");
      expect(config.isEnabled).toBe(true);
      expect(config.settings).toHaveProperty("title", "Test Survey");
    });
  });

  describe("updateUiModuleConfig", () => {
    it("should update module config successfully", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        plan: "starter",
      } as any);
      vi.mocked(prisma.uiExtensionSetting.count).mockResolvedValue(0);
      vi.mocked(prisma.uiExtensionSetting.upsert).mockResolvedValue({
        id: "setting-1",
        shopId: "shop-1",
        moduleKey: "survey",
      } as any);

      const result = await updateUiModuleConfig("shop-1", "survey", {
        isEnabled: true,
        settings: { title: "New Title" },
      });

      expect(result.success).toBe(true);
      expect(prisma.uiExtensionSetting.upsert).toHaveBeenCalled();
    });

    it("should reject when plan doesn't allow module", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        plan: "free",
      } as any);
      vi.mocked(prisma.uiExtensionSetting.count).mockResolvedValue(0);

      const result = await updateUiModuleConfig("shop-1", "survey", {
        isEnabled: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        plan: "starter",
      } as any);
      vi.mocked(prisma.uiExtensionSetting.count).mockResolvedValue(0);
      vi.mocked(prisma.uiExtensionSetting.upsert).mockRejectedValue(
        new Error("Database error")
      );

      const result = await updateUiModuleConfig("shop-1", "survey", {
        isEnabled: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("batchToggleModules", () => {
    it("should toggle multiple modules", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        plan: "growth",
      } as any);
      vi.mocked(prisma.uiExtensionSetting.count).mockResolvedValue(0);
      vi.mocked(prisma.uiExtensionSetting.upsert).mockResolvedValue({} as any);

      const result = await batchToggleModules("shop-1", [
        { moduleKey: "survey", isEnabled: true },
        { moduleKey: "helpdesk", isEnabled: false },
      ]);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(true);
    });

    it("should handle partial failures", async () => {
      vi.mocked(prisma.shop.findUnique)
        .mockResolvedValueOnce({ plan: "growth" } as any)
        .mockResolvedValueOnce({ plan: "free" } as any);
      vi.mocked(prisma.uiExtensionSetting.count).mockResolvedValue(0);
      vi.mocked(prisma.uiExtensionSetting.upsert).mockResolvedValue({} as any);

      const result = await batchToggleModules("shop-1", [
        { moduleKey: "survey", isEnabled: true },
        { moduleKey: "helpdesk", isEnabled: true },
      ]);

      expect(result.results.length).toBe(2);
    });
  });

  describe("resetModuleToDefault", () => {
    it("should reset module to default settings", async () => {
      vi.mocked(prisma.uiExtensionSetting.upsert).mockResolvedValue({} as any);

      const result = await resetModuleToDefault("shop-1", "survey");

      expect(result.success).toBe(true);
      expect(prisma.uiExtensionSetting.upsert).toHaveBeenCalled();
    });

    it("should handle errors when resetting", async () => {
      vi.mocked(prisma.uiExtensionSetting.upsert).mockRejectedValue(
        new Error("Database error")
      );

      const result = await resetModuleToDefault("shop-1", "survey");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("getEnabledModulesCount", () => {
    it("should return count of enabled modules", async () => {
      vi.mocked(prisma.uiExtensionSetting.count).mockResolvedValue(3);

      const count = await getEnabledModulesCount("shop-1");

      expect(count).toBe(3);
      expect(prisma.uiExtensionSetting.count).toHaveBeenCalledWith({
        where: {
          shopId: "shop-1",
          isEnabled: true,
        },
      });
    });
  });

  describe("getModuleStats", () => {
    it("should return module statistics", async () => {
      const mockSettings = [
        {
          moduleKey: "survey",
          isEnabled: true,
        },
        {
          moduleKey: "helpdesk",
          isEnabled: true,
        },
        {
          moduleKey: "reorder",
          isEnabled: false,
        },
      ];

      vi.mocked(prisma.uiExtensionSetting.findMany).mockResolvedValue(mockSettings as any);

      const stats = await getModuleStats("shop-1");

      expect(stats).toBeDefined();
      expect(stats.total).toBe(MODULE_KEYS.length);
      expect(stats.enabled).toBe(2);
      expect(stats.byCategory).toBeDefined();
    });

    it("should handle empty settings", async () => {
      vi.mocked(prisma.uiExtensionSetting.findMany).mockResolvedValue([]);

      const stats = await getModuleStats("shop-1");

      expect(stats.enabled).toBe(0);
      expect(stats.total).toBe(MODULE_KEYS.length);
    });
  });
});
