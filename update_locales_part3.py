import json
import os

EN_PATH = 'app/locales/en.json'
ZH_PATH = 'app/locales/zh.json'

new_keys_en = {
    "PublicTerms": {
        "Title": "Terms of Service",
        "Meta": {
            "AppName": "App Name",
            "LastUpdated": "Last Updated",
            "AppDomain": "App Domain"
        },
        "Section1": {
            "Title": "1. Service Description",
            "Content": "{{appName}} is a Shopify App providing Web Pixel migration, verification, and diagnosis services. Including but not limited to: migration assistance, pixel event verification, tracking gap monitoring, scanning, and reporting functions. Specific features are subject to actual availability within the app. We reserve the right to adjust features without affecting core services."
        },
        "Section2": {
            "Title": "2. Acceptance of Terms",
            "Content": "By installing or using {{appName}}, you agree to be bound by these Terms of Service. If you do not agree, please do not install or use this app. We may update these terms from time to time; updated terms will be posted on this page, and continued use constitutes acceptance."
        },
        "Section3": {
            "Title": "3. Conditions of Use",
            "Content": "You represent that: (a) you have the legal right to operate a store on the Shopify platform; (b) you comply with Shopify platform rules and applicable laws; (c) store information provided is true and accurate; (d) you will not use this app for any illegal, fraudulent, or infringing activities. We reserve the right to suspend or terminate service upon discovering violations."
        },
        "Section4": {
            "Title": "4. Disclaimer",
            "Content": "This app is provided 'as is' without warranties of any kind, express or implied. To the maximum extent permitted by law, we are not liable for any direct, indirect, incidental, special, or consequential damages arising from the use or inability to use this app, including but not limited to loss of profits, data loss, or business interruption. We are not responsible for the availability or accuracy of third-party services (e.g., Shopify, ad platforms)."
        },
        "Section5": {
            "Title": "5. Governing Law",
            "Content": "These Terms of Service shall be governed by the laws of the People's Republic of China (if applicable) or your local jurisdiction. Any disputes arising from these terms shall be resolved through negotiation; if negotiation fails, they may be submitted to a court of competent jurisdiction."
        },
        "Section6": {
            "Title": "6. Contact & Documentation",
            "Content": "If you have any questions about these Terms of Service, please contact us at <a href=\"mailto:{{email}}\">{{email}}</a>. Please also refer to our <a href=\"/privacy\">Privacy Policy</a> for data processing and privacy compliance information."
        }
    },
    "Auth": {
        "Login": {
            "Error": "An error occurred during authentication. Please retry or contact support.",
            "Info": "Please access this app via Shopify Admin.",
            "InstalledTitle": "If you have installed this app:",
            "InstalledDesc": "Open Shopify Admin → Settings → Apps and sales channels → Tracking Guardian",
            "NotInstalledTitle": "If you have not installed it:",
            "NotInstalledDesc": "Search and install 'Tracking Guardian' from Shopify App Store",
            "Footer": "Per Shopify requirements, apps must be launched from Shopify Admin or App Store. Direct login from this page is not supported."
        }
    },
    "settings": {
        "subscription": {
            "currentPlan": "Current Plan",
            "trialDaysRemaining": "{{days}} days remaining in trial",
            "upgradePlan": "Upgrade Plan",
            "upgradeTo": "Upgrade to {{plan}}",
            "comparePlans": "Compare Plans",
            "helpText": "Need help choosing a plan? Contact support.",
            "moreInfoTitle": "Billing Information",
            "moreInfoContent": "You can visit <a href=\"/app/billing\">Subscription & Billing</a> page to view full billing history, usage stats and invoices."
        }
    },
    "subscriptionPlans": {
        "free": {
            "name": "Free Plan",
            "tagline": "Basic tracking for small stores",
            "features": {
                "basic": "Basic Pixel Events",
                "scan": "Daily Scan",
                "countdown": "Includes countdown to deprecation: Plus ({{plusDate}}), Non-Plus ({{nonPlusDate}})"
            }
        },
        "growth": {
            "name": "Growth Plan",
            "tagline": "Advanced features for growing businesses",
            "features": {
                "unlimited": "Unlimited Events",
                "priority": "Priority Support",
                "export": "Data Export"
            }
        },
        "agency": {
            "name": "Agency Plan",
            "tagline": "For high volume merchants and agencies",
            "features": {
                "multi": "Multi-store Management",
                "api": "API Access"
            }
        }
    },
    "common": {
        "months": "{{count}} month",
        "months_other": "{{count}} months",
        "unknownError": "Unknown error"
    }
}

