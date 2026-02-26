#!/usr/bin/env node

import { performance } from "perf_hooks";
import { createHash, createHmac } from "crypto";

const BACKEND_URL = process.env.SHOPIFY_APP_URL || "http://localhost:3000";
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS || "10", 10);
const TOTAL_REQUESTS = parseInt(process.env.TOTAL_REQUESTS || "100", 10);
const SHOP_DOMAIN = process.env.SHOP_DOMAIN || "test-shop.myshopify.com";
const INGESTION_SECRET = process.env.INGESTION_SECRET || "test-secret";
const INCLUDE_PREFLIGHT = process.env.INCLUDE_PREFLIGHT !== "false";

function generateHMAC(secret, timestamp, shopDomain, bodyHash) {
  const message = `${timestamp}:${shopDomain}:${bodyHash}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(message);
  return hmac.digest("hex");
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function createPixelEvent(timestamp) {
  return {
    eventName: "checkout_started",
    timestamp,
    shopDomain: SHOP_DOMAIN,
    data: {
      checkoutToken: `test-checkout-${Date.now()}-${Math.random()}`,
      items: [
        {
          id: "test-item-1",
          name: "Test Product",
          price: 10.00,
          quantity: 1,
        },
      ],
      value: 10.00,
      currency: "USD",
    },
  };
}

function buildSignedBody(timestamp) {
  const unsignedPayload = createPixelEvent(timestamp);
  const unsignedBody = JSON.stringify(unsignedPayload);
  const unsignedBodyHash = sha256Hex(unsignedBody);
  const bodySignature = generateHMAC(INGESTION_SECRET, timestamp, SHOP_DOMAIN, unsignedBodyHash);
  const signedPayload = {
    ...unsignedPayload,
    signature: bodySignature,
    signatureTimestamp: timestamp,
    signatureShopDomain: SHOP_DOMAIN,
  };
  const body = JSON.stringify(signedPayload);
  const headerBodyHash = sha256Hex(body);
  const headerSignature = generateHMAC(INGESTION_SECRET, timestamp, SHOP_DOMAIN, headerBodyHash);
  return { body, headerSignature };
}

async function sendPreflightRequest() {
  const startTime = performance.now();
  try {
    const response = await fetch(`${BACKEND_URL}/ingest`, {
      method: "OPTIONS",
      headers: {
        Origin: `https://${SHOP_DOMAIN}`,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "content-type,x-tracking-guardian-timestamp,x-tracking-guardian-signature,x-shopify-shop-domain",
      },
    });
    return {
      success: response.status >= 200 && response.status < 300,
      status: response.status,
      duration: performance.now() - startTime,
      kind: "preflight",
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      duration: performance.now() - startTime,
      kind: "preflight",
    };
  }
}

async function sendPixelEvent(body, signature, timestamp) {
  const startTime = performance.now();
  try {
    const response = await fetch(`${BACKEND_URL}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-shopify-shop-domain": SHOP_DOMAIN,
        "X-Tracking-Guardian-Signature": signature,
        "X-Tracking-Guardian-Timestamp": timestamp.toString(),
        Origin: `https://${SHOP_DOMAIN}`,
      },
      body,
    });
    const endTime = performance.now();
    const duration = endTime - startTime;
    const status = response.status;
    const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining");
    const rateLimitReset = response.headers.get("X-RateLimit-Reset");
    return {
      success: status >= 200 && status < 300,
      status,
      duration,
      kind: "post",
      rateLimitRemaining: rateLimitRemaining ? parseInt(rateLimitRemaining, 10) : null,
      rateLimitReset: rateLimitReset ? parseInt(rateLimitReset, 10) : null,
    };
  } catch (error) {
    const endTime = performance.now();
    return {
      success: false,
      error: error.message,
      duration: endTime - startTime,
      kind: "post",
    };
  }
}

