import json
import os

EN_PATH = 'app/locales/en.json'
ZH_PATH = 'app/locales/zh.json'

new_keys_en = {
    "scan": {
        "analysis": {
            "risks": {
                "pii_access": {
                    "name": "PII (Personally Identifiable Information) Access Detected",
                    "description": "Script may be accessing sensitive customer information like {{types}}. Ensure compliance with privacy regulations (GDPR, CCPA). Web Pixel sandbox cannot access this directly.",
                    "details": "Detected {{count}} PII access(es): {{types}}"
                },
                "window_document_access": {
                    "name": "Global Object (window/document) Access Detected",
                    "description": "Script uses window, document, or DOM operations. Web Pixel runs in a sandbox and cannot access these. Use Shopify provided APIs instead.",
                    "details": "Detected {{count}} access(es): {{issues}}"
                },
                "blocking_load": {
                    "name": "Blocking Code Detected",
                    "description": "Script may block page rendering, affecting user experience and performance. Detected: {{types}}",
                    "details": "Detected {{count}} blocking code(s): {{types}}"
                },
                "duplicate_triggers": {
                    "name": "Duplicate Event Triggers Detected",
                    "description": "Script may trigger the same event multiple times, leading to duplicate tracking.",
                    "details": "Detected {{count}} duplicate event call(s)"
                },
                "additional_scripts_detected": {
                    "name": "Tracking Code in Additional Scripts Detected",
                    "description": "Recommended to migrate to Web Pixel for better compatibility and privacy compliance.",
                    "details": "Detected platforms: {{platforms}}"
                },
                "legacy_ua": {
                    "name": "Legacy Universal Analytics Detected",
                    "description": "Universal Analytics stopped processing data in July 2023. Please migrate to GA4."
                },
                "inline_script_tags": {
                    "name": "Inline Script Tags Detected",
                    "description": "Inline scripts may affect page load performance. Suggest using async loading or Web Pixel."
                }
            },
            "recommendations": {
                "checklist": "\n📋 **Migration Checklist**:\n  1. Prioritize migrating ad platforms (Meta, TikTok) to avoid attribution loss\n  2. Enable Web Pixel and complete test order verification\n  3. Verify data after migration, then delete old scripts\n  4. Use official apps for unsupported platforms (Bing, Pinterest, etc.)",
                "unknown": "ℹ️ **Unknown Tracking Platform**\n  → Could be custom script, Survey tool, Post-purchase upsell, etc.\n  → Migration options:\n    • Survey/Forms → Manual migration using Shopify features\n    • Post-purchase upsell → Shopify official post-purchase extensions\n    • Custom tracking → Custom Pixel or Web Pixel\n  → Suggestion: Confirm script usage then choose appropriate migration path",
                "default": "ℹ️ **{{platform}}**\n  → Please confirm the purpose of this tracking code and evaluate if migration to Web Pixel or Server-side solution is needed",
                "google": "ℹ️ **Google Analytics 4**\n  → Recommended: Use Shopify's Google & YouTube app for automatic Web Pixel setup\n  → Alternative: Use Custom Pixel for advanced customization",
                "meta": "ℹ️ **Meta Pixel (Facebook)**\n  → Recommended: Use Shopify's Facebook & Instagram app\n  → Alternative: Use Custom Pixel for custom events",
                "tiktok": "ℹ️ **TikTok Pixel**\n  → Recommended: Use Shopify's TikTok app\n  → Alternative: Use Custom Pixel",
                "pinterest": "ℹ️ **Pinterest Tag**\n  → Recommended: Use Shopify's Pinterest app",
                "snapchat": "ℹ️ **Snapchat Pixel**\n  → Recommended: Use Shopify's Snapchat Ads app"
            }
        },
        "intro": {
            "manual": {
                "title": "Manual Script Analysis",
                "description": "Analyze and migrate custom scripts from checkout",
                "items": [
                    "Paste script content to identify platforms",
                    "Detect potential risks and PII access",
                    "Get migration recommendations"
                ],
                "action": {
                    "primary": "Start Analysis",
                    "secondary": "View Checklist"
                }
            },
            "checklist": {
                "title": "Migration Checklist",
                "description": "Track your migration progress",
                "items": [
                    "View identified scripts and risks",
                    "Track migration status",
                    "Export checklist as CSV"
                ],
                "action": {
                    "primary": "View Checklist",
                    "secondary": "Back to Auto Scan"
                }
            },
            "auto": {
                "title": "Auto Scan",
                "description": "Automatically scan your store for tracking scripts",
                "items": [
                    "Detect ScriptTags and Web Pixels",
                    "Identify tracking platforms",
                    "View risk assessment"
                ],
                "action": {
                    "primary": "Start Auto Scan",
                    "secondary": "Manual Analysis"
                }
            }
        },
        "pageTitle": "Tracking Guardian - Scan & Migrate",
        "pageSubtitle": "Detect, analyze, and migrate your tracking scripts",
        "modals": {
            "guide": {
                "title": "Migration Guide"
            },
            "cleanScriptTag": {
                "title": "Clean ScriptTag {{id}}"
            }
        },
        "errors": {
            "invalidPixelId": "Invalid Pixel ID",
            "invalidPixelFormat": "Invalid Pixel Format",
            "shopNotFound": "Shop not found",
            "selectPlatform": "Please select a platform",
            "processFailed": "Process failed",
            "saveFailed": "Save failed: ",
            "deleteFailed": "Delete failed",
            "upgradeFailed": "Upgrade failed",
            "exportFailed": "Export failed",
            "browserNotSupported": "Browser not supported",
            "copyFailed": "Copy failed",
            "createDownloadLinkFailed": "Failed to create download link",
            "exportRetry": "Export failed, please retry"
        },
        "success": {
            "assetsCreated": "Successfully created {{count}} migration assets",
            "analysisSaved": "Analysis saved",
            "deleted": "Deleted successfully",
            "upgraded": "Upgraded successfully",
            "exportCSV": "CSV Exported",
            "copied": "Copied to clipboard",
            "exportChecklist": "Checklist exported"
        },
        "manualInput": {
            "noSummary": "No summary",
            "webPixelMigration": "Web Pixel Migration",
            "checkoutUiExtension": "Checkout UI Extension",
            "manualReview": "Manual Review",
            "displayName": "{{name}}"
        },
        "csvHeaders": {
            "serialNumber": "No.",
            "scriptSummary": "Script Summary",
            "identifiedPlatform": "Identified Platform",
            "suggestedAlternative": "Suggested Alternative",
            "riskScore": "Risk Score",
            "majorRisk": "Major Risk",
            "suggestedAction": "Suggested Action"
        },
        "tabs": {
            "auto": "Auto Scan",
            "manual": "Manual Analysis",
            "checklist": "Checklist"
        },
        "manualSupplement": {
            "title": "Script Content Analysis",
            "desc": "Paste scripts from 'Additional Scripts' or 'ScriptTags' here. The system will analyze their behavior, identify platforms, and assess risks (PII access, blocking code, etc.).",
            "privacy": {
                "title": "🔒 Privacy & Security Analysis Logic",
                "item1": "• Pure client-side analysis: Script content is analyzed in your browser first.",
                "item2": "• No execution: Scripts are analyzed as text, not executed.",
                "item3": "• Data Minimization: Only analysis results (risks, platforms) are saved.",
                "item4": "• PII Filtering: Detected PII (emails, phones) is redacted before saving."
            },
            "deadline": {
                "title": "⚠️ Deprecation Deadline: {{plusDate}} (Plus) / {{nonPlusDate}} (Non-Plus)",
                "desc": "Shopify will turn off checkout.liquid and Additional Scripts.",
                "disclaimer": "* Dates subject to Shopify official announcements.",
                "remaining": "Status: {{text}} - {{desc}}"
            },
            "actions": {
                "migrate": "Migrate Now",
                "pixel": "Config Pixel"
            },
            "howTo": {
                "title": "How to use:",
                "step1": "1. Copy script from Shopify Admin",
                "step2": "2. Paste into the editor below",
                "step3": "3. Click 'Analyze Script'",
                "step4": "4. View risks and migration suggestions"
            },
            "buttons": {
                "upgradeWizard": "Upgrade Wizard Guide",
                "guidedInfo": "Guided Info",
                "importWizard": "Import Wizard"
            },
            "progress": "Analyzing... {{current}}/{{total}}",
            "addChecklist": "Add to Checklist",
            "checklist": {
                "title": "Replacement Checklist",
                "exportCSV": "Export CSV",
                "platform": "Platform",
                "suggestion": "Suggestion",
                "riskScore": "Risk Score",
                "majorRisk": "Major Risk",
                "remove": "Remove",
                "suggestions": {
                    "webPixel": "Web Pixel",
                    "uiExtension": "UI Extension",
                    "manual": "Manual Review"
                }
            },
            "riskDetails": "Risk Details",
            "migrationSuggestions": {
                "title": "Migration Suggestions",
                "badge": "AI Generated",
                "comprehensive": "Comprehensive Checklist",
                "configure": "Configure",
                "viewApp": "View App",
                "tool": "Go to Migration Tool"
            },
            "save": {
                "title": "Save Analysis",
                "desc": "Save this analysis to your migration checklist.",
                "saved": "Saved",
                "processPaste": "Process Paste",
                "processed": "Processed",
                "saveAudit": "Save to Audit"
            }
        }
    }
}

