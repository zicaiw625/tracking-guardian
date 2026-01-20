import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDynamicCorsHeaders } from "../utils/cors";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsHeaders = getDynamicCorsHeaders(request);
  const response = json({
    appName: "Tracking Guardian",
    appDomain: process.env.SHOPIFY_APP_URL || process.env.APP_URL || "https://tracking-guardian.onrender.com",
    lastUpdated: "2025-01-15",
  });
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  addSecurityHeadersToHeaders(headers, PUBLIC_PAGE_HEADERS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export default function PrivacyPage() {
  const { appName, appDomain, lastUpdated } = useLoaderData<typeof loader>();
  
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>隐私政策 - {appName}</title>
        <style>{`
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
          }
          .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          h1 {
            color: #202223;
            margin-bottom: 10px;
            font-size: 32px;
          }
          h2 {
            color: #202223;
            margin-top: 30px;
            margin-bottom: 15px;
            font-size: 24px;
            border-bottom: 2px solid #e1e3e5;
            padding-bottom: 10px;
          }
          h3 {
            color: #202223;
            margin-top: 20px;
            margin-bottom: 10px;
            font-size: 18px;
          }
          p {
            margin-bottom: 15px;
            color: #5e6e77;
          }
          ul, ol {
            margin-left: 20px;
            margin-bottom: 15px;
          }
          li {
            margin-bottom: 8px;
            color: #5e6e77;
          }
          .meta {
            color: #8c9196;
            font-size: 14px;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid #e1e3e5;
          }
          .highlight {
            background: #fff4e5;
            padding: 15px;
            border-left: 4px solid #f59e0b;
            margin: 20px 0;
            border-radius: 4px;
          }
          .warning {
            background: #fef2f2;
            padding: 15px;
            border-left: 4px solid #ef4444;
            margin: 20px 0;
            border-radius: 4px;
          }
          code {
            background: #f1f3f5;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 0.9em;
          }
          a {
            color: #008060;
            text-decoration: none;
          }
          a:hover {
            text-decoration: underline;
          }
          .section {
            margin-bottom: 30px;
          }
        `}</style>
      </head>
      <body>
        <div className="container">
          <h1>隐私政策</h1>
          <div className="meta">
            <p><strong>应用名称：</strong>{appName}</p>
            <p><strong>最后更新：</strong>{lastUpdated}</p>
            <p><strong>应用域名：</strong><a href={appDomain}>{appDomain}</a></p>
          </div>

          <div className="section">
            <h2>概述</h2>
            <p>
              {appName} 是一个 Shopify 应用，作为<strong>数据处理者</strong>（Data Processor）代表商家（数据控制者）处理转化追踪数据。
              我们遵循 GDPR、CCPA 等隐私法规，确保数据安全和合规。
            </p>
          </div>

          <div className="section">
            <h2>收集的数据类型</h2>
            <h3>订单数据</h3>
            <ul>
              <li>订单 ID 和订单号</li>
              <li>订单金额和货币</li>
              <li>商品信息（名称、数量、价格、SKU）</li>
              <li>结账令牌（用于匹配像素事件，已哈希处理）</li>
            </ul>

            <h3>客户同意状态</h3>
            <ul>
              <li>marketing: 是否同意营销追踪</li>
              <li>analytics: 是否同意分析追踪</li>
              <li>saleOfData: 是否允许数据销售（CCPA）</li>
            </ul>

            <h3>不收集的数据（PII）</h3>
            <div className="highlight">
              <p><strong>我们不收集以下个人身份信息：</strong></p>
              <ul>
                <li>客户姓名</li>
                <li>客户邮箱</li>
                <li>客户电话</li>
                <li>客户地址</li>
                <li>支付信息（信用卡号、支付方式详情）</li>
              </ul>
            </div>

            <h3>会话与鉴权</h3>
            <p>
              为完成 Shopify 鉴权与会话管理，我们可能存储<strong>店铺管理员或员工的标识信息</strong>（例如邮箱）作为会话（Session）数据的一部分。来源为 Shopify OAuth，用途为鉴权与会话维持，保留周期随 Session 过期或按 Shopify 会话策略。前述「不收集的数据」仅针对<strong>终端客户</strong>，不针对商家或店铺员工。
            </p>
          </div>

          <div className="section">
            <h2>数据用途</h2>
            <h3>转化追踪</h3>
            <p>将购买事件发送到您配置的广告平台（Meta、TikTok、GA4），帮助您准确衡量广告投资回报。</p>

            <div className="warning">
              <p><strong>重要：服务端追踪默认关闭</strong></p>
              <p>
                所有新创建的像素配置中，服务端转化追踪（Server-side CAPI/MP）默认关闭（<code>serverSideEnabled: false</code>）。
                只有在设置页面中显式启用后，才会开始发送服务端事件。
              </p>
              <p>
                启用服务端追踪前，您必须：
              </p>
              <ul>
                <li>在隐私政策中明确说明向第三方平台发送的数据类型和用途</li>
                <li>已获得必要的用户同意（如 GDPR/CCPA 要求）</li>
                <li>已准备好应对 Shopify App Review 关于数据使用的询问</li>
              </ul>
            </div>

            <h3>对账与诊断</h3>
            <p>比对 Webhook 订单与像素事件，帮助您发现追踪缺口并优化配置。当用户未给予相应同意导致事件不向任何平台发送时，我们仍可能为去重与诊断目的保存<strong>最小元数据</strong>（如订单键、事件类型、时间戳），<strong>不保存</strong>事件负载中的商品、金额等明细。</p>

            <h3>合规执行</h3>
            <p>根据客户的同意状态，自动决定是否向特定平台发送数据，确保符合 GDPR/CCPA。</p>

            <h3>部分功能与 PCD</h3>
            <p>订单读取（read_orders）仅用于对账、验收且字段最小化（不取姓名、邮箱、地址）；再购等需 PCD 审批的功能有硬门禁。部分功能（如订单状态、再购）需访问 Shopify Protected Customer Data (PCD)；仅在应用通过 Shopify PCD 审核后可用，且遵循平台对订单/客户数据的访问与展示限制。</p>
          </div>

          <div className="section">
            <h2>数据保留</h2>
            <p>我们遵循数据最小化原则，仅保存必要的数据，并定期清理过期数据。所有数据类型的保留周期由店铺的数据保留设置控制（默认 90 天）：</p>
            <ul>
              <li><strong>ConversionJob（转化任务）</strong>：按店铺数据保留周期（默认 90 天）</li>
              <li><strong>PixelEventReceipt（像素收据）</strong>：按店铺数据保留周期（默认 90 天）</li>
              <li><strong>ConversionLog（发送日志）</strong>：按店铺数据保留周期（默认 90 天）</li>
              <li><strong>ReconciliationReport（对账报告）</strong>：按店铺数据保留周期（默认 90 天）</li>
            </ul>
          </div>

          <div className="section">
            <h2>数据删除</h2>
            <p>我们支持多种数据删除方式：</p>
            <ul>
              <li><strong>卸载应用</strong>：收到 <code>APP_UNINSTALLED</code> webhook 后，立即标记为 inactive，并在 48 小时内由定时清理任务删除所有数据</li>
              <li><strong>GDPR 客户数据删除请求</strong>：响应 <code>CUSTOMERS_DATA_REQUEST</code> 或 <code>CUSTOMERS_REDACT</code> webhook</li>
              <li><strong>店铺数据删除请求</strong>：响应 <code>SHOP_REDACT</code> webhook，立即删除所有数据</li>
            </ul>
          </div>

          <div className="section">
            <h2>第三方共享</h2>
            <p>
              当您启用服务端追踪时，数据可能被发送到以下平台：
            </p>
            <ul>
              <li><strong>Meta (Facebook) Conversions API</strong></li>
              <li><strong>TikTok Events API</strong></li>
              <li><strong>Google Analytics 4 (GA4) Measurement Protocol</strong></li>
              <li><strong>通用 HTTP Webhook</strong>（由您配置）</li>
            </ul>
            <p>
              即使启用了服务端追踪，我们<strong>不会发送</strong>客户个人信息（姓名、邮箱、电话、地址）或支付信息。
            </p>
          </div>

          <div className="section">
            <h2>安全措施</h2>
            <ul>
              <li><strong>传输加密</strong>：所有 API 通信均使用 TLS 1.2+ 加密</li>
              <li><strong>存储加密</strong>：平台凭证、访问令牌使用 AES-256-GCM 加密存储</li>
              <li><strong>访问控制</strong>：通过 Shopify OAuth 验证，确保只有授权的店铺管理员可以访问数据</li>
              <li><strong>日志脱敏</strong>：所有日志自动脱敏，敏感信息会被替换为 <code>[REDACTED]</code></li>
              <li><strong>防重放攻击</strong>：像素事件使用 HMAC 签名、时间窗验证和 nonce 防重放机制</li>
            </ul>
          </div>

          <div className="section">
            <h2>数据主体权利</h2>
            <p>根据 GDPR 和 CCPA，您享有以下权利：</p>
            <ul>
              <li><strong>访问权</strong>：有权了解我们收集了哪些数据</li>
              <li><strong>删除权</strong>：有权要求删除您的数据</li>
              <li><strong>更正权</strong>：有权更正不准确的数据</li>
              <li><strong>数据可携带权</strong>：有权以结构化格式获取您的数据</li>
              <li><strong>反对权</strong>：有权反对数据处理</li>
            </ul>
            <p>本应用通过 Shopify GDPR webhooks 自动处理这些请求。</p>
          </div>

          <div className="section">
            <h2>完整合规文档</h2>
            <p>更多说明见应用内「隐私与合规」页。</p>
          </div>

          <div className="section">
            <h2>联系方式</h2>
            <p>
              如有任何关于数据处理或隐私的问题，请通过 Shopify App 内支持渠道联系我们。
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
