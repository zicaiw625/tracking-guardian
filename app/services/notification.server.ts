import { Resend } from "resend";
import type {
  AlertData,
  AlertConfig,
  EmailAlertSettings,
  SlackAlertSettings,
  TelegramAlertSettings,
} from "../types";
import { decryptJson } from "../utils/crypto";
import { logger } from "../utils/logger";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const getAppUrl = (): string => {
  return process.env.SHOPIFY_APP_URL || "https://your-app-url.com";
};

const getEmailSender = (): string => {
  return process.env.EMAIL_SENDER || "Tracking Guardian <alerts@tracking-guardian.app>";
};

interface AlertConfigWithEncryption extends AlertConfig {
  settingsEncrypted?: string | null;
}

function getDecryptedSettings(config: AlertConfigWithEncryption): Record<string, unknown> | null {
  if (config.settingsEncrypted) {
    try {
      return decryptJson<Record<string, unknown>>(config.settingsEncrypted);
    } catch (error) {
      logger.error(`Failed to decrypt settings for alert config ${config.id}`, error);
    }
  }
  
  if (config.settings && typeof config.settings === "object") {
    logger.warn(`[P0-2] Using legacy plain settings for alert config - migration needed`);
    return config.settings as unknown as Record<string, unknown>;
  }
  
  return null;
}

export async function sendAlert(
  config: AlertConfigWithEncryption,
  data: AlertData
): Promise<boolean> {
  try {
    const settings = getDecryptedSettings(config);
    if (!settings) {
      logger.error(`No valid settings found for alert config ${config.id}`);
      return false;
    }

    switch (config.channel) {
      case "email":
        return await sendEmailAlert(settings as unknown as EmailAlertSettings, data);
      case "slack":
        return await sendSlackAlert(settings as unknown as SlackAlertSettings, data);
      case "telegram":
        return await sendTelegramAlert(settings as unknown as TelegramAlertSettings, data);
      default:
        logger.warn(`Unknown alert channel: ${config.channel}`);
        return false;
    }
  } catch (error) {
    logger.error(`Failed to send ${config.channel} alert`, error);
    return false;
  }
}

async function sendEmailAlert(
  settings: EmailAlertSettings,
  data: AlertData
): Promise<boolean> {
  if (!resend) {
    logger.warn("Resend not configured, skipping email alert");
    return false;
  }

  const discrepancyPercent = (data.orderDiscrepancy * 100).toFixed(1);
  const dateStr = data.reportDate.toLocaleDateString("zh-CN");
  const appUrl = getAppUrl();

  const { error } = await resend.emails.send({
    from: getEmailSender(),
    to: settings.email,
    subject: `⚠️ 追踪异常警报 - ${data.platform} 平台 (${data.shopDomain})`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d72c0d;">⚠️ 追踪异常警报</h2>
        
        <p>您的店铺 <strong>${data.shopDomain}</strong> 在 <strong>${data.platform}</strong> 平台的追踪数据出现异常：</p>
        
        <div style="background: #f6f6f7; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 8px 0;"><strong>日期：</strong>${dateStr}</p>
          <p style="margin: 8px 0;"><strong>Shopify 订单数：</strong>${data.shopifyOrders}</p>
          <p style="margin: 8px 0;"><strong>平台记录转化数：</strong>${data.platformConversions}</p>
          <p style="margin: 8px 0; color: #d72c0d;"><strong>差异率：</strong>${discrepancyPercent}%</p>
        </div>
        
        <p>可能的原因：</p>
        <ul>
          <li>追踪代码未正确触发</li>
          <li>浏览器隐私设置阻止了追踪</li>
          <li>广告拦截器影响</li>
          <li>Checkout Extensibility 迁移问题</li>
        </ul>
        
        <p>建议操作：</p>
        <ol>
          <li>检查 Web Pixel 是否正常工作</li>
          <li>查看广告平台的事件管理器</li>
          <li>考虑启用服务端转化 API</li>
        </ol>
        
        <p style="margin-top: 24px;">
          <a href="${appUrl}/app/monitor" 
             style="background: #008060; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
            查看详细报告
          </a>
        </p>
        
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #e1e3e5;" />
        <p style="color: #6d7175; font-size: 12px;">
          此邮件由 Tracking Guardian 自动发送。如需调整警报设置，请前往应用设置页面。
        </p>
      </div>
    `,
  });

  if (error) {
    logger.error("Email send error", error);
    return false;
  }

  return true;
}

async function sendSlackAlert(
  settings: SlackAlertSettings,
  data: AlertData
): Promise<boolean> {
  const discrepancyPercent = (data.orderDiscrepancy * 100).toFixed(1);
  const dateStr = data.reportDate.toLocaleDateString("zh-CN");
  const appUrl = getAppUrl();

  const payload = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "⚠️ 追踪异常警报",
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*店铺:*\n${data.shopDomain}`,
          },
          {
            type: "mrkdwn",
            text: `*平台:*\n${data.platform}`,
          },
          {
            type: "mrkdwn",
            text: `*日期:*\n${dateStr}`,
          },
          {
            type: "mrkdwn",
            text: `*差异率:*\n${discrepancyPercent}%`,
          },
        ],
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Shopify 订单:*\n${data.shopifyOrders}`,
          },
          {
            type: "mrkdwn",
            text: `*平台转化:*\n${data.platformConversions}`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "查看详细报告",
            },
            url: `${appUrl}/app/monitor`,
            style: "primary",
          },
        ],
      },
    ],
  };

  const response = await fetch(settings.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return response.ok;
}

async function sendTelegramAlert(
  settings: TelegramAlertSettings,
  data: AlertData
): Promise<boolean> {
  const discrepancyPercent = (data.orderDiscrepancy * 100).toFixed(1);
  const dateStr = data.reportDate.toLocaleDateString("zh-CN");

  const message = `
⚠️ *追踪异常警报*

🏪 店铺: \`${data.shopDomain}\`
📊 平台: ${data.platform}
📅 日期: ${dateStr}

📦 Shopify 订单: ${data.shopifyOrders}
✅ 平台转化: ${data.platformConversions}
📉 差异率: *${discrepancyPercent}%*

请及时检查追踪配置！
  `.trim();

  const response = await fetch(
    `https://api.telegram.org/bot${settings.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: settings.chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    }
  );

  return response.ok;
}

export async function testNotification(
  channel: string,
  settings: EmailAlertSettings | SlackAlertSettings | TelegramAlertSettings
): Promise<{ success: boolean; message: string }> {
  const testData: AlertData = {
    platform: "测试平台",
    reportDate: new Date(),
    shopifyOrders: 100,
    platformConversions: 85,
    orderDiscrepancy: 0.15,
    revenueDiscrepancy: 0.12,
    shopDomain: "test-shop.myshopify.com",
  };

  try {
    let success = false;

    switch (channel) {
      case "email":
        success = await sendEmailAlert(settings as EmailAlertSettings, testData);
        break;
      case "slack":
        success = await sendSlackAlert(settings as SlackAlertSettings, testData);
        break;
      case "telegram":
        success = await sendTelegramAlert(settings as TelegramAlertSettings, testData);
        break;
      default:
        return { success: false, message: "未知的通知渠道" };
    }

    return {
      success,
      message: success ? "测试通知发送成功！" : "发送失败，请检查配置",
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "发送失败",
    };
  }
}