async function runLoadTest() {
  console.log("开始像素事件压测...");
  console.log(`后端 URL: ${BACKEND_URL}`);
  console.log(`并发请求数: ${CONCURRENT_REQUESTS}`);
  console.log(`总请求数: ${TOTAL_REQUESTS}`);
  console.log(`店铺域名: ${SHOP_DOMAIN}`);
  console.log("");

  const results = [];
  const errors = [];
  const rateLimitHits = [];
  let completed = 0;

  async function runBatch(batchSize) {
    const promises = [];
    for (let i = 0; i < batchSize; i++) {
      const timestamp = Date.now();
      const { body, headerSignature } = buildSignedBody(timestamp);
      if (INCLUDE_PREFLIGHT) {
        promises.push(sendPreflightRequest());
      }
      promises.push(sendPixelEvent(body, headerSignature, timestamp));
    }
    const batchResults = await Promise.all(promises);
    return batchResults;
  }

  const startTime = performance.now();
  const batches = Math.ceil(TOTAL_REQUESTS / CONCURRENT_REQUESTS);

  for (let batch = 0; batch < batches; batch++) {
    const remaining = TOTAL_REQUESTS - completed;
    const batchSize = Math.min(CONCURRENT_REQUESTS, remaining);
    const batchResults = await runBatch(batchSize);
    for (const result of batchResults) {
      results.push(result);
      if (!result.success) {
        if (result.status === 429) {
          rateLimitHits.push(result);
        } else {
          errors.push(result);
        }
      }
      completed++;
      if (completed % 10 === 0) {
        process.stdout.write(`\r已完成: ${completed}/${TOTAL_REQUESTS}`);
      }
    }
  }
  const endTime = performance.now();
  const totalDuration = endTime - startTime;

  console.log("\n");
  console.log("压测结果:");
  console.log("=".repeat(50));
  console.log(`总请求数: ${TOTAL_REQUESTS}`);
  const postResults = results.filter((r) => r.kind === "post");
  const preflightResults = results.filter((r) => r.kind === "preflight");
  console.log(`POST 请求: ${postResults.length}`);
  console.log(`OPTIONS 预检: ${preflightResults.length}`);
  console.log(`成功请求: ${results.filter((r) => r.success).length}`);
  console.log(`失败请求: ${results.filter((r) => !r.success).length}`);
  console.log(`Rate Limit 触发: ${rateLimitHits.length}`);
  console.log(`其他错误: ${errors.length}`);
  console.log(`总耗时: ${(totalDuration / 1000).toFixed(2)} 秒`);
  console.log(`平均响应时间: ${(results.reduce((sum, r) => sum + r.duration, 0) / results.length).toFixed(2)} 毫秒`);
  console.log(`QPS: ${(TOTAL_REQUESTS / (totalDuration / 1000)).toFixed(2)}`);

  if (rateLimitHits.length > 0) {
    console.log("\n警告: 检测到 Rate Limit 触发");
    console.log("建议: 检查 RATE_LIMIT_CONFIG.PIXEL_EVENTS 配置是否合理");
    console.log("如果这是正常的高峰期流量，可能需要调整 rate limit 阈值");
  }

  if (errors.length > 0) {
    console.log("\n错误详情:");
    const errorTypes = {};
    for (const error of errors) {
      const key = error.status || error.error || "unknown";
      errorTypes[key] = (errorTypes[key] || 0) + 1;
    }
    for (const [type, count] of Object.entries(errorTypes)) {
      console.log(`  ${type}: ${count} 次`);
    }
  }

  const avgRateLimitRemaining = results
    .filter((r) => r.rateLimitRemaining !== null)
    .reduce((sum, r) => sum + r.rateLimitRemaining, 0) / results.filter((r) => r.rateLimitRemaining !== null).length;
  if (!isNaN(avgRateLimitRemaining)) {
    console.log(`\n平均 Rate Limit 剩余: ${avgRateLimitRemaining.toFixed(0)}`);
  }
}

async function testNullOrigin() {
  console.log("\n测试 Origin: null 场景...");
  const timestamp = Date.now();
  const { body, headerSignature } = buildSignedBody(timestamp);

  try {
    const response = await fetch(`${BACKEND_URL}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-shopify-shop-domain": SHOP_DOMAIN,
        "X-Tracking-Guardian-Signature": headerSignature,
        "X-Tracking-Guardian-Timestamp": timestamp.toString(),
        Origin: "null",
      },
      body,
    });
    const status = response.status;
    if (status >= 200 && status < 300) {
      console.log("✅ Origin: null 请求成功");
      console.log("提示: 如果生产环境需要支持 Origin: null，请设置 PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=true");
    } else if (status === 403) {
      console.log("⚠️  Origin: null 请求被拒绝");
      console.log("提示: 某些 Shopify 场景（如 Web Worker 沙箱环境）可能出现 Origin: null");
      console.log("如果生产环境需要支持，请设置 PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=true");
    } else {
      console.log(`❌ Origin: null 请求失败，状态码: ${status}`);
    }
  } catch (error) {
    console.log(`❌ Origin: null 请求失败: ${error.message}`);
  }
}

async function main() {
  if (process.argv.includes("--null-origin-only")) {
    await testNullOrigin();
    return;
  }

  await runLoadTest();
  await testNullOrigin();
}

main().catch((error) => {
  console.error("压测失败:", error);
  process.exit(1);
});
