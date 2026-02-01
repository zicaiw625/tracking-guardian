import json
import os

EN_PATH = 'app/locales/en.json'
ZH_PATH = 'app/locales/zh.json'

new_keys_en = {
    "ScanModals": {
        "Guidance": {
            "Step1Desc": "In Shopify Admin, go to Settings → Checkout and accounts → Thank you / Order status page upgrade",
            "Step2Desc": "Upgrade wizard will show the list of currently used Additional Scripts and ScriptTags",
            "Step3Desc": "For each script, copy its full content (including URL or inline code)",
            "Step4Desc": "Return to this page, paste the script content in the 'Script Analysis' tab, and click 'Analyze Script'",
            "Steps": {
                "Title": "Recommended Cleanup Steps:"
            },
            "NotFoundDesc": "If the ScriptTag is residue from an uninstalled app, you can:",
            "NotFoundOptions": {
                "Contact": "Contact Shopify Support, provide ScriptTag ID: {{id}}",
                "API": "Manually delete using Shopify GraphQL API (requires developer permissions)",
                "Expire": "Wait for ScriptTag to auto-expire (Plus merchants: {{plusDate}}, Non-Plus: {{nonPlusDate}} - check Admin for official dates)"
            }
        }
    }
}

new_keys_zh = {
    "ScanModals": {
        "Guidance": {
            "Step1Desc": "在 Shopify Admin 中，前往「设置」→「结账和订单处理」→「Thank you / Order status 页面升级」",
            "Step2Desc": "升级向导会显示当前使用的 Additional Scripts 和 ScriptTags 列表",
            "Step3Desc": "对于每个脚本，复制其完整内容（包括 URL 或内联代码）",
            "Step4Desc": "返回本页面，在「脚本内容分析」标签页中粘贴脚本内容，点击「分析脚本」进行识别",
            "Steps": {
                "Title": "推荐清理步骤："
            },
            "NotFoundDesc": "如果 ScriptTag 是由已卸载的应用创建的残留数据，您可以：",
            "NotFoundOptions": {
                "Contact": "联系 Shopify 支持，提供 ScriptTag ID: {{id}}",
                "API": "使用 Shopify GraphQL API 手动删除（需开发者权限）",
                "Expire": "等待 ScriptTag 自动过期（Plus 商家将于 {{plusDate}} 停止执行，非 Plus 商家将于 {{nonPlusDate}} 停止执行，请以 Admin 提示为准）"
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