new_keys_zh = {
    "scan": {
        "analysis": {
            "risks": {
                "pii_access": {
                    "name": "检测到 PII（个人身份信息）访问",
                    "description": "脚本可能读取客户{{types}}等敏感信息，需要确保符合隐私法规（GDPR、CCPA）。Web Pixel 沙箱环境无法直接访问这些信息；如确需处理，请按 Shopify 官方能力与审核要求实施（PCD/权限），并最小化数据处理。",
                    "details": "检测到 {{count}} 处 PII 访问: {{types}}"
                },
                "window_document_access": {
                    "name": "检测到 window/document 全局对象访问",
                    "description": "脚本使用了 window、document 或 DOM 操作。Web Pixel 运行在受限沙箱中，无法访问这些对象，需要在迁移时使用 Shopify 提供的受控 API 替代（如 analytics.subscribe、settings 等）",
                    "details": "检测到 {{count}} 处访问: {{issues}}"
                },
                "blocking_load": {
                    "name": "检测到阻塞加载的代码",
                    "description": "脚本可能阻塞页面渲染，影响用户体验和页面性能。检测到：{{types}}",
                    "details": "检测到 {{count}} 处阻塞代码：{{types}}"
                },
                "duplicate_triggers": {
                    "name": "检测到重复触发的事件",
                    "description": "脚本可能多次触发相同事件，导致重复追踪和数据不准确",
                    "details": "检测到 {{count}} 个重复的事件调用"
                },
                "additional_scripts_detected": {
                    "name": "Additional Scripts 中检测到追踪代码",
                    "description": "建议迁移到 Web Pixel 以获得更好的兼容性和隐私合规",
                    "details": "检测到平台: {{platforms}}"
                },
                "legacy_ua": {
                    "name": "使用旧版 Universal Analytics",
                    "description": "Universal Analytics 已于 2023 年 7 月停止处理数据，请迁移到 GA4"
                },
                "inline_script_tags": {
                    "name": "内联 Script 标签",
                    "description": "内联脚本可能影响页面加载性能，建议使用异步加载或 Web Pixel"
                }
            },
            "recommendations": {
                "checklist": "\n📋 **迁移清单建议**:\n  1. 优先迁移广告平台（Meta、TikTok）以避免归因数据丢失\n  2. 启用 Web Pixel 并完成测试订单验收\n  3. 验证迁移后数据正常，再删除旧脚本\n  4. 非支持平台（Bing、Pinterest 等）使用官方应用",
                "unknown": "ℹ️ **未检测到已知追踪平台**\n  → 可能是自定义脚本、Survey 工具、Post-purchase upsell 等\n  → 迁移方案:\n    • Survey/表单 → 按 Shopify 官方能力手动迁移\n    • Post-purchase upsell → Shopify 官方 post-purchase 扩展\n    • 自定义追踪 → Custom Pixel 或 Web Pixel\n  → 建议: 确认脚本用途后选择对应迁移方案",
                "default": "ℹ️ **{{platform}}**\n  → 请确认此追踪代码的用途，并评估是否需要迁移到 Web Pixel 或服务端方案",
                "google": "ℹ️ **Google Analytics 4**\n  → 推荐：使用 Shopify 的 Google & YouTube 应用进行 Web Pixel 自动设置\n  → 替代：使用 Custom Pixel 进行高级定制",
                "meta": "ℹ️ **Meta Pixel (Facebook)**\n  → 推荐：使用 Shopify 的 Facebook & Instagram 应用\n  → 替代：使用 Custom Pixel 进行自定义事件",
                "tiktok": "ℹ️ **TikTok Pixel**\n  → 推荐：使用 Shopify 的 TikTok 应用\n  → 替代：使用 Custom Pixel",
                "pinterest": "ℹ️ **Pinterest Tag**\n  → 推荐：使用 Shopify 的 Pinterest 应用",
                "snapchat": "ℹ️ **Snapchat Pixel**\n  → 推荐：使用 Shopify 的 Snapchat Ads 应用"
            }
        },
        "intro": {
            "manual": {
                "title": "手动脚本分析",
                "description": "分析并迁移来自 checkout 的自定义脚本",
                "items": [
                    "粘贴脚本内容以识别平台",
                    "检测潜在风险和 PII 访问",
                    "获取迁移建议"
                ],
                "action": {
                    "primary": "开始分析",
                    "secondary": "查看清单"
                }
            },
            "checklist": {
                "title": "迁移清单",
                "description": "追踪您的迁移进度",
                "items": [
                    "查看已识别的脚本和风险",
                    "追踪迁移状态",
                    "导出清单为 CSV"
                ],
                "action": {
                    "primary": "查看清单",
                    "secondary": "返回自动扫描"
                }
            },
            "auto": {
                "title": "自动扫描",
                "description": "自动扫描您店铺的追踪脚本",
                "items": [
                    "检测 ScriptTags 和 Web Pixels",
                    "识别追踪平台",
                    "查看风险评估"
                ],
                "action": {
                    "primary": "开始自动扫描",
                    "secondary": "手动分析"
                }
            }
        },
        "pageTitle": "Tracking Guardian - 扫描与迁移",
        "pageSubtitle": "检测、分析并迁移您的追踪脚本",
        "modals": {
            "guide": {
                "title": "迁移指南"
            },
            "cleanScriptTag": {
                "title": "清理 ScriptTag {{id}}"
            }
        },
        "errors": {
            "invalidPixelId": "无效的 Pixel ID",
            "invalidPixelFormat": "无效的 Pixel 格式",
            "shopNotFound": "找不到店铺",
            "selectPlatform": "请选择一个平台",
            "processFailed": "处理失败",
            "saveFailed": "保存失败: ",
            "deleteFailed": "删除失败",
            "upgradeFailed": "升级失败",
            "exportFailed": "导出失败",
            "browserNotSupported": "浏览器不支持",
            "copyFailed": "复制失败",
            "createDownloadLinkFailed": "创建下载链接失败",
            "exportRetry": "导出失败，请重试"
        },
        "success": {
            "assetsCreated": "成功创建 {{count}} 个迁移资产",
            "analysisSaved": "分析已保存",
            "deleted": "删除成功",
            "upgraded": "升级成功",
            "exportCSV": "CSV 已导出",
            "copied": "已复制到剪贴板",
            "exportChecklist": "清单已导出"
        },
        "manualInput": {
            "noSummary": "无摘要",
            "webPixelMigration": "Web Pixel 迁移",
            "checkoutUiExtension": "Checkout UI Extension",
            "manualReview": "人工审查",
            "displayName": "{{name}}"
        },
        "csvHeaders": {
            "serialNumber": "序号",
            "scriptSummary": "脚本摘要",
            "identifiedPlatform": "识别平台",
            "suggestedAlternative": "建议替代方案",
            "riskScore": "风险评分",
            "majorRisk": "主要风险",
            "suggestedAction": "建议操作"
        },
        "tabs": {
            "auto": "自动扫描",
            "manual": "手动分析",
            "checklist": "迁移清单"
        },
        "manualSupplement": {
            "title": "脚本内容分析",
            "desc": "在此粘贴来自「Additional Scripts」或「ScriptTags」的脚本内容。系统将分析其行为，识别平台，并评估风险（PII 访问、阻塞代码等）。",
            "privacy": {
                "title": "🔒 隐私与安全分析逻辑",
                "item1": "• 纯客户端分析：脚本内容首先在您的浏览器中进行分析。",
                "item2": "• 不执行：脚本仅作为文本进行分析，不会被执行。",
                "item3": "• 数据最小化：仅保存分析结果（风险、平台）。",
                "item4": "• PII 过滤：保存前会脱敏检测到的 PII（邮箱、电话）。"
            },
            "deadline": {
                "title": "⚠️ 废弃截止日期：{{plusDate}} (Plus) / {{nonPlusDate}} (Non-Plus)",
                "desc": "Shopify 将关闭 checkout.liquid 和 Additional Scripts。",
                "disclaimer": "* 日期以 Shopify 官方公告为准。",
                "remaining": "状态：{{text}} - {{desc}}"
            },
            "actions": {
                "migrate": "立即迁移",
                "pixel": "配置 Pixel"
            },
            "howTo": {
                "title": "使用方法：",
                "step1": "1. 从 Shopify Admin 复制脚本",
                "step2": "2. 粘贴到下方编辑器",
                "step3": "3. 点击「分析脚本」",
                "step4": "4. 查看风险和迁移建议"
            },
            "buttons": {
                "upgradeWizard": "升级向导指南",
                "guidedInfo": "引导式录入",
                "importWizard": "导入向导"
            },
            "progress": "分析中... {{current}}/{{total}}",
            "addChecklist": "添加到清单",
            "checklist": {
                "title": "替换清单",
                "exportCSV": "导出 CSV",
                "platform": "平台",
                "suggestion": "建议",
                "riskScore": "风险分",
                "majorRisk": "主要风险",
                "remove": "移除",
                "suggestions": {
                    "webPixel": "Web Pixel",
                    "uiExtension": "UI Extension",
                    "manual": "人工审查"
                }
            },
            "riskDetails": "风险详情",
            "migrationSuggestions": {
                "title": "迁移建议",
                "badge": "AI 生成",
                "comprehensive": "迁移清单建议",
                "configure": "配置",
                "viewApp": "查看应用",
                "tool": "前往迁移工具"
            },
            "save": {
                "title": "保存分析",
                "desc": "将此分析结果保存到您的迁移清单中。",
                "saved": "已保存",
                "processPaste": "处理粘贴",
                "processed": "已处理",
                "saveAudit": "保存到审计"
            }
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
