import json
import os

EN_PATH = 'app/locales/en.json'
ZH_PATH = 'app/locales/zh.json'

new_keys_en = {
    "Settings": {
        "Security": {
            "Title": "Security Settings",
            "Description": "Manage Pixel event association tokens and data security settings.",
            "IngestionKey": {
                "Title": "Ingestion Key",
                "Description": "Used to associate event requests from Web Pixel. This token helps us:",
                "Benefits": "• Filter misconfigured or invalid requests (noise reduction)\n• Correctly associate pixel events with orders (diagnostics)\n• Identify request sources in multi-store scenarios",
                "SecurityNote": "⚠️ Important Security Note: This token is visible in browser network requests and is NOT a strong security boundary. Real security is provided by multiple layers:",
                "SecurityLayers": "• <strong>TLS Encryption</strong>: All data transmission is encrypted via HTTPS\n• <strong>Origin Verification</strong>: Only accepts requests from Shopify checkout pages (with Referer/ShopDomain fallback)\n• <strong>Integrity Verification Key (HMAC)</strong>: Used for integrity verification and basic abuse prevention\n• <strong>Rate Limiting</strong>: Prevents abuse and abnormal traffic\n• <strong>Data Minimization</strong>: We do not collect, process, or send end-customer PII",
                "BoundaryNote": "<strong>Security Boundary Note:</strong> This token is mainly used for event association and diagnostics. Do not treat this token as a strong security credential.",
                "Status": "Status",
                "Configured": "Configured",
                "TokenConfigured": "Token configured",
                "NotConfigured": "Not Configured",
                "ReinstallPrompt": "Please reinstall the app or click generate token",
                "RotateToken": "Rotate Token",
                "GenerateToken": "Generate Token",
                "EventMode": "Event Reception Validation Mode",
                "Strict": "Strict",
                "Lax": "Lax",
                "StrictDesc": "Origin must be whitelisted",
                "LaxDesc": "Non-whitelisted/HMAC failure may still be accepted",
                "LaxWarning": "Requests from non-whitelisted sources or HMAC verification failures that are not rejected may still be accepted and marked as low trust.",
                "GraceWindow": "<strong>Old token still valid:</strong> Previous token will expire on {{date}}. Until then, both new and old tokens can be used for smooth transition.",
                "GraceWindowEnd": "After the transition period, the old token will automatically expire.",
                "OldTokenExpired": "<strong>Old token expired:</strong> Previous token has been automatically cleaned up.",
                "NoTokenError": "<strong>⚠️ Association token not configured:</strong> Please generate a token immediately.",
                "NoTokenDesc": "When the token is not configured, pixel events can still be received, but integrity signals will decrease.",
                "P0SecurityNote": "⚠️ P0 Security Note: PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY Configuration",
                "P0SecurityDetails": "<strong>Production environment must explicitly set:</strong>\n• <code>PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY</code> env var\n• If set to <code>false</code>, <code>Origin: null</code> requests will be rejected.",
                "IngestionKeyRisk": "<strong>ingestionKey Visibility Risk:</strong>\n• ingestion_key is distributed to pixel client and is a public signal\n• Real order authenticity should rely on Shopify webhook/order reconciliation",
                "MustDoActions": "<strong>Mandatory Actions:</strong>\n• <strong>Regularly rotate ingestionKey</strong> (Recommended every 90 days)\n• <strong>Monitor abnormal event reception patterns</strong>\n• <strong>If abuse suspected, change token immediately</strong>",
                "RotationMechNote": "<strong>Token Rotation Mechanism Description:</strong> When changing token, system automatically saves old token as previousIngestionSecret for 30 minutes grace period.",
                "HowItWorks": "How it works:",
                "HowItWorksDesc": "The server records this token and uses it as an integrity signal. Replacing the token initiates a 30-minute grace window for the old token.",
                "TokenRotationMech": "<strong>Token Rotation Mechanism:</strong>\n• Old token saved as previousIngestionSecret\n• Old token usable for 30 mins\n• System automatically syncs new token to Web Pixel config"
            },
            "HMAC": {
                "Title": "Integrity Verification Monitoring (Last 24 Hours)",
                "Description": "Real-time monitoring of key rotation status and suspicious injection activities.",
                "RotationStatus": "Key Rotation Status",
                "RotateNow": "Rotate Now",
                "LastRotation": "Last Rotation Time",
                "NeverRotated": "Never Rotated",
                "RotationCount": "Rotation Count",
                "GraceWindowActive": "Transition period active: Old key will expire on {{date}}",
                "RotationAdviceTitle": "Suggestion: Regularly rotate keys to improve security",
                "RotationAdviceDesc": "System detected you have not rotated the key. Recommended to rotate every 90 days.",
                "RotationAdviceTip": "💡 After rotation, new key is automatically synced. Old key expires in 30 minutes.",
                "RotationWarning": "⚠️ <strong>Important:</strong> ingestion_key is a weak secret. After rotation, please compare event reception.",
                "OverdueWarningTitle": "Suggestion: Key has not been rotated for over 90 days",
                "OverdueWarningDesc": "Last rotation: {{date}} ({{days}} days ago). Click 'Rotate Now' to start.",
                "SuspiciousInjection": "Suspicious Injection Alert",
                "InvalidSignatures": "Invalid Signature Count",
                "NullOriginRequests": "Null Origin Requests",
                "SuspiciousTotal": "Total Suspicious Activities",
                "LastSuspicious": "Last Suspicious Activity: {{date}}",
                "HighSuspiciousAlert": "⚠️ Massive suspicious activity detected - Immediate action recommended",
                "HighSuspiciousDesc": "System detected {{count}} suspicious activities. Potential key leakage or injection attack.",
                "ImmediateActions": "Immediate Actions:",
                "ActionRotate": "Rotate key immediately",
                "ActionCheckLogs": "Check access logs and event reception records",
                "ActionLeakage": "If key leakage suspected, change token immediately",
                "ActionReview": "Review requests from abnormal sources",
                "ActionMetrics": "Check 'Event Loss Rate' metric",
                "MediumSuspiciousAlert": "⚠️ Suspicious activity detected",
                "MediumSuspiciousDesc": "System detected {{count}} suspicious activities. Consider rotating key if activity increases.",
                "MediumSuspiciousDesc2": "Increasing invalid signatures may be an early sign of key leakage.",
                "NoSuspicious": "✅ No suspicious activity detected in past 24h"
            },
            "DataRetention": {
                "Title": "Data Retention Policy",
                "Description": "Configure data retention period for conversion logs and related records.",
                "Label": "Data Retention Days",
                "Option30": "30 Days (Recommended for high traffic)",
                "Option60": "60 Days",
                "Option90": "90 Days (Default)",
                "Option180": "180 Days",
                "Option365": "365 Days (Max)",
                "HelpText": "Data exceeding this period will be automatically cleaned up",
                "InfoTitle": "Data Retention Description:",
                "InfoDesc": "The following data is controlled by the retention period:",
                "InfoItems": "• <strong>Conversion Log</strong>\n• <strong>Pixel Event Receipt</strong>\n• <strong>Scan Report</strong>\n• <strong>Reconciliation Report</strong>\n• <strong>Failed Tasks</strong>",
                "InfoNote": "Cleanup runs daily. Audit logs retained for 365 days.",
                "MinimizationTitle": "Data Minimization Principle:",
                "MinimizationDesc": "We only store data necessary for conversion tracking.",
                "PIINote": "<strong>About PII:</strong> We do not store customer PII (Name/Email/Phone/Address)."
            },
            "Privacy": {
                "Title": "Pixel Privacy & Consent Logic",
                "Description": "Understand pixel loading strategy and backend filtering logic.",
                "LoadingStrategyTitle": "📋 Pixel Loading Strategy",
                "LoadingStrategyDesc": "Web Pixel Extension loading conditions:",
                "LoadingStrategyItems": "• <strong>analytics = true</strong>: Requires analytics consent\n• <strong>marketing = true</strong>: Requires marketing consent\n• <strong>sale_of_data = \"disabled\"</strong>",
                "StrategyNote": "<strong>Strategy Description:</strong> Pixel loads if analytics OR marketing consent is granted. Backend filters based on platform usage (GA4 vs Meta/TikTok).",
                "BackendFilterTitle": "🔍 Backend Filtering Strategy",
                "BackendFilterDesc": "Backend filters events based on compliance requirements:",
                "BackendFilterItems": "• <strong>GA4</strong>: Requires analytics consent\n• <strong>Meta/TikTok</strong>: Requires marketing consent",
                "DesignReason": "<strong>Why this design?</strong> Improve coverage while ensuring compliance.",
                "ActualEffectTitle": "✅ Actual Effect",
                "ActualEffectDesc": "Based on user consent status, events are routed to appropriate platforms.",
                "ActualEffectItems": "• Analytics only: GA4 only\n• Marketing only: Meta/TikTok only\n• Both: All platforms",
                "ComplianceNote": "Backend filtering ensures GDPR/CCPA compliance.",
                "StatsTitle": "📊 View Filtering Statistics",
                "StatsDesc": "View success rates and filtered event counts in Dashboard."
            },
            "ConsentStrategy": {
                "Title": "Consent Strategy",
                "Description": "Control filtering strategy for compliance requirements.",
                "Label": "Strategy Selection",
                "Strict": "🔒 Strict Mode (Recommended)",
                "Balanced": "⚖️ Balanced Mode",
                "HelpTextStrict": "Must have trusted pixel receipt + explicit consent. Suitable for GDPR/CCPA.",
                "HelpTextBalanced": "Allows 'partially trusted' receipts if explicit consent is present.",
                "StrictNote": "Current version only receives and verifies Web Pixel events.",
                "BalancedNote": "Allows 'partially trusted' receipts. Slightly looser than strict mode.",
                "BalancedAdvice": "Suggestion: Use Strict Mode for EU/UK customers.",
                "UnknownStrategy": "⚠️ Unknown Strategy",
                "UnknownStrategyDesc": "Invalid strategy, defaulting to Strict Mode.",
                "ModalTitle": "Confirm Switch Privacy Strategy",
                "ModalContent": "Balanced mode allows 'partially trusted' receipts.",
                "ModalConfirm": "Strict Mode is recommended for GDPR regions. Switch anyway?",
                "ConfirmAction": "Confirm Switch",
                "Cancel": "Cancel"
            },
            "Modals": {
                "RotateTitle": "Confirm Change Association Token",
                "GenerateTitle": "Confirm Generate Association Token",
                "RotateAction": "Confirm Change",
                "GenerateAction": "Confirm Generate",
                "RotateDesc": "Web Pixel will update automatically.",
                "GenerateDesc": "Will be automatically configured to Web Pixel.",
                "RiskWarning": "⚠️ Rotation Risk Warning",
                "RiskDesc": "Old key expires in 30 minutes. Check for order loss risk after rotation."
            }
        }
    },
    "Forms": {
        "Credentials": {
            "Meta": {
                "PixelId": { "Label": "Pixel ID", "Placeholder": "1234567890123456" },
                "AccessToken": { "Label": "Access Token", "HelpText": "Meta Graph API Access Token" },
                "TestEventCode": { "Label": "Test Event Code", "HelpText": "Optional: For testing events in Events Manager" }
            },
            "Google": {
                "MeasurementId": { "Label": "Measurement ID", "Placeholder": "G-XXXXXXXXXX", "HelpText": "GA4 Measurement ID", "Error": "Invalid Format" },
                "ApiSecret": { "Label": "API Secret", "HelpText": "GA4 Measurement Protocol API Secret" }
            },
            "TikTok": {
                "PixelId": { "Label": "Pixel ID", "Placeholder": "C1234567890123456789" },
                "AccessToken": { "Label": "Access Token", "HelpText": "TikTok Events API Access Token" }
            }
        }
    },
    "PrivacyPage": {
        "Title": "Privacy & Data",
        "Subtitle": "Understand how this app collects, uses, and protects your store data",
        "GDPRHistory": "GDPR Request History",
        "Back": "Back",
        "NoRecords": "No records",
        "Created": "Created: {{date}}",
        "Completed": "Completed: {{date}}",
        "DownloadJSON": "Download JSON",
        "Overview": {
            "Title": "Data Processing Overview",
            "Content": "Tracking Guardian acts as a <strong>Data Processor</strong>. We follow GDPR/CCPA regulations to ensure data security.",
            "Note": "We do not rely on customer PII. Core features work even if PII is redacted."
        },
        "Config": {
            "Title": "📋 Your Current Configuration",
            "Strategy": "Consent Strategy",
            "Strict": "Strict Mode",
            "Balanced": "Balanced Mode"
        },
        "DataTypes": {
            "Title": "Collected Data Types",
            "PixelEvents": {
                "Title": "Pixel Event Data",
                "Description": "From Web Pixel event receipts, for diagnosis and statistics",
                "Items": ["Event ID/Type", "Timestamp", "Event Params (Amount, Currency, etc.)", "Checkout Token (Hashed)"]
            },
            "Consent": {
                "Title": "Customer Consent Status",
                "Description": "Respecting customer privacy choices",
                "Items": ["marketing: Consent for marketing", "analytics: Consent for analytics", "saleOfData: CCPA sale of data"]
            },
            "TechData": {
                "Title": "Request Technical Data",
                "Content": "For security and anti-fraud, we may store technical data (IP, User-Agent). Retention follows store settings."
            }
        },
        "Usage": {
            "Title": "Data Usage",
            "Tracking": {
                "Title": "Conversion Tracking",
                "Content": "v1 relies on Web Pixel events. We do not read orders via Admin API or subscribe to order webhooks."
            },
            "Warning": {
                "Title": "Important: Server-side delivery not available",
                "Content": "Server-side delivery is disabled. Current version is for diagnosis and verification only."
            },
            "Reconciliation": {
                "Title": "Reconciliation & Diagnosis",
                "Content": "We compare pixel receipts with internal logs to identify tracking gaps."
            },
            "Compliance": {
                "Title": "Compliance Execution",
                "Content": "Automatically decide whether to send data based on consent status."
            },
            "PixelSending": {
                "Title": "Web Pixel Data Sending",
                "When": "When Sending",
                "WhenContent": "Events are sent only when customer grants appropriate consent (analytics or marketing).",
                "Fields": "Sent Fields",
                "FieldsContent": "Only non-PII data (Event Type, Timestamp, Order ID, Amount). No Name/Email/Phone.",
                "Consent": "Following Consent",
                "ConsentContent": "Pixel subscribes to customerPrivacy changes."
            },
            "Notifications": {
                "Title": "Notifications & Third-party Services",
                "Content": "Alerts are currently disabled. Future integrations may include Slack/Telegram."
            }
        },
        "Retention": {
            "Title": "Data Retention Period",
            "Note": "We follow data minimization principles.",
            "Receipts": "PixelEventReceipt (Pixel Receipts)",
            "ReceiptsDesc": "Follows store setting (default 90 days).",
            "Runs": "VerificationRun",
            "RunsDesc": "Follows store setting (default 90 days).",
            "Reports": "ScanReport",
            "ReportsDesc": "Follows store setting (default 90 days).",
            "Logs": "EventLog / AuditLog",
            "LogsDesc": "Follows store setting. Audit logs kept for 365 days."
        },
        "Deletion": {
            "Title": "Data Deletion Methods",
            "Desc": "We support multiple deletion methods:",
            "Uninstall": {
                "Title": "Uninstall App",
                "Desc": "Data deleted within 48 hours of uninstallation via APP_UNINSTALLED webhook."
            },
            "GDPR": {
                "Title": "GDPR Customer Data Request",
                "Desc": "We respond to CUSTOMERS_DATA_REQUEST and CUSTOMERS_REDACT webhooks."
            },
            "Shop": {
                "Title": "Shop Data Deletion",
                "Desc": "We respond to SHOP_REDACT webhook to delete all shop data."
            }
        },
        "Security": {
            "Title": "Security Measures",
            "Transport": { "Title": "Transport Encryption", "Desc": "TLS 1.2+" },
            "Storage": { "Title": "Credential Encryption", "Desc": "AES-256-GCM for API keys" },
            "Access": { "Title": "Access Control", "Desc": "Shopify OAuth" }
        },
        "GDPRTest": {
            "Title": "GDPR Webhooks Test Guide",
            "Desc": "Shopify requires correct response to mandatory webhooks. Test methods:",
            "Step1": "1. App setup → GDPR Mandatory webhooks",
            "Step2": "2. Configure endpoints",
            "Step3": "3. Test with Shopify CLI",
            "Success": "App has implemented all GDPR mandatory webhook handlers."
        },
        "ExportDelete": {
            "Title": "Data Export & Deletion",
            "Note": "You have the right to export or delete your data under GDPR/CCPA.",
            "Export": {
                "Title": "Data Export",
                "Desc": "Export all store data including conversion records and logs.",
                "JSON": "Export Conversions (JSON)",
                "CSV": "Export Conversions (CSV)",
                "Events": "Export Event Logs (JSON)",
                "Note": "Large datasets may take time."
            },
            "Delete": {
                "Title": "Data Deletion",
                "Desc": "Delete all store data. Irreversible.",
                "Warning": "Warning: This will permanently delete all conversions, logs, and settings.",
                "Button": "Delete All Data",
                "ModalTitle": "Confirm Delete All Data",
                "ModalContent": "Are you sure? This will delete all records permanently.",
                "Irreversible": "This action cannot be undone!",
                "Confirm": "Confirm Delete",
                "Error": "Deletion requires backend support or GDPR webhook."
            },
            "Status": {
                "Title": "GDPR Request Status",
                "Desc": "View recent GDPR data and deletion requests.",
                "Button": "View GDPR History"
            }
        },
        "Docs": {
            "Title": "Related Documentation",
            "Privacy": "Full Privacy Policy",
            "Terms": "Terms of Service",
            "ShopifyPrivacy": "Shopify Customer Data Protection",
            "ShopifyGDPR": "Shopify GDPR Requirements"
        }
    },
    "PublicPrivacy": {
        "Title": "Privacy Policy",
        "Meta": { "AppName": "App Name", "LastUpdated": "Last Updated", "AppDomain": "App Domain" },
        "Overview": {
            "Title": "Overview",
            "Content": "{{appName}} is a Shopify App acting as a <strong>Data Processor</strong>. We comply with GDPR/CCPA."
        },
        "CollectedData": {
            "Title": "Collected Data Types",
            "Orders": "Order Data (ID, Amount, Currency, Items)",
            "Consent": "Customer Consent (Marketing, Analytics, SaleOfData)",
            "NoPII": "We do NOT collect PII (Name, Email, Phone, Address, Payment Info)",
            "TechData": "Request Technical Data (IP, User-Agent) for security/anti-fraud",
            "Session": "Session & Auth (Store staff email for OAuth)"
        },
        "Usage": {
            "Title": "Data Usage",
            "Tracking": "Conversion Tracking (v1 uses Web Pixel receipts only, no PCD access)",
            "Reconciliation": "Reconciliation & Diagnosis",
            "Compliance": "Compliance Execution",
            "PCD": "Relation to Protected Customer Data (PCD)"
        },
        "Retention": { "Title": "Data Retention", "Content": "We follow data minimization. Default retention is 90 days." },
        "Deletion": { "Title": "Data Deletion", "Content": "Uninstall, GDPR Request, or Shop Redact." },
        "Sharing": { "Title": "Third-party Sharing", "Content": "Server-side delivery disabled in v1. Alerts disabled." },
        "Security": { "Title": "Security Measures", "Content": "TLS Encryption, AES-256 Storage, OAuth Access Control." },
        "Rights": { "Title": "Data Subject Rights", "Content": "Access, Deletion, Correction, Portability, Objection." },
        "Docs": { "Title": "Full Compliance Docs", "Content": "See 'Privacy & Compliance' in app." },
        "Contact": { "Title": "Contact", "Content": "Contact us via Shopify App support." }
    },
    "ScanModals": {
        "Guidance": {
            "Title": "ScriptTag Cleanup Guide",
            "GotIt": "Got it",
            "GoToMigration": "Go to Migration Tool",
            "UpgradeWizardContent": "You can get the script list from Shopify Admin Upgrade Wizard.",
            "Step1": "Access Upgrade Wizard",
            "Step2": "View Script List",
            "Step3": "Copy Script Content",
            "Step4": "Paste Here",
            "Tip": "💡 Tip: Paste in batches if there are many scripts.",
            "OpenDocs": "Open Shopify Upgrade Wizard Docs",
            "LimitWarning": "Due to Shopify permissions, app cannot delete ScriptTag directly.",
            "Steps": {
                "Pixel": "Confirm Web Pixel Enabled",
                "Creds": "Configure Pixel Credentials",
                "Verify": "Verify Tracking",
                "Delete": "Manually Delete ScriptTag"
            },
            "NotFound": "Cannot find creating app?",
            "ScriptTagId": "ScriptTag ID: {{id}}",
            "SafeDelete": "💡 After installing Tracking Guardian Web Pixel, old {{platform}} ScriptTag can be safely deleted."
        },
        "Delete": {
            "Title": "Confirm Delete",
            "Content": "Are you sure you want to delete <strong>{{title}}</strong>?",
            "Warning": "This action cannot be undone. Tracking will stop immediately.",
            "Confirm": "Confirm Delete",
            "Cancel": "Cancel"
        }
    },
    "PublicSupport": {
        "Title": "Support & FAQ",
        "Subtitle": "Tracking Guardian Help Center",
        "Contact": {
            "Title": "Contact & Support",
            "Content": "Need help with migration or Web Pixel events? Reach out anytime:",
            "Email": "Email: ",
            "DataRights": "Data rights (GDPR/CCPA): use customers/data_request or customers/redact",
            "StatusPage": "Status page: "
        },
        "FAQ": {
            "Title": "Quick FAQ",
            "PII": { "Q": "Do you require PII/PCD?", "A": "We do not collect end-customer PII..." },
            "Events": { "Q": "What events are collected?", "A": "Default: checkout_completed only..." },
            "Consent": { "Q": "How is consent handled?", "A": "Client-side consent follows Shopify customerPrivacy." },
            "Retention": { "Q": "Data retention & deletion", "A": "Defaults to 90 days." }
        },
        "Migration": {
            "Title": "Migration tips",
            "Tip1": "Run in-app scanner to detect ScriptTags.",
            "Tip2": "Paste Additional Scripts into manual analyzer.",
            "Tip3": "Confirm Web Pixel is installed before removing ScriptTags."
        },
        "Badges": {
            "Public": "Public",
            "NoLogin": "No login required"
        }
    }
}

