// Migration service for converting old tracking scripts to Web Pixels

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

// Generate pixel code based on platform
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

/**
 * Options for saving pixel configuration
 */
export interface SavePixelConfigOptions {
  /** Non-sensitive client-side configuration (e.g., conversionLabel, eventMappings) */
  clientConfig?: Record<string, string | number | boolean>;
  /** Pre-encrypted credentials string for server-side API (use encryptJson from crypto.ts) */
  credentialsEncrypted?: string;
  /** Enable server-side tracking */
  serverSideEnabled?: boolean;
}

/**
 * Save pixel configuration to database
 * 
 * IMPORTANT: Separation of concerns:
 * - clientConfig: Non-sensitive data like conversion labels, stored as JSON
 * - credentialsEncrypted: Sensitive data like access tokens, must be pre-encrypted
 * 
 * @param shopId - Shop identifier
 * @param platform - Platform name (google, meta, tiktok, etc.)
 * @param platformId - Platform-specific ID (e.g., GA4 Measurement ID)
 * @param options - Additional configuration options
 */
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

// Mark migration as completed
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

// Get all pixel configs for a shop
export async function getPixelConfigs(shopId: string) {
  return prisma.pixelConfig.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
}

// ==========================================
// Automatic Web Pixel Creation
// ==========================================

export interface CreateWebPixelResult {
  success: boolean;
  webPixelId?: string;
  error?: string;
  userErrors?: Array<{ field: string; message: string }>;
}

/**
 * Create a Web Pixel using Shopify Admin GraphQL API
 * 
 * This automatically configures the Tracking Guardian pixel in the shop's
 * Customer Events settings without requiring manual copy/paste.
 * 
 * @param admin - Shopify Admin API context
 * @param backendUrl - URL of the Tracking Guardian backend (e.g., https://your-app.onrender.com)
 */
export async function createWebPixel(
  admin: AdminApiContext,
  backendUrl: string
): Promise<CreateWebPixelResult> {
  // Validate backend URL
  if (!backendUrl || !backendUrl.startsWith("https://")) {
    return {
      success: false,
      error: "Backend URL must be a valid HTTPS URL",
    };
  }

  // Web Pixel settings - just the backend URL
  const settings = JSON.stringify({
    backend_url: backendUrl,
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

/**
 * Update an existing Web Pixel's settings
 */
export async function updateWebPixel(
  admin: AdminApiContext,
  webPixelId: string,
  backendUrl: string
): Promise<CreateWebPixelResult> {
  const settings = JSON.stringify({
    backend_url: backendUrl,
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

/**
 * Get existing Web Pixels for the shop
 */
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

/**
 * Delete a ScriptTag (for migration cleanup)
 */
export async function deleteScriptTag(
  admin: AdminApiContext,
  scriptTagId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await admin.rest.delete({
      path: `script_tags/${scriptTagId}`,
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Microsoft Bing/UET pixel code generator
// Uses browser.window/browser.document for Web Pixel sandbox compatibility
function generateBingPixelCode(config: { tagId: string }): string {
  return `// Microsoft Advertising UET Tag - Web Pixel Implementation
// Auto-generated by Tracking Guardian
// Compatible with Shopify Web Pixel strict sandbox

import { register } from '@shopify/web-pixels-extension';

register(({ analytics, browser }) => {
  const UET_TAG_ID = '${config.tagId}';
  
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

// Microsoft Clarity pixel code generator
// Uses browser.window/browser.document for Web Pixel sandbox compatibility
function generateClarityPixelCode(config: { projectId: string }): string {
  return `// Microsoft Clarity - Web Pixel Implementation
// Auto-generated by Tracking Guardian
// Compatible with Shopify Web Pixel strict sandbox

import { register } from '@shopify/web-pixels-extension';

register(({ analytics, browser }) => {
  const CLARITY_PROJECT_ID = '${config.projectId}';
  
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

