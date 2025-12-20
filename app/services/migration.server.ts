

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { generateGooglePixelCode } from "./platforms/google.server";
import { generateMetaPixelCode } from "./platforms/meta.server";
import { generateTikTokPixelCode } from "./platforms/tiktok.server";

export type Platform = "google" | "meta" | "tiktok" | "bing" | "clarity";

export interface MigrationConfig {
  platform: Platform;
  platformId: string;
  additionalConfig?: Record<string, string>;
}

export interface MigrationResult {
  success: boolean;
  platform: Platform;
  pixelCode: string;
  instructions: string[];
  error?: string;
}

export function generatePixelCode(config: MigrationConfig): MigrationResult {
  try {
    let pixelCode = "";
    let instructions: string[] = [];

    switch (config.platform) {
      case "google":
        pixelCode = generateGooglePixelCode({
          measurementId: config.platformId,
          conversionId: config.additionalConfig?.conversionId,
          conversionLabel: config.additionalConfig?.conversionLabel,
        });
        instructions = [
          "1. 在 Shopify 后台创建新的 Web Pixel",
          "2. 将生成的代码复制到 Web Pixel 编辑器中",
          "3. 保存并发布 Web Pixel",
          "4. 在 Google Ads 中验证转化追踪是否正常",
          "5. 删除旧的 ScriptTag 或 Additional Scripts",
        ];
        break;

      case "meta":
        pixelCode = generateMetaPixelCode({
          pixelId: config.platformId,
        });
        instructions = [
          "1. 在 Shopify 后台创建新的 Web Pixel",
          "2. 将生成的代码复制到 Web Pixel 编辑器中",
          "3. 保存并发布 Web Pixel",
          "4. 在 Meta Events Manager 中验证事件是否正常触发",
          "5. 配置 Conversions API 以提高追踪准确性",
          "6. 删除旧的 ScriptTag 或 Additional Scripts",
        ];
        break;

      case "tiktok":
        pixelCode = generateTikTokPixelCode({
          pixelId: config.platformId,
        });
        instructions = [
          "1. 在 Shopify 后台创建新的 Web Pixel",
          "2. 将生成的代码复制到 Web Pixel 编辑器中",
          "3. 保存并发布 Web Pixel",
          "4. 在 TikTok Events Manager 中验证事件",
          "5. 删除旧的 ScriptTag 或 Additional Scripts",
        ];
        break;

      case "bing":
        pixelCode = generateBingPixelCode({
          tagId: config.platformId,
        });
        instructions = [
          "1. 在 Shopify 后台创建新的 Web Pixel",
          "2. 将生成的代码复制到 Web Pixel 编辑器中",
          "3. 保存并发布 Web Pixel",
          "4. 在 Microsoft Advertising 中验证 UET 标签",
          "5. 删除旧的 ScriptTag 或 Additional Scripts",
        ];
        break;

      case "clarity":
        pixelCode = generateClarityPixelCode({
          projectId: config.platformId,
        });
        instructions = [
          "1. 在 Shopify 后台创建新的 Web Pixel",
          "2. 将生成的代码复制到 Web Pixel 编辑器中",
          "3. 保存并发布 Web Pixel",
          "4. 在 Microsoft Clarity 中验证数据收集",
          "5. 删除旧的 ScriptTag",
        ];
        break;

      default:
        throw new Error(`Unsupported platform: ${config.platform}`);
    }

    return {
      success: true,
      platform: config.platform,
      pixelCode,
      instructions,
    };
  } catch (error) {
    return {
      success: false,
      platform: config.platform,
      pixelCode: "",
      instructions: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export interface SavePixelConfigOptions {
  
  clientConfig?: Record<string, string | number | boolean>;
  
  credentialsEncrypted?: string;
  
  serverSideEnabled?: boolean;
}

export async function savePixelConfig(
  shopId: string,
  platform: Platform,
  platformId: string,
  options?: SavePixelConfigOptions
) {
  const { clientConfig, credentialsEncrypted, serverSideEnabled } = options || {};
  
  return prisma.pixelConfig.upsert({
    where: {
      shopId_platform: {
        shopId,
        platform,
      },
    },
    update: {
      platformId,
      clientConfig: clientConfig ?? undefined,
      credentialsEncrypted: credentialsEncrypted ?? undefined,
      serverSideEnabled: serverSideEnabled ?? undefined,
      migrationStatus: "in_progress",
      updatedAt: new Date(),
    },
    create: {
      shopId,
      platform,
      platformId,
      clientConfig: clientConfig ?? null,
      credentialsEncrypted: credentialsEncrypted ?? null,
      serverSideEnabled: serverSideEnabled ?? false,
      migrationStatus: "in_progress",
    },
  });
}

export async function completeMigration(shopId: string, platform: Platform) {
  return prisma.pixelConfig.update({
    where: {
      shopId_platform: {
        shopId,
        platform,
      },
    },
    data: {
      migrationStatus: "completed",
      migratedAt: new Date(),
    },
  });
}

export async function getPixelConfigs(shopId: string) {
  return prisma.pixelConfig.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
}

export interface CreateWebPixelResult {
  success: boolean;
  webPixelId?: string;
  error?: string;
  userErrors?: Array<{ field: string; message: string }>;
}

export async function createWebPixel(
  admin: AdminApiContext,
  backendUrl: string,
  ingestionSecret?: string
): Promise<CreateWebPixelResult> {
  
  if (!backendUrl || !backendUrl.startsWith("https://")) {
    return {
      success: false,
      error: "Backend URL must be a valid HTTPS URL",
    };
  }

  const settings = JSON.stringify({
    backend_url: backendUrl,
    ...(ingestionSecret && { ingestion_secret: ingestionSecret }),
  });

  try {
    const response = await admin.graphql(
      `#graphql
      mutation WebPixelCreate($webPixel: WebPixelInput!) {
        webPixelCreate(webPixel: $webPixel) {
          userErrors {
            field
            message
          }
          webPixel {
            id
            settings
          }
        }
      }
      `,
      {
        variables: {
          webPixel: {
            settings,
          },
        },
      }
    );

    const result = await response.json();
    const data = result.data?.webPixelCreate;

    if (data?.userErrors && data.userErrors.length > 0) {
      return {
        success: false,
        userErrors: data.userErrors,
        error: data.userErrors.map((e: { message: string }) => e.message).join(", "),
      };
    }

    if (data?.webPixel?.id) {
      console.log(`Web Pixel created successfully: ${data.webPixel.id}`);
      return {
        success: true,
        webPixelId: data.webPixel.id,
      };
    }

    return {
      success: false,
      error: "Unexpected response from Shopify API",
    };
  } catch (error) {
    console.error("Failed to create Web Pixel:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function updateWebPixel(
  admin: AdminApiContext,
  webPixelId: string,
  backendUrl: string,
  ingestionSecret?: string
): Promise<CreateWebPixelResult> {
  
  const settings = JSON.stringify({
    backend_url: backendUrl,
    ...(ingestionSecret && { ingestion_secret: ingestionSecret }),
  });

  try {
    const response = await admin.graphql(
      `#graphql
      mutation WebPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
        webPixelUpdate(id: $id, webPixel: $webPixel) {
          userErrors {
            field
            message
          }
          webPixel {
            id
            settings
          }
        }
      }
      `,
      {
        variables: {
          id: webPixelId,
          webPixel: {
            settings,
          },
        },
      }
    );

    const result = await response.json();
    const data = result.data?.webPixelUpdate;

    if (data?.userErrors && data.userErrors.length > 0) {
      return {
        success: false,
        userErrors: data.userErrors,
        error: data.userErrors.map((e: { message: string }) => e.message).join(", "),
      };
    }

    if (data?.webPixel?.id) {
      return {
        success: true,
        webPixelId: data.webPixel.id,
      };
    }

    return {
      success: false,
      error: "Unexpected response from Shopify API",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getExistingWebPixels(
  admin: AdminApiContext
): Promise<Array<{ id: string; settings: string | null }>> {
  try {
    const response = await admin.graphql(
      `#graphql
      query GetWebPixels {
        webPixels(first: 50) {
          edges {
            node {
              id
              settings
            }
          }
        }
      }
      `
    );

    const result = await response.json();
    const edges = result.data?.webPixels?.edges || [];

    return edges.map((edge: { node: { id: string; settings: string | null } }) => ({
      id: edge.node.id,
      settings: edge.node.settings,
    }));
  } catch (error) {
    console.error("Failed to get Web Pixels:", error);
    return [];
  }
}

export async function deleteScriptTag(
  _admin: AdminApiContext,
  _scriptTagId: number
): Promise<{ success: boolean; error?: string }> {
  
  return {
    success: false,
    error: "自动删除功能已停用。请在 Shopify 后台「设置 → 应用和销售渠道」中找到创建该 ScriptTag 的应用，手动删除。或者联系 Shopify 支持获取帮助。",
  };
}

function generateBingPixelCode(config: { tagId: string }): string {
  return `// Microsoft Advertising UET Tag - Web Pixel Implementation
// Auto-generated by Tracking Guardian
//
// NOTE: This code requires "lax" sandbox mode to work.
// It will NOT work in "strict" sandbox mode.
// For strict mode, configure server-side tracking via Tracking Guardian settings instead.

import { register } from '@shopify/web-pixels-extension';

register(({ analytics, browser }) => {
  const UET_TAG_ID = '${config.tagId}';
  
  // Check if browser APIs are available (lax mode only)
  if (!browser?.window || !browser?.document) {
    console.warn('[Tracking Guardian] Bing UET requires lax sandbox mode. Use server-side tracking for strict mode.');
    return;
  }
  
  // Idempotency guard - prevent double initialization
  if (browser.window.__TG_BING_LOADED) return;
  browser.window.__TG_BING_LOADED = true;

  // Event queue for events fired before SDK loads
  const eventQueue = [];
  let uetReady = false;

  // Safe uetq wrapper that queues events until ready
  function safeUetq(...args) {
    if (uetReady && browser.window.uetq) {
      browser.window.uetq.push(...args);
    } else {
      eventQueue.push(args);
    }
  }

  // Initialize UET using browser APIs (sandbox-compatible)
  (function(w,d,t,r,u){var f,n,i;w[u]=w[u]||[],f=function(){var o={ti:UET_TAG_ID};o.q=w[u],w[u]=new w.UET(o),w[u].push("pageLoad");
    uetReady = true;
    // Flush queued events
    eventQueue.forEach(args => w[u].push(...args));
    eventQueue.length = 0;
  },n=d.createElement(t),n.src=r,n.async=1,n.onload=n.onreadystatechange=function(){var s=this.readyState;s&&s!=="loaded"&&s!=="complete"||(f(),n.onload=n.onreadystatechange=null)},i=d.getElementsByTagName(t)[0],i.parentNode.insertBefore(n,i)})(browser.window,browser.document,"script","//bat.bing.com/bat.js","uetq");

  // Track page views
  analytics.subscribe('page_viewed', (event) => {
    safeUetq('event', 'page_view', {});
  });

  // Track product views
  analytics.subscribe('product_viewed', (event) => {
    const product = event.data?.productVariant;
    if (!product) return;
    
    safeUetq('event', 'view_item', {
      ecomm_prodid: product.id,
      ecomm_pagetype: 'product',
      revenue_value: parseFloat(product.price?.amount || '0'),
      currency: product.price?.currencyCode || 'USD',
    });
  });

  // Track add to cart
  analytics.subscribe('product_added_to_cart', (event) => {
    const item = event.data?.cartLine;
    if (!item?.merchandise) return;
    
    safeUetq('event', 'add_to_cart', {
      ecomm_prodid: item.merchandise.id,
      revenue_value: parseFloat(item.merchandise.price?.amount || '0') * (item.quantity || 1),
      currency: item.merchandise.price?.currencyCode || 'USD',
    });
  });

  // Track checkout started
  analytics.subscribe('checkout_started', (event) => {
    const checkout = event.data?.checkout;
    if (!checkout) return;
    
    safeUetq('event', 'begin_checkout', {
      revenue_value: parseFloat(checkout.totalPrice?.amount || '0'),
      currency: checkout.currencyCode || 'USD',
    });
  });

  // Track purchase
  analytics.subscribe('checkout_completed', (event) => {
    const checkout = event.data?.checkout;
    if (!checkout) return;
    
    safeUetq('event', 'purchase', {
      revenue_value: parseFloat(checkout.totalPrice?.amount || '0'),
      currency: checkout.currencyCode || 'USD',
      transaction_id: checkout.order?.id || checkout.token,
    });
  });
});
`;
}

import { encryptJson, decryptJson } from "../utils/crypto";
import type { PlatformCredentials } from "../types";
import { logger } from "../utils/logger";

export async function migrateCredentialsToEncrypted(): Promise<{
  migrated: number;
  failed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let migrated = 0;
  let failed = 0;

  const configs = await prisma.pixelConfig.findMany({
    where: {
      credentials: { not: null },
    },
    select: {
      id: true,
      platform: true,
      credentials: true,
      credentialsEncrypted: true,
      shop: { select: { shopDomain: true } },
    },
  });

  logger.info(`P0-09: Found ${configs.length} configs with legacy credentials to migrate`);

  for (const config of configs) {
    try {
      
      if (config.credentialsEncrypted) {
        logger.info(`P0-09: Skipping ${config.id} - already has encrypted credentials`);
        
        await prisma.pixelConfig.update({
          where: { id: config.id },
          data: { credentials: null },
        });
        continue;
      }

      const legacyCreds = config.credentials;
      if (!legacyCreds || typeof legacyCreds !== 'object') {
        logger.warn(`P0-09: Skipping ${config.id} - invalid credentials format`);
        continue;
      }

      const encrypted = encryptJson(legacyCreds as PlatformCredentials);

      await prisma.pixelConfig.update({
        where: { id: config.id },
        data: {
          credentialsEncrypted: encrypted,
          credentials: null,
        },
      });

      logger.info(`P0-09: Migrated credentials for ${config.platform} on ${config.shop.shopDomain}`);
      migrated++;
    } catch (error) {
      const errorMsg = `Failed to migrate config ${config.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      logger.error(`P0-09: ${errorMsg}`);
      failed++;
    }
  }

  logger.info(`P0-09: Migration complete - ${migrated} migrated, ${failed} failed`);
  return { migrated, failed, errors };
}

export async function verifyCredentialsEncryption(): Promise<{
  total: number;
  encrypted: number;
  unencrypted: number;
  unencryptedConfigs: Array<{ id: string; platform: string; shopDomain: string }>;
}> {
  const configs = await prisma.pixelConfig.findMany({
    select: {
      id: true,
      platform: true,
      credentials: true,
      credentialsEncrypted: true,
      shop: { select: { shopDomain: true } },
    },
  });

  const unencryptedConfigs: Array<{ id: string; platform: string; shopDomain: string }> = [];
  let encrypted = 0;
  let unencrypted = 0;

  for (const config of configs) {
    if (config.credentials && !config.credentialsEncrypted) {
      unencrypted++;
      unencryptedConfigs.push({
        id: config.id,
        platform: config.platform,
        shopDomain: config.shop.shopDomain,
      });
    } else if (config.credentialsEncrypted) {
      encrypted++;
    }
  }

  return {
    total: configs.length,
    encrypted,
    unencrypted,
    unencryptedConfigs,
  };
}

export async function sanitizeExistingOrderPayloads(batchSize = 500): Promise<{
  processed: number;
  cleaned: number;
  errors: number;
}> {
  let processed = 0;
  let cleaned = 0;
  let errors = 0;

  while (true) {
    const jobs = await prisma.conversionJob.findMany({
      where: {
        orderPayload: { not: {} },
      },
      select: { id: true },
      take: batchSize,
    });

    if (jobs.length === 0) break;

    for (const job of jobs) {
      try {
        await prisma.conversionJob.update({
          where: { id: job.id },
          data: { orderPayload: {} },
        });
        cleaned++;
      } catch (error) {
        errors++;
        logger.error(`P0-10: Failed to sanitize job ${job.id}`, error);
      }
      processed++;
    }

    logger.info(`P0-10: Processed ${processed} jobs, cleaned ${cleaned}`);
  }

  logger.info(`P0-10: Sanitization complete - ${cleaned} cleaned, ${errors} errors`);
  return { processed, cleaned, errors };
}

export async function getOrderPayloadStats(): Promise<{
  totalJobs: number;
  withOrderPayload: number;
  withCapiInput: number;
  needsSanitization: number;
}> {
  const [totalJobs, withOrderPayload, withCapiInput] = await Promise.all([
    prisma.conversionJob.count(),
    prisma.conversionJob.count({
      where: { orderPayload: { not: {} } },
    }),
    prisma.conversionJob.count({
      where: { capiInput: { not: null } },
    }),
  ]);

  return {
    totalJobs,
    withOrderPayload,
    withCapiInput,
    needsSanitization: withOrderPayload,
  };
}

function generateClarityPixelCode(config: { projectId: string }): string {
  return `// Microsoft Clarity - Web Pixel Implementation
// Auto-generated by Tracking Guardian
//
// NOTE: This code requires "lax" sandbox mode to work.
// It will NOT work in "strict" sandbox mode.
// Clarity requires DOM access for session replay which is not possible in strict mode.

import { register } from '@shopify/web-pixels-extension';

register(({ analytics, browser }) => {
  const CLARITY_PROJECT_ID = '${config.projectId}';
  
  // Check if browser APIs are available (lax mode only)
  if (!browser?.window || !browser?.document) {
    console.warn('[Tracking Guardian] Clarity requires lax sandbox mode and is not available in strict mode.');
    return;
  }
  
  // Idempotency guard - prevent double initialization
  if (browser.window.__TG_CLARITY_LOADED) return;
  browser.window.__TG_CLARITY_LOADED = true;

  // Event queue for events fired before SDK loads
  const eventQueue = [];
  let clarityReady = false;

  // Safe clarity wrapper that queues events until ready
  function safeClarity(...args) {
    if (clarityReady && browser.window.clarity) {
      browser.window.clarity(...args);
    } else {
      eventQueue.push(args);
    }
  }

  // Initialize Clarity using browser APIs (sandbox-compatible)
  (function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    t.onload=function(){
      clarityReady = true;
      // Flush queued events
      eventQueue.forEach(args => {
        if (c.clarity) c.clarity(...args);
      });
      eventQueue.length = 0;
    };
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
  })(browser.window, browser.document, "clarity", "script", CLARITY_PROJECT_ID);

  // Clarity automatically tracks page views and user interactions
  // No additional event tracking needed for basic setup

  // Optional: Set custom tags for user segments
  analytics.subscribe('checkout_completed', (event) => {
    const checkout = event.data?.checkout;
    if (!checkout) return;
    
    safeClarity('set', 'purchaser', 'true');
    safeClarity('set', 'order_value', checkout.totalPrice?.amount || '0');
  });
});
`;
}