new_keys_zh = {
    "PublicTerms": {
        "Title": "服务条款",
        "Meta": {
            "AppName": "应用名称",
            "LastUpdated": "最后更新",
            "AppDomain": "应用域名"
        },
        "Section1": {
            "Title": "1. 服务描述",
            "Content": "{{appName}} 是一款 Shopify 应用，为商家提供 Web Pixel 迁移、验收与诊断服务。包括但不限于：迁移辅助、像素事件验收、追踪缺口监测、扫描与报告功能。具体功能以应用内实际提供为准，我们保留在不影响核心服务的前提下调整功能的权利。"
        },
        "Section2": {
            "Title": "2. 接受条款",
            "Content": "安装或使用 {{appName}} 即表示您同意受本服务条款约束。如不同意本条款，请勿安装或使用本应用。我们可能不时更新本条款，更新后的条款将在本页面发布，继续使用即视为接受更新。"
        },
        "Section3": {
            "Title": "3. 使用条件",
            "Content": "您需确保：(a) 拥有在 Shopify 平台运营店铺的合法权利；(b) 遵守 Shopify 平台规则及适用法律法规；(c) 提供的店铺信息真实、准确；(d) 不得利用本应用从事任何非法、欺诈或侵权活动。我们保留在发现违规行为时暂停或终止服务的权利。"
        },
        "Section4": {
            "Title": "4. 免责声明",
            "Content": "本应用按「现状」提供，不提供任何形式的明示或暗示保证。在法律允许的最大范围内，我们不对因使用或无法使用本应用而产生的任何直接、间接、附带、特殊或后果性损害承担责任，包括但不限于利润损失、数据丢失、业务中断等。我们不对第三方服务（如 Shopify、广告平台）的可用性、准确性负责。"
        },
        "Section5": {
            "Title": "5. 管辖法律",
            "Content": "本服务条款受中华人民共和国法律管辖（如适用），或您所在地的法律管辖。因本条款产生的争议，双方应尽量协商解决；协商不成的，可向有管辖权的法院提起诉讼。"
        },
        "Section6": {
            "Title": "6. 联系方式与相关文档",
            "Content": "如有任何关于本服务条款的问题，请通过 <a href=\"mailto:{{email}}\">{{email}}</a> 联系我们。请同时参阅我们的 <a href=\"/privacy\">隐私政策</a> 以了解数据处理与隐私合规信息。"
        }
    },
    "Auth": {
        "Login": {
            "Error": "认证过程中发生错误，请重试或联系支持。",
            "Info": "请通过 Shopify 管理后台访问此应用",
            "InstalledTitle": "如果您已安装此应用：",
            "InstalledDesc": "打开 Shopify 管理后台 → 设置 → 应用和销售渠道 → Tracking Guardian",
            "NotInstalledTitle": "如果您尚未安装：",
            "NotInstalledDesc": "请从 Shopify App Store 搜索并安装「Tracking Guardian」",
            "Footer": "根据 Shopify 平台要求，应用必须从 Shopify 管理后台或 App Store 启动，不支持直接访问此页面进行登录。"
        }
    },
    "settings": {
        "subscription": {
            "currentPlan": "当前计划",
            "trialDaysRemaining": "试用期剩余 {{days}} 天",
            "upgradePlan": "升级计划",
            "upgradeTo": "升级到 {{plan}}",
            "comparePlans": "对比计划",
            "helpText": "需要帮助选择计划？请联系支持。",
            "moreInfoTitle": "账单信息",
            "moreInfoContent": "您可以访问 <a href=\"/app/billing\">订阅与计费</a> 页面查看完整的账单历史、使用量统计和发票信息。"
        }
    },
    "plans": {
        "free": {
            "name": "免费计划",
            "tagline": "小型店铺的基础追踪",
            "features": {
                "basic": "基础像素事件",
                "scan": "每日扫描",
                "countdown": "包含废弃倒计时：Plus ({{plusDate}})，非 Plus ({{nonPlusDate}})"
            }
        },
        "growth": {
            "name": "增长计划",
            "tagline": "成长型商家的高级功能",
            "features": {
                "unlimited": "无限事件",
                "priority": "优先支持",
                "export": "数据导出"
            }
        },
        "agency": {
            "name": "代理商计划",
            "tagline": "适用于高交易量商家和代理商",
            "features": {
                "multi": "多店铺管理",
                "api": "API 访问"
            }
        }
    },
    "common": {
        "months": "{{count}} 个月",
        "months_other": "{{count}} 个月",
        "unknownError": "未知错误"
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
