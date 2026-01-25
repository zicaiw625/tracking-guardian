import { Resend } from "resend";
import type { AlertData, AlertConfig, EmailAlertSettings, SlackAlertSettings, TelegramAlertSettings, } from "../types";
import { decryptJson } from "../utils/crypto.server";
import { logger } from "../utils/logger.server";
import { CONFIG } from "../utils/config.server";
import {
  asEmailAlertSettings,
  asSlackAlertSettings,
  asTelegramAlertSettings,
} from "../utils/type-guards";
const resend = CONFIG.getEnv("RESEND_API_KEY")
    ? new Resend(CONFIG.getEnv("RESEND_API_KEY"))
    : null;
const getAppUrl = (): string => {
    return CONFIG.getEnv("SHOPIFY_APP_URL", "https://app.tracking-guardian.com");
};
const getEmailSender = (): string => {
    return CONFIG.getEnv("EMAIL_SENDER", "Tracking Guardian <alerts@tracking-guardian.app>");
};
interface AlertConfigWithEncryption extends AlertConfig {
    settingsEncrypted?: string | null;
}
function getDecryptedSettings(config: AlertConfigWithEncryption): Record<string, unknown> | null {
    if (config.settingsEncrypted) {
        try {
            return decryptJson<Record<string, unknown>>(config.settingsEncrypted);
        }
        catch (error) {
            logger.error(`Failed to decrypt settings for alert config ${config.id}`, error);
        }
    }
    if (config.settings && typeof config.settings === "object") {
        logger.warn(`[P0-2] Using legacy plain settings for alert config - migration needed`);
        if (typeof config.settings === "object" && config.settings !== null && !Array.isArray(config.settings)) {
            return config.settings as unknown as Record<string, unknown>;
        }
    }
    return null;
}
export async function sendAlert(config: AlertConfigWithEncryption, data: AlertData): Promise<boolean> {
    try {
        const settings = getDecryptedSettings(config);
        if (!settings) {
            logger.error(`No valid settings found for alert config ${config.id}`);
            return false;
        }
        switch (config.channel) {
            case "email": {
                const emailSettings = asEmailAlertSettings(settings);
                if (!emailSettings) {
                    logger.error(`Invalid email settings for alert config ${config.id}`);
                    return false;
                }
                return await sendEmailAlert(emailSettings, data);
            }
            case "slack": {
                const slackSettings = asSlackAlertSettings(settings);
                if (!slackSettings) {
                    logger.error(`Invalid slack settings for alert config ${config.id}`);
                    return false;
                }
                return await sendSlackAlert(slackSettings, data);
            }
            case "telegram": {
                const telegramSettings = asTelegramAlertSettings(settings);
                if (!telegramSettings) {
                    logger.error(`Invalid telegram settings for alert config ${config.id}`);
                    return false;
                }
                return await sendTelegramAlert(telegramSettings, data);
            }
            default:
                logger.warn(`Unknown alert channel: ${config.channel}`);
                return false;
        }
    }
    catch (error) {
        logger.error(`Failed to send ${config.channel} alert`, error);
        return false;
    }
}
async function sendEmailAlert(settings: EmailAlertSettings, data: AlertData): Promise<boolean> {
    if (!resend) {
        logger.warn("Resend not configured, skipping email alert");
        return false;
    }
    const discrepancyPercent = (data.orderDiscrepancy * 100).toFixed(1);
    const dateStr = data.reportDate.toLocaleDateString("zh-CN");
    const appUrl = getAppUrl();
    
    const isEventDeliveryAlert = data.platform.includes("失败率") || data.platform.includes("缺失参数") || data.platform.includes("事件量下降");
    const alertTitle = isEventDeliveryAlert ? "事件发送异常警报" : "追踪异常警报";
    const alertDescription = isEventDeliveryAlert 
        ? `您的店铺 <strong>${data.shopDomain}</strong> 的事件发送出现异常：`
        : `您的店铺 <strong>${data.shopDomain}</strong> 的追踪数据出现异常：`;
    
    const metricLabel1 = isEventDeliveryAlert ? "总事件数" : "Shopify 订单数";
    const metricLabel2 = isEventDeliveryAlert ? "成功发送数" : "像素事件捕获数";
    const metricDescription = isEventDeliveryAlert
        ? "此指标反映事件从我们的服务端到广告平台 API 的投递情况。"
        : "此数据基于我们捕获的像素事件，非广告平台后台真实转化数。";
    
    const possibleCauses = isEventDeliveryAlert
        ? [
            "<li>平台 API 连接问题或限流</li>",
            "<li>服务端配置错误（API 密钥、端点等）</li>",
            "<li>网络不稳定导致发送失败</li>",
            "<li>平台 API 返回错误</li>",
          ]
        : [
            "<li>追踪代码未正确触发</li>",
            "<li>浏览器隐私设置阻止了追踪</li>",
            "<li>广告拦截器影响</li>",
            "<li>Checkout Extensibility 迁移问题</li>",
          ];
    
    const suggestedActions = isEventDeliveryAlert
        ? [
            "<li>检查平台 API 凭证配置是否正确</li>",
            "<li>查看交付健康度报告中的失败原因</li>",
            "<li>验证网络连接和平台 API 状态</li>",
            "<li>检查服务端日志中的错误信息</li>",
          ]
        : [
            "<li>检查 Web Pixel 是否正常工作</li>",
            "<li>查看对账数据报告</li>",
            "<li>验证像素事件是否正确触发</li>",
            "<li>考虑启用服务端转化 API</li>",
          ];
    
    const { error } = await resend.emails.send({
        from: getEmailSender(),
        to: settings.email,
        subject: `⚠️ ${alertTitle} - ${data.platform} (${data.shopDomain})`,
        html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d72c0d;">⚠️ ${alertTitle}</h2>
        <p>${alertDescription}</p>
        <div style="background: #f6f6f7; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 8px 0;"><strong>日期：</strong>${dateStr}</p>
          <p style="margin: 8px 0;"><strong>${metricLabel1}：</strong>${data.shopifyOrders}</p>
          <p style="margin: 8px 0;"><strong>${metricLabel2}：</strong>${data.platformConversions}</p>
          <p style="margin: 8px 0; color: #d72c0d;"><strong>异常率：</strong>${discrepancyPercent}%</p>
          <p style="margin: 8px 0; color: #6d7175; font-size: 12px;">${metricDescription}</p>
        </div>
        <p>可能的原因：</p>
        <ul>
          ${possibleCauses.join("\n          ")}
        </ul>
        <p>建议操作：</p>
        <ol>
          ${suggestedActions.join("\n          ")}
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
import { fetchWithTimeout } from "./platforms/interface";

function validateSlackWebhookUrl(raw: string): { ok: boolean; reason?: string } {
    try {
        const u = new URL(raw);
        if (u.protocol !== "https:") return { ok: false, reason: "https_required" };
        if (u.hostname !== "hooks.slack.com") return { ok: false, reason: "host_not_allowed" };
        if (!u.pathname.startsWith("/services/") && !u.pathname.startsWith("/triggers/")) {
            return { ok: false, reason: "path_not_allowed" };
        }
        return { ok: true };
    } catch {
        return { ok: false, reason: "invalid_url" };
    }
}

async function sendSlackAlert(settings: SlackAlertSettings, data: AlertData): Promise<boolean> {
    const validation = validateSlackWebhookUrl(settings.webhookUrl);
    if (!validation.ok) {
        logger.warn(`Invalid Slack webhook URL`, { reason: validation.reason });
        return false;
    }
    const discrepancyPercent = (data.orderDiscrepancy * 100).toFixed(1);
    const dateStr = data.reportDate.toLocaleDateString("zh-CN");
    const appUrl = getAppUrl();
    
    const isEventDeliveryAlert = data.platform.includes("失败率") || data.platform.includes("缺失参数") || data.platform.includes("事件量下降");
    const alertTitle = isEventDeliveryAlert ? "⚠️ 事件发送异常警报" : "⚠️ 追踪异常警报";
    const metricLabel1 = isEventDeliveryAlert ? "总事件数" : "Shopify 订单";
    const metricLabel2 = isEventDeliveryAlert ? "成功发送数" : "像素事件捕获数";
    
    const payload = {
        blocks: [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: alertTitle,
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
                        text: `*告警类型:*\n${data.platform}`,
                    },
                    {
                        type: "mrkdwn",
                        text: `*日期:*\n${dateStr}`,
                    },
                    {
                        type: "mrkdwn",
                        text: `*异常率:*\n${discrepancyPercent}%`,
                    },
                ],
            },
            {
                type: "section",
                fields: [
                    {
                        type: "mrkdwn",
                        text: `*${metricLabel1}:*\n${data.shopifyOrders}`,
                    },
                    {
                        type: "mrkdwn",
                        text: `*${metricLabel2}:*\n${data.platformConversions}`,
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
    try {
        const response = await fetchWithTimeout(settings.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        return response.ok;
    } catch (error) {
        logger.error("Failed to send Slack alert", {
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
async function sendTelegramAlert(settings: TelegramAlertSettings, data: AlertData): Promise<boolean> {
    const botToken = settings.botToken.trim();
    const chatId = settings.chatId.trim();
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken) || chatId.length === 0) {
        logger.warn("Invalid Telegram settings", { reason: "invalid_format" });
        return false;
    }
    const discrepancyPercent = (data.orderDiscrepancy * 100).toFixed(1);
    const dateStr = data.reportDate.toLocaleDateString("zh-CN");
    
    const isEventDeliveryAlert = data.platform.includes("失败率") || data.platform.includes("缺失参数") || data.platform.includes("事件量下降");
    const alertTitle = isEventDeliveryAlert ? "⚠️ *事件发送异常警报*" : "⚠️ *追踪异常警报*";
    const metricLabel1 = isEventDeliveryAlert ? "总事件数" : "Shopify 订单";
    const metricLabel2 = isEventDeliveryAlert ? "成功发送数" : "像素事件捕获数";
    
    const message = `
${alertTitle}
🏪 店铺: \`${data.shopDomain}\`
📊 告警类型: ${data.platform}
📅 日期: ${dateStr}
📦 ${metricLabel1}: ${data.shopifyOrders}
✅ ${metricLabel2}: ${data.platformConversions}
📉 异常率: *${discrepancyPercent}%*
请及时检查配置！
  `.trim();
    try {
        const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: "Markdown",
            }),
        });
        return response.ok;
    } catch (error) {
        logger.error("Failed to send Telegram alert", {
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
export async function testNotification(channel: string, settings: EmailAlertSettings | SlackAlertSettings | TelegramAlertSettings): Promise<{
    success: boolean;
    message: string;
}> {
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
    }
    catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : "发送失败",
        };
    }
}
