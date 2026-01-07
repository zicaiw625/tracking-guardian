
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface ConfigComparisonResult {
  hasChanges: boolean;
  differences: Array<{
    field: string;
    current: unknown;
    previous: unknown;
    type: "added" | "removed" | "modified";
  }>;
  summary: {
    totalChanges: number;
    addedFields: number;
    removedFields: number;
    modifiedFields: number;
  };
}

export async function compareConfigVersions(
  shopId: string,
  platform: string
): Promise<ConfigComparisonResult | null> {
  try {
    const config = await prisma.pixelConfig.findFirst({
      where: {
        shopId,
        platform,
        environment: "live",
        platformId: null,
      },
      select: {
        id: true,
        platformId: true,
        clientSideEnabled: true,
        serverSideEnabled: true,
        eventMappings: true,
        clientConfig: true,
        environment: true,
        previousConfig: true,
        configVersion: true,
      },
    });

    if (!config || !config.previousConfig) {
      return {
        hasChanges: false,
        differences: [],
        summary: {
          totalChanges: 0,
          addedFields: 0,
          removedFields: 0,
          modifiedFields: 0,
        },
      };
    }

    const current = {
      platformId: config.platformId,
      clientSideEnabled: config.clientSideEnabled,
      serverSideEnabled: config.serverSideEnabled,
      eventMappings: config.eventMappings,
      clientConfig: config.clientConfig,
      environment: config.environment,
    };

    const previous = config.previousConfig as typeof current;

    const differences: ConfigComparisonResult["differences"] = [];

    const fieldsToCompare: Array<keyof typeof current> = [
      "platformId",
      "clientSideEnabled",
      "serverSideEnabled",
      "eventMappings",
      "clientConfig",
      "environment",
    ];

    for (const field of fieldsToCompare) {
      const currentValue = current[field];
      const previousValue = previous[field];

      if (currentValue === undefined && previousValue !== undefined) {
        differences.push({
          field,
          current: currentValue,
          previous: previousValue,
          type: "removed",
        });
      } else if (currentValue !== undefined && previousValue === undefined) {
        differences.push({
          field,
          current: currentValue,
          previous: previousValue,
          type: "added",
        });
      } else if (JSON.stringify(currentValue) !== JSON.stringify(previousValue)) {
        differences.push({
          field,
          current: currentValue,
          previous: previousValue,
          type: "modified",
        });
      }
    }

    const summary = {
      totalChanges: differences.length,
      addedFields: differences.filter((d) => d.type === "added").length,
      removedFields: differences.filter((d) => d.type === "removed").length,
      modifiedFields: differences.filter((d) => d.type === "modified").length,
    };

    return {
      hasChanges: differences.length > 0,
      differences,
      summary,
    };
  } catch (error) {
    logger.error("Failed to compare config versions", { shopId, platform, error });
    return null;
  }
}

export async function getConfigVersionHistory(
  shopId: string,
  platform: string,
  environment: "test" | "live" = "live"
): Promise<Array<{
  version: number;
  timestamp: Date;
  hasSnapshot: boolean;
  environment: string;
}>> {
  try {
    const config = await prisma.pixelConfig.findFirst({
      where: {
        shopId,
        platform,
        environment,
        platformId: null,
      },
      select: {
        configVersion: true,
        previousConfig: true,
        environment: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    if (!config) {
      return [];
    }

    const history: Array<{
      version: number;
      timestamp: Date;
      hasSnapshot: boolean;
      environment: string;
    }> = [
      {
        version: config.configVersion,
        timestamp: config.updatedAt,
        hasSnapshot: false,
        environment: config.environment,
      },
    ];

    if (config.previousConfig) {
      history.push({
        version: config.configVersion - 1,
        timestamp: config.createdAt,
        hasSnapshot: true,
        environment: (config.previousConfig as { environment?: string }).environment || "unknown",
      });
    }

    return history.sort((a, b) => b.version - a.version);
  } catch (error) {
    logger.error("Failed to get config version history", { shopId, platform, error });
    return [];
  }
}