new_keys_zh = {
    "Settings": {
        "Security": {
            "Title": "安全设置",
            "Description": "管理 Pixel 事件关联令牌和数据安全设置。",
            "IngestionKey": {
                "Title": "Ingestion Key（关联令牌）",
                "Description": "用于关联来自 Web Pixel 的事件请求。此令牌帮助我们：",
                "Benefits": "• 过滤误配置或无效请求（抗噪）\n• 将像素事件与订单正确关联（诊断）\n• 在多店铺场景中识别请求来源",
                "SecurityNote": "⚠️ 重要安全说明：此令牌在浏览器网络请求中可见，不是强安全边界。真正的安全由多层防护提供：",
                "SecurityLayers": "• <strong>TLS 加密</strong>：所有数据传输均通过 HTTPS 加密\n• <strong>Origin 验证</strong>：仅接受来自 Shopify checkout 页面的请求（含 Referer/ShopDomain fallback）\n• <strong>完整性校验密钥（HMAC）</strong>：用于完整性校验与基础抗滥用\n• <strong>速率限制</strong>：防止滥用和异常流量\n• <strong>数据最小化</strong>：我们不收集、不处理、不发送终端客户 PII",
                "BoundaryNote": "<strong>安全边界说明：</strong>此令牌主要用于事件关联和诊断。不要将此令牌视为强安全凭证。",
                "Status": "状态",
                "Configured": "已配置",
                "TokenConfigured": "令牌已配置",
                "NotConfigured": "未配置",
                "ReinstallPrompt": "请重新安装应用或点击生成令牌",
                "RotateToken": "更换令牌",
                "GenerateToken": "生成令牌",
                "EventMode": "事件接收校验模式",
                "Strict": "严格",
                "Lax": "宽松",
                "StrictDesc": "Origin 必须过白名单",
                "LaxDesc": "非白名单/HMAC 失败仍可能被接收",
                "LaxWarning": "来自非白名单来源或 HMAC 验证失败但未被拒绝的请求仍可能被接收并标为低信任。",
                "GraceWindow": "<strong>旧令牌仍有效：</strong>之前的令牌将于 {{date}} 失效。在此之前，新旧令牌均可使用。",
                "GraceWindowEnd": "过渡期结束后，旧令牌将自动失效。",
                "OldTokenExpired": "<strong>旧令牌已过期：</strong>之前的令牌已自动清理。",
                "NoTokenError": "<strong>⚠️ 未配置关联令牌：</strong>请立即生成令牌。",
                "NoTokenDesc": "未配置令牌时，像素事件仍可接收，但完整性信号会下降。",
                "P0SecurityNote": "⚠️ P0 安全提示：PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY 配置",
                "P0SecurityDetails": "<strong>生产环境必须显式设置：</strong>\n• <code>PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY</code> 环境变量\n• 若设置为 <code>false</code>，<code>Origin: null</code> 的请求将被拒绝。",
                "IngestionKeyRisk": "<strong>ingestionKey 可见性风险：</strong>\n• ingestion_key 会下发到像素客户端，属于公开信号\n• 真实订单真实性应以 Shopify webhook/订单对账为准",
                "MustDoActions": "<strong>必须执行的措施：</strong>\n• <strong>定期轮换 ingestionKey</strong>（建议每 90 天）\n• <strong>监控异常事件接收模式</strong>\n• <strong>如果怀疑滥用，立即更换令牌</strong>",
                "RotationMechNote": "<strong>令牌轮换机制说明：</strong>更换令牌时，系统会自动保存旧令牌为 previousIngestionSecret，并在 30 分钟内同时接受新旧令牌。",
                "HowItWorks": "工作原理：",
                "HowItWorksDesc": "服务端会记录此令牌并将其作为完整性信号。更换令牌后，App Pixel 会自动更新，旧令牌会有 30 分钟的过渡期。",
                "TokenRotationMech": "<strong>令牌轮换机制：</strong>\n• 更换令牌时，旧令牌会保存为 previousIngestionSecret\n• 旧令牌在 30 分钟内仍可使用\n• 系统会自动同步新令牌到 Web Pixel 配置"
            },
            "HMAC": {
                "Title": "完整性校验监控（过去24小时）",
                "Description": "实时监控密钥轮换状态和可疑注入活动。",
                "RotationStatus": "密钥轮换状态",
                "RotateNow": "立即轮换",
                "LastRotation": "上次轮换时间",
                "NeverRotated": "从未轮换",
                "RotationCount": "轮换次数",
                "GraceWindowActive": "过渡期进行中：旧密钥将在 {{date}} 失效",
                "RotationAdviceTitle": "建议：定期轮换密钥以提高安全性",
                "RotationAdviceDesc": "建议每90天轮换一次密钥。点击'立即轮换'按钮开始轮换。",
                "RotationAdviceTip": "💡 密钥轮换后，系统会自动同步新密钥。旧密钥将在30分钟内失效。",
                "RotationWarning": "⚠️ <strong>重要提示：</strong>ingestion_key 是弱秘密。轮换后请对比事件接收情况。",
                "OverdueWarningTitle": "建议：密钥已超过90天未轮换",
                "OverdueWarningDesc": "上次轮换时间：{{date}}（{{days}} 天前）。建议定期轮换。",
                "SuspiciousInjection": "可疑注入告警",
                "InvalidSignatures": "无效签名次数",
                "NullOriginRequests": "Null Origin 请求数",
                "SuspiciousTotal": "可疑活动总数",
                "LastSuspicious": "最近可疑活动: {{date}}",
                "HighSuspiciousAlert": "⚠️ 检测到大量可疑活动 - 建议立即采取行动",
                "HighSuspiciousDesc": "系统检测到 {{count}} 次可疑活动。这可能是密钥泄漏或注入攻击的迹象。",
                "ImmediateActions": "立即执行的操作：",
                "ActionRotate": "立即轮换密钥",
                "ActionCheckLogs": "检查访问日志和事件接收记录",
                "ActionLeakage": "如果怀疑密钥泄漏，立即更换令牌",
                "ActionReview": "审查是否有异常来源的请求",
                "ActionMetrics": "检查'事件丢失率'指标",
                "MediumSuspiciousAlert": "⚠️ 检测到可疑活动",
                "MediumSuspiciousDesc": "系统检测到 {{count}} 次可疑活动。建议定期检查访问日志。",
                "MediumSuspiciousDesc2": "如果无效签名次数持续增加，可能是密钥泄漏的早期迹象。",
                "NoSuspicious": "✅ 过去24小时内未检测到可疑活动"
            },
            "DataRetention": {
                "Title": "数据保留策略",
                "Description": "配置数据保留期限。",
                "Label": "数据保留天数",
                "Option30": "30 天（推荐用于高流量店铺）",
                "Option60": "60 天",
                "Option90": "90 天（默认）",
                "Option180": "180 天",
                "Option365": "365 天（最大）",
                "HelpText": "超过此期限的数据将被自动清理",
                "InfoTitle": "数据保留说明：",
                "InfoDesc": "以下数据受保留期限控制：",
                "InfoItems": "• <strong>转化日志</strong>\n• <strong>像素事件回执</strong>\n• <strong>扫描报告</strong>\n• <strong>对账报告</strong>\n• <strong>失败任务</strong>",
                "InfoNote": "清理任务每日自动执行。审计日志保留 365 天。",
                "MinimizationTitle": "数据最小化原则：",
                "MinimizationDesc": "我们仅存储转化追踪必需的数据。",
                "PIINote": "<strong>关于 PII：</strong>我们不存储客户 PII（姓名/邮箱/电话/地址）。"
            },
            "Privacy": {
                "Title": "像素隐私与同意逻辑",
                "Description": "了解像素加载策略与后端过滤逻辑。",
                "LoadingStrategyTitle": "📋 像素加载策略",
                "LoadingStrategyDesc": "Web Pixel Extension 加载条件：",
                "LoadingStrategyItems": "• <strong>analytics = true</strong>：需要 analytics consent\n• <strong>marketing = true</strong>：需要 marketing consent\n• <strong>sale_of_data = \"disabled\"</strong>",
                "StrategyNote": "<strong>策略说明：</strong>当前配置需要 analytics 或 marketing 同意才能加载像素。后端根据平台合规要求过滤事件。",
                "BackendFilterTitle": "🔍 后端过滤策略",
                "BackendFilterDesc": "后端会根据各平台的合规要求进一步过滤事件：",
                "BackendFilterItems": "• <strong>GA4</strong>：需 analytics 同意\n• <strong>Meta/TikTok</strong>：需 marketing 同意",
                "DesignReason": "<strong>为什么这样设计？</strong> 提高覆盖率并确保合规。",
                "ActualEffectTitle": "✅ 实际效果",
                "ActualEffectDesc": "根据用户的同意状态发送事件。",
                "ActualEffectItems": "• 仅同意 analytics：仅 GA4\n• 仅同意 marketing：仅 Meta/TikTok\n• 同时同意：所有平台",
                "ComplianceNote": "后端过滤确保符合 GDPR/CCPA。",
                "StatsTitle": "📊 查看过滤统计",
                "StatsDesc": "在 Dashboard 查看发送统计和过滤原因。"
            },
            "ConsentStrategy": {
                "Title": "Consent 策略",
                "Description": "控制事件过滤策略。",
                "Label": "策略选择",
                "Strict": "🔒 严格模式（推荐）",
                "Balanced": "⚖️ 平衡模式",
                "HelpTextStrict": "必须有可信的像素回执 + 明确同意。",
                "HelpTextBalanced": "允许'部分可信'的回执。",
                "StrictNote": "当前版本仅接收与校验 Web Pixel 事件。",
                "BalancedNote": "允许信任等级为「部分可信」的回执。",
                "BalancedAdvice": "建议：欧盟/英国地区推荐使用严格模式。",
                "UnknownStrategy": "⚠️ 未知策略",
                "UnknownStrategyDesc": "默认按严格模式处理。",
                "ModalTitle": "确认切换隐私策略",
                "ModalContent": "平衡模式允许'部分可信'的回执。",
                "ModalConfirm": "推荐使用严格模式。确定要切换吗？",
                "ConfirmAction": "确认切换",
                "Cancel": "取消"
            },
            "Modals": {
                "RotateTitle": "确认更换关联令牌",
                "GenerateTitle": "确认生成关联令牌",
                "RotateAction": "确认更换",
                "GenerateAction": "确认生成",
                "RotateDesc": "Web Pixel 将自动更新。",
                "GenerateDesc": "生成后将自动配置。",
                "RiskWarning": "⚠️ 轮换后风险提示",
                "RiskDesc": "旧密钥30分钟内失效。请检查是否有丢单风险。"
            }
        }
    },
    "Forms": {
        "Credentials": {
            "Meta": {
                "PixelId": { "Label": "Pixel ID", "Placeholder": "1234567890123456" },
                "AccessToken": { "Label": "Access Token", "HelpText": "Meta Graph API Access Token" },
                "TestEventCode": { "Label": "测试事件代码 (Test Event Code)", "HelpText": "可选：用于在 Events Manager 中测试事件" }
            },
            "Google": {
                "MeasurementId": { "Label": "Measurement ID", "Placeholder": "G-XXXXXXXXXX", "HelpText": "GA4 Measurement ID", "Error": "格式无效" },
                "ApiSecret": { "Label": "API Secret", "HelpText": "GA4 Measurement Protocol API Secret" }
            },
            "TikTok": {
                "PixelId": { "Label": "Pixel ID", "Placeholder": "C1234567890123456789" },
                "AccessToken": { "Label": "Access Token", "HelpText": "TikTok Events API Access Token" }
            }
        }
    },
    "PrivacyPage": {
        "Title": "隐私与数据",
        "Subtitle": "了解本应用如何收集、使用和保护您店铺的数据",
        "GDPRHistory": "GDPR 请求历史",
        "Back": "返回",
        "NoRecords": "暂无记录",
        "Created": "创建时间：{{date}}",
        "Completed": "完成时间：{{date}}",
        "DownloadJSON": "下载 JSON",
        "Overview": {
            "Title": "数据处理概览",
            "Content": "Tracking Guardian 作为<strong>数据处理者</strong>，代表商家处理数据。我们遵循 GDPR/CCPA。",
            "Note": "本应用不依赖客户 PII。即使 PII 脱敏，核心功能仍可用。"
        },
        "Config": {
            "Title": "📋 您的当前配置",
            "Strategy": "同意策略",
            "Strict": "严格模式",
            "Balanced": "平衡模式"
        },
        "DataTypes": {
            "Title": "收集的数据类型",
            "PixelEvents": {
                "Title": "像素事件数据",
                "Description": "来自 Web Pixel 事件收据，用于诊断和统计",
                "Items": ["事件 ID/类型", "时间戳", "事件参数（金额、货币等）", "结账令牌（已哈希）"]
            },
            "Consent": {
                "Title": "客户同意状态",
                "Description": "尊重客户隐私选择",
                "Items": ["marketing: 是否同意营销", "analytics: 是否同意分析", "saleOfData: 是否允许数据销售"]
            },
            "TechData": {
                "Title": "请求相关技术数据",
                "Content": "为安全、反作弊，我们可能存储 IP、User-Agent 等。保留周期同店铺设置。"
            }
        },
        "Usage": {
            "Title": "数据用途",
            "Tracking": {
                "Title": "转化追踪",
                "Content": "v1 默认仅基于 Web Pixel 事件。不通过 Admin API 读取订单。"
            },
            "Warning": {
                "Title": "重要：当前版本不提供服务端投递",
                "Content": "服务端投递默认关闭，仅用于诊断与验收。"
            },
            "Reconciliation": {
                "Title": "对账与诊断",
                "Content": "比对像素收据与内部日志，发现追踪缺口。"
            },
            "Compliance": {
                "Title": "合规执行",
                "Content": "根据同意状态自动决定是否发送数据。"
            },
            "PixelSending": {
                "Title": "Web Pixel 数据发送说明",
                "When": "何时发送",
                "WhenContent": "仅在客户授予相应同意时发送。",
                "Fields": "发送字段",
                "FieldsContent": "仅发送非 PII 数据。不包含姓名/邮箱/电话。",
                "Consent": "如何跟随 consent 变化",
                "ConsentContent": "Pixel 订阅 customerPrivacy 变化。"
            },
            "Notifications": {
                "Title": "通知与第三方服务",
                "Content": "告警功能已禁用。未来可能支持 Slack/Telegram。"
            }
        },
        "Retention": {
            "Title": "数据保存时长",
            "Note": "我们遵循数据最小化原则。",
            "Receipts": "PixelEventReceipt（像素收据）",
            "ReceiptsDesc": "按店铺设置（默认 90 天）。",
            "Runs": "VerificationRun（验收运行）",
            "RunsDesc": "按店铺设置（默认 90 天）。",
            "Reports": "ScanReport（扫描报告）",
            "ReportsDesc": "按店铺设置（默认 90 天）。",
            "Logs": "EventLog / AuditLog（事件与审计日志）",
            "LogsDesc": "按店铺设置。审计日志保留 365 天。"
        },
        "Deletion": {
            "Title": "数据删除方式",
            "Desc": "我们支持多种删除方式：",
            "Uninstall": {
                "Title": "卸载应用",
                "Desc": "收到 APP_UNINSTALLED 后 48 小时内删除。"
            },
            "GDPR": {
                "Title": "GDPR 客户数据删除请求",
                "Desc": "响应 CUSTOMERS_DATA_REQUEST 或 CUSTOMERS_REDACT。"
            },
            "Shop": {
                "Title": "店铺数据删除请求",
                "Desc": "响应 SHOP_REDACT 删除所有数据。"
            }
        },
        "Security": {
            "Title": "安全措施",
            "Transport": { "Title": "传输加密", "Desc": "TLS 1.2+" },
            "Storage": { "Title": "凭证加密", "Desc": "AES-256-GCM" },
            "Access": { "Title": "访问控制", "Desc": "Shopify OAuth" }
        },
        "GDPRTest": {
            "Title": "GDPR Webhooks 测试指引",
            "Desc": "Shopify 要求正确响应强制 webhooks。测试方法：",
            "Step1": "1. App setup → GDPR Mandatory webhooks",
            "Step2": "2. 配置 webhook 端点",
            "Step3": "3. 使用 Shopify CLI 测试",
            "Success": "本应用已实现所有 GDPR 强制 webhooks 处理程序。"
        },
        "ExportDelete": {
            "Title": "数据导出与删除",
            "Note": "根据 GDPR/CCPA，您有权导出或删除数据。",
            "Export": {
                "Title": "数据导出",
                "Desc": "导出店铺所有数据。",
                "JSON": "导出转化数据 (JSON)",
                "CSV": "导出转化数据 (CSV)",
                "Events": "导出事件日志 (JSON)",
                "Note": "大型数据集可能需要几分钟。"
            },
            "Delete": {
                "Title": "数据删除",
                "Desc": "删除店铺所有数据。不可撤销。",
                "Warning": "警告：此操作将永久删除所有转化记录、日志和设置。",
                "Button": "删除所有数据",
                "ModalTitle": "确认删除所有数据",
                "ModalContent": "您确定要删除所有数据吗？此操作将永久删除所有记录。",
                "Irreversible": "此操作不可撤销！",
                "Confirm": "确认删除",
                "Error": "删除功能需要后端支持或 GDPR webhook。"
            },
            "Status": {
                "Title": "GDPR 请求状态",
                "Desc": "查看最近的 GDPR 请求。",
                "Button": "查看 GDPR 请求历史"
            }
        },
        "Docs": {
            "Title": "相关文档",
            "Privacy": "完整隐私政策",
            "Terms": "服务条款",
            "ShopifyPrivacy": "Shopify 客户数据保护指南",
            "ShopifyGDPR": "Shopify GDPR 要求"
        }
    },
    "PublicPrivacy": {
        "Title": "隐私政策",
        "Meta": { "AppName": "应用名称", "LastUpdated": "最后更新", "AppDomain": "应用域名" },
        "Overview": {
            "Title": "概述",
            "Content": "{{appName}} 是一个 Shopify 应用，作为<strong>数据处理者</strong>代表商家处理数据。我们遵循 GDPR/CCPA。"
        },
        "CollectedData": {
            "Title": "收集的数据类型",
            "Orders": "订单数据（ID、金额、货币、商品）",
            "Consent": "客户同意状态（marketing, analytics, saleOfData）",
            "NoPII": "我们不收集 PII（姓名、邮箱、电话、地址、支付信息）",
            "TechData": "请求相关技术数据（IP、User-Agent）",
            "Session": "会话与鉴权（店铺员工邮箱）"
        },
        "Usage": {
            "Title": "数据用途",
            "Tracking": "转化追踪（v1 仅基于 Web Pixel 收据，不访问 PCD）",
            "Reconciliation": "对账与诊断",
            "Compliance": "合规执行",
            "PCD": "与 PCD（受保护客户数据）的关系"
        },
        "Retention": { "Title": "数据保留", "Content": "遵循数据最小化原则。默认 90 天。" },
        "Deletion": { "Title": "数据删除", "Content": "卸载应用、GDPR 请求、或店铺数据删除请求。" },
        "Sharing": { "Title": "第三方共享", "Content": "v1 不向第三方发送服务端事件。告警已禁用。" },
        "Security": { "Title": "安全措施", "Content": "传输加密、存储加密、访问控制、日志脱敏。" },
        "Rights": { "Title": "数据主体权利", "Content": "访问权、删除权、更正权、可携带权、反对权。" },
        "Docs": { "Title": "完整合规文档", "Content": "见应用内「隐私与合规」页。" },
        "Contact": { "Title": "联系方式", "Content": "通过 Shopify App 支持渠道联系我们。" }
    },
    "ScanModals": {
        "Guidance": {
            "Title": "ScriptTag 清理指南",
            "GotIt": "我知道了",
            "GoToMigration": "前往迁移工具",
            "UpgradeWizardContent": "您可以从 Shopify Admin 的升级向导中获取脚本清单。",
            "Step1": "访问升级向导",
            "Step2": "查看脚本清单",
            "Step3": "复制脚本内容",
            "Step4": "粘贴到本页面",
            "Tip": "💡 提示：建议分批粘贴和分析。",
            "OpenDocs": "打开 Shopify 升级向导帮助文档",
            "LimitWarning": "由于 Shopify 权限限制，应用无法直接删除 ScriptTag。",
            "Steps": {
                "Pixel": "确认 Web Pixel 已启用",
                "Creds": "配置像素凭证",
                "Verify": "验证追踪正常",
                "Delete": "手动删除 ScriptTag"
            },
            "NotFound": "找不到创建应用？",
            "ScriptTagId": "ScriptTag ID: {{id}}",
            "SafeDelete": "💡 安装 Web Pixel 后，旧的 {{platform}} ScriptTag 可以安全删除。"
        },
        "Delete": {
            "Title": "确认删除",
            "Content": "您确定要删除 <strong>{{title}}</strong> 吗？",
            "Warning": "此操作不可撤销。追踪将立即停止。",
            "Confirm": "确认删除",
            "Cancel": "取消"
        }
    },
    "PublicSupport": {
        "Title": "支持与常见问题",
        "Subtitle": "Tracking Guardian 帮助中心",
        "Contact": {
            "Title": "联系与支持",
            "Content": "需要帮助？请随时联系我们：",
            "Email": "邮箱：",
            "DataRights": "数据权利 (GDPR/CCPA)：使用 customers/data_request 或 customers/redact",
            "StatusPage": "状态页："
        },
        "FAQ": {
            "Title": "常见问题",
            "PII": { "Q": "需要 PII/PCD 吗？", "A": "我们不收集终端客户 PII..." },
            "Events": { "Q": "收集哪些事件？", "A": "默认仅 checkout_completed..." },
            "Consent": { "Q": "如何处理同意？", "A": "客户端遵循 customerPrivacy。" },
            "Retention": { "Q": "数据保留与删除", "A": "默认 90 天。" }
        },
        "Migration": {
            "Title": "迁移提示",
            "Tip1": "运行应用内扫描器。",
            "Tip2": "粘贴 Additional Scripts 进行分析。",
            "Tip3": "确认 Web Pixel 安装后再删除 ScriptTag。"
        },
        "Badges": {
            "Public": "公开",
            "NoLogin": "无需登录"
        }
    }
}

def update_json(path, new_data):
    try:
        data = {}
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        
        # Helper to merge dictionaries deeply
        def deep_merge(target, source):
            for key, value in source.items():
                if isinstance(value, dict):
                    node = target.setdefault(key, {})
                    deep_merge(node, value)
                else:
                    target[key] = value
        
        deep_merge(data, new_data)
        
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"Updated {path}")
    except Exception as e:
        print(f"Error updating {path}: {e}")

if __name__ == "__main__":
    update_json(EN_PATH, new_keys_en)
    update_json(ZH_PATH, new_keys_zh)
