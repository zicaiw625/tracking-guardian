import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDynamicCorsHeaders } from "../utils/cors";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";
import { useTranslation, Trans, I18nextProvider } from "react-i18next";
import i18n from "../i18n"; // Import global i18n instance

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

function PrivacyContent() {
  const { t, i18n: i18nInstance } = useTranslation();
  const { appName, appDomain, lastUpdated } = useLoaderData<typeof loader>();

  return (
    <html lang={i18nInstance.language || "zh-CN"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{t("PublicPrivacy.Title")} - {appName}</title>
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
          <h1>{t("PublicPrivacy.Title")}</h1>
          <div className="meta">
            <p><strong>{t("PublicPrivacy.Meta.AppName")}：</strong>{appName}</p>
            <p><strong>{t("PublicPrivacy.Meta.LastUpdated")}：</strong>{lastUpdated}</p>
            <p><strong>{t("PublicPrivacy.Meta.AppDomain")}：</strong><a href={appDomain}>{appDomain}</a></p>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Overview.Title")}</h2>
            <p>
              <Trans i18nKey="PublicPrivacy.Overview.Content" values={{ appName }} />
            </p>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.CollectedData.Title")}</h2>
            <h3>{t("PublicPrivacy.CollectedData.Orders")}</h3>
            <ul>
              <li>订单 ID 和订单号</li>
              <li>订单金额和货币</li>
              <li>商品信息（名称、数量、价格、SKU）</li>
              <li>结账令牌（用于匹配像素事件，已哈希处理）</li>
            </ul>

            <h3>{t("PublicPrivacy.CollectedData.Consent")}</h3>
            <ul>
              <li>marketing: 是否同意营销追踪</li>
              <li>analytics: 是否同意分析追踪</li>
              <li>saleOfData: 是否允许数据销售（CCPA）</li>
            </ul>

            <h3>{t("PublicPrivacy.CollectedData.NoPII")}</h3>
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

            <h3>{t("PublicPrivacy.CollectedData.TechData")}</h3>
            <p>
              为安全、反作弊与验收目的，我们可能存储与请求相关的技术数据（如 IP 地址、User-Agent、page_url、referrer），保留周期与店铺数据保留设置一致，删除方式同 GDPR/webhook 删除策略。
            </p>

            <h3>{t("PublicPrivacy.CollectedData.Session")}</h3>
            <p>
              为完成 Shopify 鉴权与会话管理，我们可能存储<strong>店铺管理员或员工的标识信息</strong>（例如邮箱）作为会话（Session）数据的一部分。来源为 Shopify OAuth，用途为鉴权与会话维持，保留周期随 Session 过期或按 Shopify 会话策略。前述「不收集的数据」仅针对<strong>终端客户</strong>，不针对商家或店铺员工。
            </p>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Usage.Title")}</h2>
            <h3>{t("PublicPrivacy.Usage.Tracking")}</h3>
            <p>
              当前版本中，{appName} 仅基于 Shopify Web Pixel 上报的事件收据（PixelEventReceipt）和本地最小化日志，
              帮助您诊断像素是否正常工作、识别潜在的丢单风险，并在应用内部展示统计和报告。
              我们<strong>不会</strong>从 Shopify 读取订单明细，也<strong>不会</strong>访问受保护客户数据（Protected Customer Data, PCD）。
            </p>
            <p>
              <strong>Web Pixel 行为说明</strong>：我们的 Web Pixel 代码不会读取 checkout DOM 中的客户个人信息，只依赖 Shopify 提供的标准事件 payload。我们不会尝试通过 Web Pixel 还原客户身份（如邮箱/电话）。
            </p>

            <div className="warning">
              <p><strong>重要：当前版本不提供服务端投递</strong></p>
              <p>
                服务端向广告平台投递默认关闭，核心为客户端像素与验收对账。当前版本仅接收并校验 Web Pixel 事件，用于应用内诊断与验收，不向第三方平台发送服务端事件。
              </p>
            </div>

            <h3>{t("PublicPrivacy.Usage.Reconciliation")}</h3>
            <p>
              我们通过比对像素事件收据与内部日志，帮助您发现追踪缺口并优化配置。当用户未给予相应同意导致事件不向任何平台发送时，
              我们仍可能为去重与诊断目的保存<strong>最小元数据</strong>（如事件键、事件类型、时间戳），但<strong>不会</strong>保存商品明细、金额等敏感内容。
              当前版本<strong>不会</strong>从 Shopify Admin API 读取订单数据进行对账。
            </p>

            <h3>{t("PublicPrivacy.Usage.Compliance")}</h3>
            <p>根据客户的同意状态（Shopify <code>customerPrivacy</code>），自动决定是否向特定平台发送事件，确保符合 GDPR/CCPA 等隐私法规。</p>

            <h3>{t("PublicPrivacy.Usage.PCD")}</h3>
            <p>
              当前公开上架版本<strong>不访问</strong> Shopify Protected Customer Data (PCD)。我们不请求 <code>read_orders</code>，不订阅订单 webhook，不通过 Admin API 读取订单或客户详情，仅基于 Web Pixel 事件收据进行诊断与验收。
              未来如引入基于订单详情的验收/对账或再购等功能，将在获得 Shopify PCD 审批后启用，并更新本隐私政策与应用内说明。
            </p>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Retention.Title")}</h2>
            <p>{t("PublicPrivacy.Retention.Content")}</p>
            <ul>
              <li><strong>PixelEventReceipt（像素收据）</strong>：按店铺数据保留周期（默认 90 天）</li>
              <li><strong>VerificationRun（验收运行）</strong>：按店铺数据保留周期（默认 90 天）</li>
              <li><strong>ScanReport（扫描报告）</strong>：按店铺数据保留周期（默认 90 天）</li>
              <li><strong>EventLog / AuditLog（事件与审计日志）</strong>：按店铺数据保留周期（默认 90 天）；审计日志至少 180 天或取较大值</li>
            </ul>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Deletion.Title")}</h2>
            <p>{t("PublicPrivacy.Deletion.Content")}</p>
            <ul>
              <li><strong>卸载应用</strong>：收到 <code>APP_UNINSTALLED</code> webhook 后，立即标记为 inactive，并在 48 小时内由定时清理任务删除所有数据</li>
              <li><strong>GDPR 客户数据删除请求</strong>：响应 <code>CUSTOMERS_DATA_REQUEST</code> 或 <code>CUSTOMERS_REDACT</code> webhook</li>
              <li><strong>店铺数据删除请求</strong>：响应 <code>SHOP_REDACT</code> webhook，立即删除所有数据</li>
            </ul>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Sharing.Title")}</h2>
            <h3>{t("PublicPrivacy.Sharing.Title")}</h3>
            <p>
              {t("PublicPrivacy.Sharing.Content")}
            </p>
            <h3>通知与告警服务（当前版本已禁用）</h3>
            <p>
              当前版本中，告警通知功能已禁用。以下服务仅在将来版本或商家显式启用告警功能时使用：
            </p>
            <ul>
              <li><strong>Slack Webhook</strong>：仅在启用 Slack 告警时使用，发送 JSON 格式的告警数据（店铺域名、告警类型、聚合指标、报告链接）。仅商家级运营数据，不包含订单明细或终端客户信息。</li>
              <li><strong>Telegram Bot API</strong>：仅在启用 Telegram 告警时使用，发送店铺维度告警摘要与指标。不包含订单明细与终端客户信息。</li>
            </ul>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Security.Title")}</h2>
            <ul>
              <li><strong>传输加密</strong>：所有 API 通信均使用 TLS 1.2+ 加密</li>
              <li><strong>存储加密</strong>：平台凭证、访问令牌使用 AES-256-GCM 加密存储</li>
              <li><strong>访问控制</strong>：通过 Shopify OAuth 验证，确保只有授权的店铺管理员可以访问数据</li>
              <li><strong>日志脱敏</strong>：所有日志自动脱敏，敏感信息会被替换为 <code>[REDACTED]</code></li>
              <li><strong>防重放攻击</strong>：像素事件使用 HMAC 签名、时间窗验证和 nonce 防重放机制</li>
            </ul>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Rights.Title")}</h2>
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
            <h2>{t("PublicPrivacy.Docs.Title")}</h2>
            <p>{t("PublicPrivacy.Docs.Content")} 另见 <a href="/terms">服务条款</a>。</p>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Contact.Title")}</h2>
            <p>
              {t("PublicPrivacy.Contact.Content")}
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}

export default function PrivacyPage() {
  return (
    <I18nextProvider i18n={i18n}>
      <PrivacyContent />
    </I18nextProvider>
  );
}
