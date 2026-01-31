import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDynamicCorsHeaders } from "../utils/cors";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";
import { getLocaleFromRequest } from "../utils/locale.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsHeaders = getDynamicCorsHeaders(request);
  const locale = getLocaleFromRequest(request);
  const appName = "Tracking Guardian";
  const response = json({
    appName,
    appDomain: process.env.SHOPIFY_APP_URL || process.env.APP_URL || "https://tracking-guardian.onrender.com",
    lastUpdated: "2025-01-15",
    locale,
    pageTitle: locale === "zh" ? `隐私政策 - ${appName}` : `Privacy Policy - ${appName}`,
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

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [{ title: data?.pageTitle ?? "Privacy Policy" }];
};

const PAGE_STYLES = `
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
        `;

export default function PrivacyPage() {
  const { appName, appDomain, lastUpdated, locale } = useLoaderData<typeof loader>();
  const isZh = locale === "zh";

  return (
    <>
      <style>{PAGE_STYLES}</style>
      <div className="container" style={{ margin: 20, maxWidth: 900, marginLeft: "auto", marginRight: "auto", background: "#fff", padding: 40, borderRadius: 8, boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
          <h1>{isZh ? "隐私政策" : "Privacy Policy"}</h1>
          <div className="meta">
            <p><strong>{isZh ? "应用名称：" : "App name:"}</strong>{appName}</p>
            <p><strong>{isZh ? "最后更新：" : "Last updated:"}</strong>{lastUpdated}</p>
            <p><strong>{isZh ? "应用域名：" : "App domain:"}</strong><a href={appDomain}>{appDomain}</a></p>
          </div>

          <div className="section">
            <h2>{isZh ? "概述" : "Overview"}</h2>
            <p>
              {isZh
                ? <>{appName} 是一个 Shopify 应用，作为<strong>数据处理者</strong>（Data Processor）代表商家（数据控制者）处理转化追踪数据。我们遵循 GDPR、CCPA 等隐私法规，确保数据安全和合规。</>
                : <>{appName} is a Shopify app that acts as a <strong>Data Processor</strong> on behalf of merchants (data controllers) to process conversion tracking data. We follow GDPR, CCPA and other privacy regulations to ensure data security and compliance.</>
              }
            </p>
          </div>

          <div className="section">
            <h2>{isZh ? "收集的数据类型" : "Data types collected"}</h2>
            <h3>{isZh ? "订单数据" : "Order data"}</h3>
            <ul>
              {isZh ? (
                <>
                  <li>订单 ID 和订单号</li>
                  <li>订单金额和货币</li>
                  <li>商品信息（名称、数量、价格、SKU）</li>
                  <li>结账令牌（用于匹配像素事件，已哈希处理）</li>
                </>
              ) : (
                <>
                  <li>Order ID and order number</li>
                  <li>Order amount and currency</li>
                  <li>Product info (name, quantity, price, SKU)</li>
                  <li>Checkout token (for matching pixel events, hashed)</li>
                </>
              )}
            </ul>

            <h3>{isZh ? "客户同意状态" : "Customer consent state"}</h3>
            <ul>
              {isZh ? (
                <>
                  <li>marketing: 是否同意营销追踪</li>
                  <li>analytics: 是否同意分析追踪</li>
                  <li>saleOfData: 是否允许数据销售（CCPA）</li>
                </>
              ) : (
                <>
                  <li>marketing: consent for marketing tracking</li>
                  <li>analytics: consent for analytics tracking</li>
                  <li>saleOfData: consent for data sale (CCPA)</li>
                </>
              )}
            </ul>

            <h3>{isZh ? "不收集的数据（PII）" : "Data we do not collect (PII)"}</h3>
            <div className="highlight">
              <p><strong>{isZh ? "我们不收集以下个人身份信息：" : "We do not collect the following personally identifiable information:"}</strong></p>
              <ul>
                {isZh ? (
                  <>
                    <li>客户姓名</li>
                    <li>客户邮箱</li>
                    <li>客户电话</li>
                    <li>客户地址</li>
                    <li>支付信息（信用卡号、支付方式详情）</li>
                  </>
                ) : (
                  <>
                    <li>Customer name</li>
                    <li>Customer email</li>
                    <li>Customer phone</li>
                    <li>Customer address</li>
                    <li>Payment info (card number, payment method details)</li>
                  </>
                )}
              </ul>
            </div>

            <h3>{isZh ? "请求相关技术数据" : "Request-related technical data"}</h3>
            <p>
              {isZh
                ? "为安全、反作弊与验收目的，我们可能存储与请求相关的技术数据（如 IP 地址、User-Agent、page_url、referrer），保留周期与店铺数据保留设置一致，删除方式同 GDPR/webhook 删除策略。"
                : "For security, anti-fraud and verification we may store request-related technical data (e.g. IP, User-Agent, page_url, referrer). Retention follows store data retention; deletion follows GDPR/webhook policy."
              }
            </p>

            <h3>{isZh ? "会话与鉴权" : "Session and authentication"}</h3>
            <p>
              {isZh
                ? <>为完成 Shopify 鉴权与会话管理，我们可能存储<strong>店铺管理员或员工的标识信息</strong>（例如邮箱）作为会话（Session）数据的一部分。来源为 Shopify OAuth，用途为鉴权与会话维持，保留周期随 Session 过期或按 Shopify 会话策略。前述「不收集的数据」仅针对<strong>终端客户</strong>，不针对商家或店铺员工。</>
                : <>For Shopify authentication and session management we may store <strong>store admin or staff identifiers</strong> (e.g. email) as part of session data. Source is Shopify OAuth; used for authentication and session maintenance. Retention follows session expiry or Shopify session policy. The “data we do not collect” above applies to <strong>end customers</strong> only, not merchants or store staff.</>
              }
            </p>
          </div>

          <div className="section">
            <h2>{isZh ? "数据用途" : "Data usage"}</h2>
            <h3>{isZh ? "转化追踪（当前版本）" : "Conversion tracking (current version)"}</h3>
            <p>
              {isZh
                ? <>当前版本中，{appName} 仅基于 Shopify Web Pixel 上报的事件收据（PixelEventReceipt）和本地最小化日志，帮助您诊断像素是否正常工作、识别潜在的丢单风险，并在应用内部展示统计和报告。我们<strong>不会</strong>从 Shopify 读取订单明细，也<strong>不会</strong>访问受保护客户数据（Protected Customer Data, PCD）。</>
                : <>In the current version, {appName} relies only on Shopify Web Pixel event receipts (PixelEventReceipt) and minimal local logs to help you diagnose pixel behaviour, identify potential order loss, and show in-app stats and reports. We <strong>do not</strong> read order details from Shopify and <strong>do not</strong> access Protected Customer Data (PCD).</>
              }
            </p>
            <p>
              {isZh
                ? <><strong>Web Pixel 行为说明</strong>：我们的 Web Pixel 代码不会读取 checkout DOM 中的客户个人信息，只依赖 Shopify 提供的标准事件 payload。我们不会尝试通过 Web Pixel 还原客户身份（如邮箱/电话）。</>
                : <><strong>Web Pixel behaviour</strong>: Our Web Pixel does not read customer PII from the checkout DOM; it relies only on Shopify’s standard event payload. We do not attempt to infer customer identity (e.g. email/phone) via the pixel.</>
              }
            </p>

            <div className="warning">
              <p><strong>{isZh ? "重要：当前版本不提供服务端投递" : "Important: current version does not offer server-side delivery"}</strong></p>
              <p>
                {isZh
                  ? "服务端向广告平台投递默认关闭，核心为客户端像素与验收对账。当前版本仅接收并校验 Web Pixel 事件，用于应用内诊断与验收，不向第三方平台发送服务端事件。"
                  : "Server-side delivery to ad platforms is off by default; the focus is client pixels and verification reconciliation. This version only receives and validates Web Pixel events for in-app diagnostics and verification, and does not send server-side events to third parties."
                }
              </p>
            </div>

            <h3>{isZh ? "对账与诊断（当前版本）" : "Reconciliation and diagnostics (current version)"}</h3>
            <p>
              {isZh
                ? <>我们通过比对像素事件收据与内部日志，帮助您发现追踪缺口并优化配置。当用户未给予相应同意导致事件不向任何平台发送时，我们仍可能为去重与诊断目的保存<strong>最小元数据</strong>（如事件键、事件类型、时间戳），但<strong>不会</strong>保存商品明细、金额等敏感内容。当前版本<strong>不会</strong>从 Shopify Admin API 读取订单数据进行对账。</>
                : <>We compare pixel event receipts with internal logs to help you find tracking gaps and optimize configuration. When events are not sent to any platform due to lack of consent, we may still store <strong>minimal metadata</strong> (e.g. event key, type, timestamp) for dedup and diagnostics, but <strong>do not</strong> store product details, amounts or other sensitive content. This version <strong>does not</strong> read order data from Shopify Admin API for reconciliation.</>
              }
            </p>

            <h3>{isZh ? "合规执行" : "Compliance"}</h3>
            <p>{isZh ? "根据客户的同意状态（Shopify " : "Based on customer consent state (Shopify "}<code>customerPrivacy</code>){isZh ? "），自动决定是否向特定平台发送事件，确保符合 GDPR/CCPA 等隐私法规。" : "), we automatically decide whether to send events to specific platforms, ensuring GDPR/CCPA compliance."}</p>

            <h3>{isZh ? "与 PCD（受保护客户数据）的关系" : "Relationship with PCD (Protected Customer Data)"}</h3>
            <p>
              {isZh
                ? <>当前公开上架版本<strong>不访问</strong> Shopify Protected Customer Data (PCD)。我们不请求 <code>read_orders</code>，不订阅订单 webhook，不通过 Admin API 读取订单或客户详情，仅基于 Web Pixel 事件收据进行诊断与验收。未来如引入基于订单详情的验收/对账或再购等功能，将在获得 Shopify PCD 审批后启用，并更新本隐私政策与应用内说明。</>
                : <>The current public version <strong>does not access</strong> Shopify Protected Customer Data (PCD). We do not request <code>read_orders</code>, do not subscribe to order webhooks, and do not read orders or customer details via Admin API; we rely only on Web Pixel event receipts for diagnostics and verification. Any future features that use order-level verification, reconciliation or repurchase will be enabled only after Shopify PCD approval, with updated privacy policy and in-app documentation.</>
              }
            </p>
          </div>

          <div className="section">
            <h2>{isZh ? "数据保留" : "Data retention"}</h2>
            <p>{isZh ? "我们遵循数据最小化原则，仅保存必要的数据，并定期清理过期数据。所有数据类型的保留周期由店铺的数据保留设置控制（默认 90 天）：" : "We follow data minimization and regularly clean expired data. Retention for all data types is controlled by the store’s data retention settings (default 90 days):"}</p>
            <ul>
              <li><strong>PixelEventReceipt</strong>{isZh ? "（像素收据）：按店铺数据保留周期（默认 90 天）" : ": per store data retention (default 90 days)"}</li>
              <li><strong>VerificationRun</strong>{isZh ? "（验收运行）：按店铺数据保留周期（默认 90 天）" : ": per store data retention (default 90 days)"}</li>
              <li><strong>ScanReport</strong>{isZh ? "（扫描报告）：按店铺数据保留周期（默认 90 天）" : ": per store data retention (default 90 days)"}</li>
              <li><strong>EventLog / AuditLog</strong>{isZh ? "（事件与审计日志）：按店铺数据保留周期（默认 90 天）；审计日志至少 180 天或取较大值" : ": per store data retention (default 90 days); audit logs at least 180 days or greater"}</li>
            </ul>
          </div>

          <div className="section">
            <h2>{isZh ? "数据删除" : "Data deletion"}</h2>
            <p>{isZh ? "我们支持多种数据删除方式：" : "We support multiple deletion methods:"}</p>
            <ul>
              <li><strong>{isZh ? "卸载应用" : "Uninstall app"}</strong>{isZh ? "：收到 " : ": on "}<code>APP_UNINSTALLED</code>{isZh ? " webhook 后，立即标记为 inactive，并在 48 小时内由定时清理任务删除所有数据" : " webhook we mark as inactive and delete all data within 48 hours"}</li>
              <li><strong>{isZh ? "GDPR 客户数据删除请求" : "GDPR customer data deletion"}</strong>{isZh ? "：响应 " : ": we respond to "}<code>CUSTOMERS_DATA_REQUEST</code> {isZh ? "或 " : "or "}<code>CUSTOMERS_REDACT</code> webhook</li>
              <li><strong>{isZh ? "店铺数据删除请求" : "Shop data deletion"}</strong>{isZh ? "：响应 " : ": we respond to "}<code>SHOP_REDACT</code> webhook</li>
            </ul>
          </div>

          <div className="section">
            <h2>{isZh ? "第三方共享" : "Third-party sharing"}</h2>
            <h3>{isZh ? "第三方共享" : "Third-party sharing"}</h3>
            <p>{isZh ? "当前版本不向第三方平台发送服务端转化事件。告警通知功能也处于禁用状态。" : "The current version does not send server-side conversion events to third-party platforms. Alert notifications are disabled."}</p>
            <h3>{isZh ? "通知与告警服务（当前版本已禁用）" : "Notifications and alerts (current version disabled)"}</h3>
            <p>{isZh ? "当前版本中，告警通知功能已禁用。以下服务仅在将来版本或商家显式启用告警功能时使用：" : "In the current version, alert notifications are disabled. The following are used only in future versions or when the merchant explicitly enables alerts:"}</p>
            <ul>
              <li><strong>Slack Webhook</strong>{isZh ? "：仅在启用 Slack 告警时使用，发送 JSON 格式的告警数据（店铺域名、告警类型、聚合指标、报告链接）。仅商家级运营数据，不包含订单明细或终端客户信息。" : ": sends JSON alert data (store domain, alert type, aggregated metrics, report link). Merchant-level data only; no order details or end-customer information."}</li>
              <li><strong>Telegram Bot API</strong>{isZh ? "：仅在启用 Telegram 告警时使用，发送店铺维度告警摘要与指标。不包含订单明细与终端客户信息。" : ": sends store-level alert summaries and metrics. No order details or end-customer information."}</li>
            </ul>
          </div>

          <div className="section">
            <h2>{isZh ? "安全措施" : "Security measures"}</h2>
            <ul>
              <li><strong>{isZh ? "传输加密" : "Transport encryption"}</strong>{isZh ? "：所有 API 通信均使用 TLS 1.2+ 加密" : ": all API communication uses TLS 1.2+"}</li>
              <li><strong>{isZh ? "存储加密" : "Credential encryption"}</strong>{isZh ? "：平台凭证、访问令牌使用 AES-256-GCM 加密存储" : ": platform credentials and access tokens stored with AES-256-GCM"}</li>
              <li><strong>{isZh ? "访问控制" : "Access control"}</strong>{isZh ? "：通过 Shopify OAuth 验证，确保只有授权的店铺管理员可以访问数据" : ": verified via Shopify OAuth; only authorized store admins can access data"}</li>
              <li><strong>{isZh ? "日志脱敏" : "Log redaction"}</strong>{isZh ? "：所有日志自动脱敏，敏感信息会被替换为 " : ": all logs are redacted; sensitive data replaced with "}<code>[REDACTED]</code></li>
              <li><strong>{isZh ? "防重放攻击" : "Replay protection"}</strong>{isZh ? "：像素事件使用 HMAC 签名、时间窗验证和 nonce 防重放机制" : ": pixel events use HMAC, time-window validation and nonce to prevent replay"}</li>
            </ul>
          </div>

          <div className="section">
            <h2>{isZh ? "数据主体权利" : "Data subject rights"}</h2>
            <p>{isZh ? "根据 GDPR 和 CCPA，您享有以下权利：" : "Under GDPR and CCPA you have the right to:"}</p>
            <ul>
              <li><strong>{isZh ? "访问权" : "Access"}</strong>{isZh ? "：有权了解我们收集了哪些数据" : ": know what data we collect"}</li>
              <li><strong>{isZh ? "删除权" : "Deletion"}</strong>{isZh ? "：有权要求删除您的数据" : ": request deletion of your data"}</li>
              <li><strong>{isZh ? "更正权" : "Correction"}</strong>{isZh ? "：有权更正不准确的数据" : ": correct inaccurate data"}</li>
              <li><strong>{isZh ? "数据可携带权" : "Portability"}</strong>{isZh ? "：有权以结构化格式获取您的数据" : ": receive your data in a structured format"}</li>
              <li><strong>{isZh ? "反对权" : "Objection"}</strong>{isZh ? "：有权反对数据处理" : ": object to processing"}</li>
            </ul>
            <p>{isZh ? "本应用通过 Shopify GDPR webhooks 自动处理这些请求。" : "This app handles these requests automatically via Shopify GDPR webhooks."}</p>
          </div>

          <div className="section">
            <h2>{isZh ? "完整合规文档" : "Full compliance documentation"}</h2>
            <p>{isZh ? "更多说明见应用内「隐私与合规」页。另见 " : "For more see the in-app Privacy & compliance page. See also "}<a href="/terms">{isZh ? "服务条款" : "Terms of Service"}</a>.</p>
          </div>

          <div className="section">
            <h2>{isZh ? "联系方式" : "Contact"}</h2>
            <p>{isZh ? "如有任何关于数据处理或隐私的问题，请通过 Shopify App 内支持渠道联系我们。" : "For any questions about data processing or privacy, contact us via the in-app support channel."}</p>
          </div>
        </div>
    </>
  );
}
