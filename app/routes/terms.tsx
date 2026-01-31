import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDynamicCorsHeaders } from "../utils/cors";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";
import { getSupportConfig } from "../utils/config.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsHeaders = getDynamicCorsHeaders(request);
  const support = getSupportConfig();
  const response = json({
    appName: "Tracking Guardian",
    appDomain: process.env.SHOPIFY_APP_URL || process.env.APP_URL || "https://tracking-guardian.onrender.com",
    lastUpdated: "2025-01-15",
    contactEmail: support.contactEmail,
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

export default function TermsPage() {
  const { appName, appDomain, lastUpdated, contactEmail } = useLoaderData<typeof loader>();

  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>服务条款 - {appName}</title>
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
          <h1>服务条款</h1>
          <div className="meta">
            <p><strong>应用名称：</strong>{appName}</p>
            <p><strong>最后更新：</strong>{lastUpdated}</p>
            <p><strong>应用域名：</strong><a href={appDomain}>{appDomain}</a></p>
          </div>

          <div className="section">
            <h2>1. 服务描述</h2>
            <p>
              {appName} 是一款 Shopify 应用，为商家提供 Web Pixel 迁移、验收与诊断服务。
              包括但不限于：迁移辅助、像素事件验收、追踪缺口监测、扫描与报告功能。
              具体功能以应用内实际提供为准，我们保留在不影响核心服务的前提下调整功能的权利。
            </p>
          </div>

          <div className="section">
            <h2>2. 接受条款</h2>
            <p>
              安装或使用 {appName} 即表示您同意受本服务条款约束。
              如不同意本条款，请勿安装或使用本应用。我们可能不时更新本条款，更新后的条款将在本页面发布，继续使用即视为接受更新。
            </p>
          </div>

          <div className="section">
            <h2>3. 使用条件</h2>
            <p>
              您需确保：(a) 拥有在 Shopify 平台运营店铺的合法权利；(b) 遵守 Shopify 平台规则及适用法律法规；
              (c) 提供的店铺信息真实、准确；(d) 不得利用本应用从事任何非法、欺诈或侵权活动。
              我们保留在发现违规行为时暂停或终止服务的权利。
            </p>
          </div>

          <div className="section">
            <h2>4. 免责声明</h2>
            <p>
              本应用按「现状」提供，不提供任何形式的明示或暗示保证。在法律允许的最大范围内，
              我们不对因使用或无法使用本应用而产生的任何直接、间接、附带、特殊或后果性损害承担责任，
              包括但不限于利润损失、数据丢失、业务中断等。我们不对第三方服务（如 Shopify、广告平台）的可用性、准确性负责。
            </p>
          </div>

          <div className="section">
            <h2>5. 管辖法律</h2>
            <p>
              本服务条款受中华人民共和国法律管辖（如适用），或您所在地的法律管辖。
              因本条款产生的争议，双方应尽量协商解决；协商不成的，可向有管辖权的法院提起诉讼。
            </p>
          </div>

          <div className="section">
            <h2>6. 联系方式与相关文档</h2>
            <p>
              如有任何关于本服务条款的问题，请通过 <a href={`mailto:${contactEmail}`}>{contactEmail}</a> 联系我们。
              请同时参阅我们的 <a href="/privacy">隐私政策</a> 以了解数据处理与隐私合规信息。
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
