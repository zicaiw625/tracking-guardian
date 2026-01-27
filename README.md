# Tracking Guardian

**Shopify 升级迁移交付平台** - 帮助商家在 Shopify Checkout Extensibility 升级截止日前，安全迁移追踪脚本和页面功能，提供可交付的验收报告和断档监控。

## 🎯 产品定位

**升级迁移交付平台** - 帮助商家在 Shopify Checkout Extensibility 升级截止日前，安全迁移追踪脚本和页面功能

### 我们的确定性来自 Shopify 的硬 deadline

- **Plus 店铺**：从 **2026-01 开始自动升级**（legacy 定制会丢失）
- **非 Plus 店铺**：最晚 **2026-08-26** 必须完成升级
- Legacy 的 `checkout.liquid`、`additional scripts`、`script tags` 会逐步被 sunset

### v1 的核心承诺（不是"我帮你追踪效果提升"，而是）

✅ **升级不丢功能/不丢数据**（在 Shopify 允许范围内）  
✅ **给你一份"可交付的验收报告"**（PDF/CSV，给老板/客户看的证据）  
✅ **上线后有断档告警**（事件量骤降、失败率监控）

### 核心价值主张

避开直接硬刚 Elevar/Littledata（他们价位与预期都更高，$99+/月），专注于让商家**"敢点发布/敢切 Live"**的核心能力。

**产品卖点话术**：
- "替换 Additional Scripts，减少结账页脚本风险"
- "基于 Web Pixels + Customer Accounts UI Extensions 的合规迁移"
- "验收报告 + 断档告警（给老板/客户看的证据）"

## v1 MVP 核心功能（付费理由非常硬）

### (A) 免费：Audit 风险报告（必须强）
- **自动扫描**：通过 Shopify API 读取已安装的 ScriptTags 和 Web Pixels
- **手动分析**：支持手动粘贴 Additional Scripts 内容进行分析
  - ⚠️ **注意**：Shopify API 无法自动读取 checkout.liquid 中的 Additional Scripts，需要商家手动复制粘贴
- **迁移清单**：生成完整的迁移清单，包含每个待迁移项
- **风险分级**：基于风险等级、影响范围、迁移难度进行分级（高/中/低）
- **替代路径**：明确标注每个迁移项的替代路径（Web Pixel / Checkout UI Extension / 不可迁移）
- **截止日期提醒**：根据店铺类型（Plus/非Plus）显示 Shopify 官方截止日期
  - Plus 店铺：2026-01 开始自动升级
  - 非 Plus 店铺：最晚 2026-08-26
- **可分享报告链接**：免费用户可查看和分享报告链接，但导出功能需付费

### (B) 付费：像素"最小可用迁移"（标准事件映射 + 参数完整率）
- **支持的平台**（v1 只做这3个）：
  - Google Analytics 4 (GA4)
  - Meta (Facebook) Pixel
  - TikTok Pixel
- **标准事件映射**：自动映射标准电商事件（purchase、view_item、add_to_cart 等）
- **参数完整率检查**：验证事件参数（value、currency、items 等）的完整性
- **可下载 payload 证据**：支持下载事件 payload，用于验证和存档
- **Test/Live 环境切换**：支持测试环境验证后再发布到生产环境
- **事件流预览**：实时预览事件触发情况

> **技术说明**：Web Pixel 运行在严格沙箱（Web Worker）环境中，很多能力受限。我们会明确告知限制，并提供可行的替代方案。

### (C) 付费：Thank you / Order status 模块库（v1 包含 3 个核心模块）
- **Post-purchase Survey（购后问卷）**：收集客户反馈，了解获客渠道（官方示例场景，有强差异化）
- **Help & Support 模块（帮助中心/联系客服）**：迁移替代件、配置简单，包含 FAQ、联系客服、继续购物等功能
- **Reorder（再购按钮）**：一键重新购买相同商品，仅在 Customer Accounts 的 Order status 页面可用（需要客户账户认证，不支持旧版订单状态页）。**注意**：Reorder 属于 v1.0 代码预埋，默认关闭，需 PCD 审批后开放。

> **⚠️ 重要提示：Order Status 模块仅支持 Customer Accounts 体系**
> 
> Order Status 模块使用 `customer-account.order-status.block.render` target，仅适用于 Customer Accounts 体系下的订单状态页。如果您的店铺使用旧版订单状态页（非 Customer Accounts），Order Status 模块将不会显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。
> 
> 请确认您的店铺已启用 Customer Accounts 功能（可在 Shopify Admin → 设置 → 客户账户中检查），否则模块不会在订单状态页显示。如果未启用，请先在 Shopify Admin → 设置 → 客户账户中启用 Customer Accounts 功能，然后才能使用 Order status 模块。
> 
> **文档引用说明（避免误导）**：
> 
> 请参考 [Customer Accounts UI Extensions](https://shopify.dev/docs/apps/customer-accounts/ui-extensions) 官方文档。注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions。

> **v1.1 以后规划**：以下模块在 v1 中**不可用**（代码中已标记为 disabled），将在后续版本发布：
> - Order Tracking（物流追踪）- 需深集成，API/适配会膨胀
> - Upsell Offer（追加销售）- 边界条件复杂
> 
> **注意**：Reorder 模块需要 Protected Customer Data (PCD) 访问权限。PCD 功能需要 Shopify 审核批准，默认禁用。获得批准后可在设置中启用。

### (D) 付费：验收（Verification）+ 断档监控（Monitoring）
这是产品的"交付件"，也是 Agency 愿意付钱的关键。

- **验收功能**：
  - 测试清单：生成完整的测试清单
  - 事件触发记录：实时记录事件触发情况
  - 参数完整率：检查事件参数的完整性
  - 订单一致性：验证事件金额/币种与 Shopify 订单的一致性
  - 隐私合规检查：验证像素是否尊重 consent / customerPrivacy
  
  > **⚠️ v1.0 验收范围说明**：
  > - ✅ **支持的事件类型**：checkout_started、checkout_completed、checkout_contact_info_submitted、checkout_shipping_info_submitted、payment_info_submitted、product_added_to_cart、product_viewed、page_viewed 等 Web Pixels 标准 checkout 漏斗事件
  > - ❌ **不支持的事件类型**：退款（refund）、订单取消（cancel）、订单编辑（order_edit）、订阅订单（subscription）等事件在 v1.0 中不可验收
  > - **原因**：Web Pixel Extension 运行在 strict sandbox 环境，只能订阅 Shopify 标准 checkout 漏斗事件。退款、取消、编辑订单、订阅等事件需要订单 webhooks 或后台定时对账才能获取，将在 v1.1+ 版本中通过订单 webhooks 实现（严格做 PII 最小化）
- **监控功能**：
  - 事件量骤降检测：监控事件量的异常下降
  - 失败率阈值告警：当失败率超过阈值时告警
  - Purchase 缺参率监控：监控 purchase 事件关键参数的缺失率
  - 多渠道告警：支持邮件/Slack/Telegram 告警

## 服务器端转化追踪（Server-side CAPI/MP）

v1.0 版本**已包含**服务器端转化追踪能力，支持以下平台：
- Meta Conversions API (CAPI)
- GA4 Measurement Protocol
- TikTok Events API

**功能说明**：
- 支持客户端/服务端混合去重（hybrid mode）
- 事件通过服务端 API 直接发送到广告平台，提高数据可靠性
- 支持 Test/Live 环境切换
- 完整的发送状态记录和错误处理

**配置方式**：在「设置」页面的「服务端追踪」标签页中配置平台凭证。

## 未来版本规划（v1 暂不包含）

### 深集成功能
- ⚠️ **v1 暂不包含**：
  - AfterShip/17Track 等物流追踪集成（API/适配会膨胀）
  - 其他第三方服务深度集成

### 其他 UI 模块
- ⚠️ **v1 暂不包含**：
  - Shipping Tracker（物流追踪）- 需深集成，v1.1+
  - Upsell Offer（二次购买优惠）- 边界条件复杂，v1.1+
- **Reorder（再购按钮）**：代码已实现，默认关闭，需 PCD 审批后开放

## Agency 多店 / 白标 / 团队（即将推出 v1.1）

以下能力为 Roadmap，**即将推出 (v1.1)**，当前版本不包含：

- **多店工作区**：创建和管理多个店铺分组 *Coming soon (v1.1)*
- **批量 Audit 扫描**：批量运行扫描，跟踪进度和结果汇总 *Coming soon (v1.1)*
- **批量应用像素模板**：一键将配置应用到多个店铺 *Coming soon (v1.1)*
- **迁移验收报告导出（多店铺）**：生成多店铺迁移报告（PDF/CSV）*Coming soon (v1.1)*
- **白标报告支持**：支持自定义品牌（Agency 品牌）*Coming soon (v1.1)*
- **团队协作**：Owner/Admin/Viewer 权限 *Coming soon (v1.1)*

### 套餐与定价（迁移交付导向）

市场参照：成熟 tracking 工具普遍 $99+/月甚至更高。我们 $29/$79/$199 的优势是"迁移助手 + 验收交付"，定价表达这个价值。

| 套餐 | 定价 | 适用场景 | 核心能力 |
| --- | --- | --- | --- |
| **Free** | $0 | 扫描、评估阶段 | Audit + 分享链接（不导出）、迁移清单与建议、风险分级与替代路径、截止日期提醒 |
| **Starter** | **$29/月** | 像素迁移阶段 | 像素迁移（1 平台）、Survey 或 Helpdesk 二选一、基础验收（不含报告导出）、标准事件映射 + 参数完整率、可下载 payload 证据、Test/Live 环境切换 |
| **Growth** | **$79/月** | 项目交付阶段 | 导出报告（PDF/CSV）+ 监控告警、像素迁移 + 模块发布、事件参数完整率、订单金额/币种一致性验证、隐私合规检查、每月 10,000 笔订单追踪 |
| **Agency** | **$199/月** | 多店代理/协作 | 多店/白标/团队 *即将推出 (v1.1)*；无限像素、全部模块、验收报告导出、每月 100,000 笔订单、SLA、专属客户成功经理 |

> **注意**：Monitor 计划（$29/月，可选叠加）不在 v1.0 正式套餐列表中，将在后续版本中提供。

> **付费墙设计原则**：把"看报告"做免费，把"导出报告/分享给客户"做付费，非常适合 Agency 场景。
> 
> **付费触发点**（3个强 CTA，直接对应商家的"升级项目交付"）：
> 1. **启用像素迁移（Test 环境）** → 进入付费试用/订阅（Starter $29/月）
> 2. **发布 Thank you/Order status 模块** → 进入付费（Starter $29/月）
> 3. **生成验收报告（PDF/CSV）** → 付费（Growth $79/月）
>
> 权限/功能 gating 已在前端页面展示：升级 CTA 位于仪表盘与迁移页；默认 plan 为 Free。

## 技术栈

- **框架**: Remix + Shopify App Remix
- **UI**: Shopify Polaris
- **数据库**: PostgreSQL + Prisma ORM
- **扩展**: Web Pixel Extension + Checkout UI Extension
- **环境切换与回滚**：仅通过 `app/services/pixel-rollback.server.ts` 实现，勿使用其它遗留实现。

## 快速开始

### 前置要求

- Node.js 20.10+ (LTS recommended for Shopify CLI compatibility; `.nvmrc` pins 20.10.0)
- PostgreSQL 数据库
- Shopify Partner 账号
- Shopify CLI

### 安装步骤

1. **克隆项目并安装依赖**

```bash
cd "Post-purchase Tracking Guardian"
pnpm install
```

> 项目已统一使用 **pnpm**，CI 也仅支持 pnpm。Yarn（含 Yarn PnP）已移除且不再支持，务必避免提交 `.pnp.*` 或 `.yarn/` 等文件。

> 仓库已包含 `pnpm-lock.yaml`，在 CI 或部署环境请使用 `pnpm install --frozen-lockfile` 确保依赖锁定。当前锁文件基于本地缓存生成，如需完全同步官方 registry，请在可访问 npm registry 的环境重新运行 `pnpm install --lockfile-only` / `pnpm install` 并提交更新后的锁文件。

2. **配置环境变量**

创建 `.env` 文件：

```env
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SCOPES=read_script_tags,read_pixels,write_pixels,read_orders
SHOPIFY_APP_URL=https://your-app-url.com
DATABASE_URL=postgresql://user:password@localhost:5432/tracking_guardian
```

**重要：SCOPES 配置说明（必须完全一致）**

所有列出的权限均为核心功能所必需，**必须全部包含**，不能省略。请确保以下三个位置的 SCOPES 配置**完全一致**：

1. `shopify.app.toml` 中的 `[access_scopes]` 部分（第7行）
2. 生产环境 `SCOPES` 环境变量（如 `render.yaml` 第60-61行或部署平台配置）
3. 本地开发 `.env` 文件中的 `SCOPES` 变量

**标准配置（所有环境必须完全一致，包括顺序和拼写）**：
```
SCOPES=read_script_tags,read_pixels,write_pixels,read_orders
```

**⚠️ 关键要求**：
- 所有三个位置的配置必须**完全一致**（包括权限顺序和拼写）
- `read_orders` 权限是**必需的**，不能省略
- 如果配置不一致，会导致安装后需要反复 re-auth、某些页面/功能偶发 403 错误

**权限说明**：

- `read_script_tags`：扫描旧版 ScriptTags 用于迁移建议
- `read_pixels`：查询已安装的 Web Pixel 状态
- `write_pixels`：创建/更新 App Pixel Extension
- `read_orders`：**必需** - 用于验收验证、对账差异检查、订单金额一致性验证

**⚠️ 特别注意**：`read_orders` 权限是验收和监控功能的核心依赖。如果省略此权限，以下功能将无法正常工作：
- 验收向导中的订单金额/币种一致性验证
- 监控面板中的对账差异检查
- 订单相关的验收报告生成

**配置一致性检查清单**：

- [ ] `shopify.app.toml` 第7行的 scopes 包含所有 4 个权限（包括 `read_orders`）
- [ ] 生产环境 `SCOPES` 环境变量（如 `render.yaml` 第60-61行）包含所有 4 个权限（包括 `read_orders`）
- [ ] 本地开发 `.env` 文件中的 `SCOPES` 包含所有 4 个权限（包括 `read_orders`）
- [ ] 三个位置的权限顺序和拼写**完全一致**（必须完全相同）

**如果配置不一致，会导致**：
- 安装后需要反复 re-auth
- 某些页面/功能偶发 403 错误（尤其是验收/对账需要订单读取时）
- 验收验证功能无法正常工作
- 对账差异检查无法执行
- 订单金额一致性验证失败

# P0-2: Web Pixel Origin null 兼容配置（生产环境必须显式设置）
# ⚠️ 生产环境部署必配项：此变量在生产环境必须显式设置，否则应用启动会失败
# Shopify web pixel / customer events 在沙箱环境（iframe/Web Worker）中经常出现 Origin: null
# 生产环境必须显式设置此变量（true/false）；若需要接收 Origin: null 的真实事件，建议设置为 true
PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=true

# PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY 语义说明：
# - true: 允许 null/missing Origin 仅当请求带签名，并为之设置 CORS（推荐：生产且接收 pixel 事件时显式设置）
#   * 当 Shopify 像素在沙箱环境中运行时，Origin 可能为 null，设置 true 可确保事件不丢失
#   * 仅带有效 HMAC 签名的 null Origin 请求会被接受，未签名请求仍会被拒绝
# - false: 不支持 null（CORS 不配合，null 请求将失败，导致事件丢失）
#   * 如果设置为 false，所有 Origin: null 的请求将被拒绝，可能导致事件丢失
# - 生产未设置时会阻止启动，必须明确设置 true 或 false
# 
# ⚠️ 重要提示：
# - 此配置直接影响事件接收能力，必须在生产环境部署前验证
# - 建议在 Diagnostics 页面检查配置状态，确保正确设置
# - 如果遇到"为什么收不到事件"的问题，首先检查此配置是否正确

# 可选：安全相关环境变量
CRON_SECRET=your_cron_secret_min_32_chars  # 用于 cron job 鉴权
ENCRYPTION_SECRET=your_encryption_secret_min_32_chars  # 用于数据加密
ENCRYPTION_SALT=your_encryption_salt_min_16_chars
PIXEL_STRICT_ORIGIN=false
```

`ENCRYPTION_SALT` **必须稳定不变**（不要在每次部署时更换），否则历史密文将无法解密。可使用以下命令生成一次并持久保存：

```bash
openssl rand -hex 16
```

`PIXEL_STRICT_ORIGIN=true` 时，即使请求带签名也必须通过 origin allowlist 校验；默认保持宽松策略以兼容 Shopify 沙箱环境。

3. **初始化数据库**

```bash
pnpm generate
pnpm db:deploy
```

4. **启动开发服务器**

```bash
pnpm dev
```

### 部署

#### ⚠️ 重要：扩展的 BACKEND_URL 注入是生命线

**扩展的 BACKEND_URL 注入是生命线，必须在所有部署流程中执行。**

- **生产环境部署必须使用**：`pnpm deploy:ext`（该命令会自动执行 `pnpm ext:inject` 和 `pnpm ext:validate`）
- **禁止直接使用**：`shopify app deploy`（不会注入 BACKEND_URL，会导致像素扩展无法工作）
- **如果占位符未被替换**：像素扩展会静默禁用事件发送，不会显示错误，导致事件丢失
- **CI/CD 强制验证**：`pnpm ext:validate` 已集成到部署流程中，验证失败将返回 exit code 1，**直接中断构建**，避免部署有问题的扩展

**CI/CD 构建流程说明（关键要求）**：

所有 CI/CD 流程（包括 Render、Vercel、GitHub Actions 等）的构建命令**必须包含** `pnpm ext:validate`，且必须使用 `&&` 连接，确保验证失败时构建中断：

```bash
pnpm install --frozen-lockfile && pnpm generate && pnpm db:deploy && pnpm ext:inject && pnpm ext:validate && pnpm build
```

**⚠️ 关键要求**：
- `pnpm ext:validate` 是**强制验证步骤**，失败会返回 exit code 1，**直接中断构建**
- 这是 BACKEND_URL 注入的生命线验证，必须在所有部署流程中执行
- 如果验证失败，构建会立即中断，不会部署有问题的扩展
- 这是强制验证步骤，确保扩展配置正确，避免事件丢失

**验证失败会检查以下内容**：
- BACKEND_URL 占位符是否已正确替换（如果未替换，构建会失败）
- 扩展配置文件格式是否正确
- Network access 权限配置是否正确
- 禁止使用的浏览器 API 检查

**已配置的 CI/CD 流程**：
- ✅ `render.yaml` 第32行：已包含 `pnpm ext:validate`
- ✅ `vercel.json` 第2行：已包含 `pnpm ext:validate`
- ✅ `package.json` render-build 脚本：已包含 `pnpm ext:validate`

**如果验证失败，构建会立即中断，不会部署有问题的扩展。这是强制验证步骤，确保扩展配置正确。**

**部署前检查清单**：
1. 确保环境变量 `SHOPIFY_APP_URL` 已正确设置
2. 在 CI/CD 流程中，部署前必须运行 `pnpm ext:inject` 和 `pnpm ext:validate` 或使用 `pnpm deploy:ext`
3. 验证扩展构建产物中不再包含 `__BACKEND_URL_PLACEHOLDER__` 占位符
4. 确保该 URL 已在 Web Pixel Extension 的 allowlist 中配置（Partner Dashboard → App → API access → UI extensions network access）

#### Customer Account / Checkout UI Extension 网络访问配置

**扩展配置**：`extensions/thank-you-blocks/shopify.extension.toml` 中已设置 `network_access = true`，允许 UI extension 访问后端 API。

**Partner Dashboard 配置要求**：
- 必须在 Partner Dashboard 中申请并启用 UI extensions network access 权限
- 路径：Partner Dashboard → App → API access → UI extensions network access
- 必须将后端 URL 添加到允许列表（allowlist）
- 如果未在 Partner Dashboard 中配置，扩展虽然可以安装，但所有网络请求都会失败

**CORS 配置**：
- 后端 `app/utils/cors.ts` 中已实现动态 CORS 配置
- 支持 Shopify 平台域名的 CORS 请求
- 支持开发环境的本地域名（localhost）
- 自动处理 preflight 请求

**验证步骤**：
1. 确认 `extensions/thank-you-blocks/shopify.extension.toml` 中 `network_access = true` 已设置
2. 在 Partner Dashboard 中检查 UI extensions network access 权限是否已启用
3. 确认后端 URL 已添加到 allowlist
4. 测试 UI extension 的网络请求是否正常工作（如 Order Status 模块的状态获取）

**常见问题**：
- 如果 UI extension 的网络请求失败，首先检查 Partner Dashboard 中的 network access 配置
- 确保后端 URL 与 Partner Dashboard 中配置的 URL 完全一致（包括协议、域名、端口）
- 检查浏览器控制台是否有 CORS 错误

#### Webhook 路径与 raw body（HMAC 校验）

**工程规范约束**：对 `/webhooks`（及实际挂载的 webhook 路径）**禁止**添加会提前 `json()`/`text()`/`bodyParser` 消费 `Request` body 的中间件或全局逻辑；否则 `authenticate.webhook` 无法读取 raw body，HMAC 验证会失败。

**Shopify 审核要求**：Shopify 官方明确要求验证 HMAC 必须使用 raw body。一旦引入某些 body parser 中间件且顺序不对，很容易导致审核失败。

**实施要求**：
- Webhook 路由必须使用"先验签，再解析"的模式
- 禁止在 webhook 路由上使用任何会提前消费 body 的中间件
- 若使用自定义 Express/Connect 适配，需在配置中排除 webhook 路径的 body 解析
- 代码中已实现：`app/routes/webhooks.tsx` 直接调用 `authenticate.webhook(request)`，确保使用 raw body 进行 HMAC 验证

**维护注意事项**：
- 后续添加中间件时，必须确保不会影响 webhook 路由的 raw body 访问
- 建议在代码审查时检查 webhook 路由的中间件配置
- 如发现 HMAC 验证失败率异常升高，优先检查是否有中间件提前消费了 body

#### Render 部署（推荐 - 免费数据库）

项目包含 `render.yaml` Blueprint 文件，支持一键部署：

1. 推送代码到 GitHub
2. 在 [Render](https://render.com) 创建 Blueprint
3. 连接仓库，自动创建数据库和 Web 服务
4. 设置 Shopify API 环境变量

**重要配置说明**：
- **PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY（生产环境必配项）**：
  - 已在 `render.yaml` 中自动设置为 `true`，确保 Web Pixel 事件能正常接收
  - ⚠️ **必须显式设置**：生产环境必须明确设置此变量（true/false），未设置会导致应用启动失败
  - **作用**：Shopify 像素在沙箱环境（iframe/Web Worker）中可能出现 `Origin: null`，此配置决定是否接受此类请求
  - **推荐值**：`true`（仅带有效 HMAC 签名的 null Origin 请求会被接受）
  - **如果设置为 false**：所有 Origin: null 的请求将被拒绝，可能导致事件丢失
  - **验证方法**：在 Diagnostics 页面检查配置状态，或使用压测脚本 `--null-origin-only` 参数测试
- Cron Job 服务已自动配置，请确保在 Render Dashboard 中为 cron job 设置以下环境变量（从 web service 复制）：
  - `CRON_SECRET`（必须与 web service 相同）
  - `SHOPIFY_APP_URL`（web service 的完整 URL）
- **扩展部署**：在 Render 的构建命令中，已自动包含 `pnpm ext:inject` 和 `pnpm ext:validate` 步骤。`ext:validate` 会验证扩展配置，如果验证失败，构建将中断，避免部署有问题的扩展

详细步骤请参考 [SETUP.md](SETUP.md)

#### Vercel 部署

1. 连接 GitHub 仓库到 Vercel
2. 配置环境变量（需要外部数据库如 Neon）
3. 部署完成后更新 Shopify App URL

#### Railway 部署

```bash
railway login
railway init
railway add
railway up
```

## 项目结构

```
├── app/
│   ├── routes/
│   │   ├── app._index.tsx      # 仪表盘首页
│   │   ├── app.scan.tsx        # 扫描报告
│   │   ├── app.migrate.tsx     # 迁移工具
│   │   ├── app.monitor.tsx     # 监控面板
│   │   ├── app.settings.tsx    # 设置
│   │   └── webhooks.tsx        # Webhook 处理
│   ├── services/
│   │   ├── scanner.server.ts       # 扫描服务
│   │   ├── migration.server.ts     # 迁移服务
│   │   ├── delivery-health.server.ts # 发送健康检查
│   │   ├── notification.server.ts  # 通知服务
│   │   ├── retry.server.ts         # 重试队列服务
│   │   └── platforms/              # 广告平台集成
│   └── db.server.ts            # Prisma 客户端
├── extensions/
│   ├── tracking-pixel/         # Web Pixel Extension
│   └── thank-you-blocks/       # Checkout UI Extension
├── prisma/
│   └── schema.prisma           # 数据库模型
└── package.json
```

## API 权限说明

| 权限 | 用途 | 代码调用点 | 首次安装必需? | 隐私承诺 |
|------|------|-----------|--------------|---------|
| `read_script_tags` | 扫描旧版 ScriptTags 用于迁移建议 | `scanner.server.ts` | ✅ 是 |
| `read_pixels` | 查询已安装的 Web Pixel 状态 | `migration.server.ts` | ✅ 是 |
| `write_pixels` | 创建/更新 App Pixel Extension | `migration.server.ts` | ✅ 是 |
| `read_orders` | 验收验证/对账差异检查/订单金额一致性验证 | `app.verification.tsx` / `reconciliation.server.ts` | ✅ 是 |

**权限说明**：所有权限均为核心功能所必需，**必须全部包含在 SCOPES 环境变量中**。

**⚠️ 重要：`read_orders` 权限是必需的**

`read_orders` 权限用于以下核心功能，**不能省略**：
- 验收向导中的订单金额/币种一致性验证
- 监控面板中的对账差异检查
- 订单相关的验收报告生成

如果省略 `read_orders` 权限，以下功能将无法正常工作：
- 验收验证功能会返回 403 错误
- 对账差异检查无法执行
- 订单金额一致性验证失败

我们不对终端客户收集 PII；read_orders 仅用于对账、验收且字段最小化；再购等需 PCD 审批，有硬门禁。

**配置一致性要求**：

请确保以下三个位置的 SCOPES 配置**完全一致**（包括权限顺序和拼写）：
1. `shopify.app.toml` 第7行的 `[access_scopes]` 部分
2. 生产环境 `SCOPES` 环境变量（如 `render.yaml` 第60-61行或部署平台配置）
3. 本地开发 `.env` 文件中的 `SCOPES` 变量

**标准配置**（所有环境必须完全一致）：
```
SCOPES=read_script_tags,read_pixels,write_pixels,read_orders
```

**⚠️ 关键要求**：
- `read_orders` 权限是**必需的**，不能省略
- 所有三个位置的配置必须**完全相同**（包括顺序和拼写）

如果配置不一致，可能导致：
- 安装后需要反复 re-auth
- 某些页面/功能偶发 403 错误（尤其是验收/对账需要订单读取时）
- 验收验证功能无法正常工作
- 对账差异检查无法执行
- 订单金额一致性验证失败

### API 端点说明

**像素事件接收端点**：

- **唯一端点**：`POST /ingest`
  - PRD 8.2 定义的批量事件接口，唯一推荐使用的端点
  - 支持批量格式：`{ events: [event1, event2, ...], timestamp: number }`
  - 同时支持单事件格式（向后兼容）
  - 支持 CORS、HMAC 完整性校验、时间窗校验、nonce 防重放等安全机制
  - Web Pixel Extension 已实现批量发送到 `/ingest` 端点，符合 PRD 性能目标
  - **审计结论对齐**：接口形态与 PRD 8.2 完全一致，解决了"Ingest API 形态不一致"问题
  
- **重要说明**：
  - **`/ingest` 是唯一的事件接收入口**，不存在其他接收端点
  - `app/lib/pixel-events/` 目录仅包含共享的工具函数（cors、validation、hmac-validation 等），不是独立的路由端点
  - 所有像素事件必须发送到 `POST /ingest`，不要使用其他路径
  - 对外文档和第三方集成必须使用 `POST /ingest`（符合 PRD 8.2）
  - Web Pixel Extension 使用批量格式发送到 `/ingest` 端点，提高性能
  - 批量格式支持最多 100 个事件，自动批处理提高并发处理能力
  - 单事件格式和批量格式都在 `/ingest` 端点中统一处理
  - 详细实现见 `app/routes/ingest.tsx`

**配置获取**：
- 端点 URL 可通过 `app/utils/config.ts` 中的 `getPixelEventEndpoint()` 函数获取
- 支持环境变量配置（开发/生产环境）

### P0-1: ScriptTag 权限说明

**重要提示**：应用**不请求 `write_script_tags` 权限**。

ScriptTag 清理需要商家手动操作：
1. **扫描检测**：识别店铺中已存在的旧版追踪脚本
2. **迁移建议**：生成从 ScriptTag 迁移到 Web Pixel 的建议
3. **手动清理指南**：提供清理 ScriptTag 的详细步骤

**我们不会**：
- ❌ 创建新的 ScriptTag
- ❌ 直接删除 ScriptTag（需商家手动操作）
- ❌ 在 TYP/OSP 页面注入任何客户端脚本

所有追踪功能通过 **Web Pixel Extension**（服务端）和 **Webhooks**（CAPI）实现。

### P0-3: 最小权限说明

- 所有 scopes 都有明确的代码调用点和业务理由
- 详细权限说明请参阅 [COMPLIANCE.md](COMPLIANCE.md) 中的 "Scopes Justification" 部分

## Webhook 订阅

### 应用生命周期
- `app/uninstalled` - 应用卸载时清理数据

### GDPR 合规 Webhook（自动处理）
- `customers/data_request` - 客户数据导出请求
- `customers/redact` - 客户数据删除请求
- `shop/redact` - 店铺数据完全删除

### 订单与退款 Webhook（v1.0 功能）
以下 webhooks 已启用，用于事件对账和验收验证：

- `orders/create` - 订单创建时记录订单摘要（用于对账）
- `orders/updated` - 订单更新时同步状态（用于对账）
- `orders/cancelled` - 订单取消时同步状态（用于对账）
- `orders/edited` - 订单编辑时同步状态（用于对账）
- `refunds/create` - 退款创建时同步状态（用于对账）

## 上架前 Checklist

提交 App Review 前请确认：

1. **Distribution**：Partner Dashboard → Distribution = **Public (App Store)**（否则 Billing API 不可用）。
2. **联系方式**：`support@tracking-guardian.app`、`help.tracking-guardian.app`、`status.tracking-guardian.app` 可访问；若为占位符，已在 `app/routes/support.tsx`、`app/routes/app.support.tsx`、`app/services/ui-extension.server.ts` 中改为真实邮箱/域名。
3. **PCD**：若保留 `read_orders` 并走强攻路线，已在 Partner 完成 PCD 申请配置，并准备好 [COMPLIANCE.md](COMPLIANCE.md) 中的「PCD 申请材料要点」作为支撑。

## Shopify App Store 审核 - Reviewer 快速验收路径

提交审核时可将以下步骤放入 Review notes / Test instructions，便于审核人员快速验收：

1. 安装应用后进入 **Audit**：点 Scan，生成风险报告
2. 进入 **Pixels**：创建一个 Pixel 配置（Test 模式），并说明 server-side 默认关闭
3. 在店铺下一个测试单
4. 进入 **Verification**：跑一次 quick run，看到事件收据与参数完整率
5. （Growth+）下载 PDF 报告（如果 reviewer 用的是免费计划，就说明该入口会提示升级）

Customer Account / Thank you block 与 Web Pixel 的配合、以及 PCD 的说明：我们不收集终端客户 PII；read_orders 仅用于对账验收且字段最小化；再购、订单状态等需 PCD 审批且有硬门禁。2025-12-10 后 Web Pixel 中 PII 字段需获批 PCD 才会出现。可参考 [COMPLIANCE.md](COMPLIANCE.md) 与应用内文案。

## Built for Shopify (BFS) 特性

### 上架与 BFS 策略

* **替换 Additional Scripts，减少结账页脚本风险** - 基于 Web Pixels + Customer Accounts UI Extensions 的合规迁移
* **验收报告 + 断档告警** - 给老板/客户看的证据
* **性能优化** - 符合 BFS LCP/CLS/INP 指标要求（LCP ≤2.5s、CLS ≤0.1、INP ≤200ms）

### 合规与平台要求

- **GraphQL Admin API**：所有 Admin 操作（WebPixel 创建/删除、checkoutProfiles 查询等）均使用 GraphQL，符合 2025-04-01 起新提交公共应用必须使用 GraphQL Admin API 的要求。代码参考：`app/services/admin-mutations.server.ts`、`app/services/checkout-profile.server.ts`。
- **隐私与最小权限**：
  - **默认事件收集模式（purchase_only）**：仅收集 `checkout_completed` 事件，符合隐私最小化原则
  - **可选全漏斗模式（full_funnel）**：商家可显式启用以收集更多事件（page_viewed, product_viewed, add_to_cart, checkout_started）
  - 默认严格同意策略；PCD 功能需显式开启且数据即时哈希、不落库；权限表见上
- **上线检查**：健康度评分基于近 7 日对账差异率；监控页记录像素心跳来源与送达率，便于自检 BFS 可靠性指标。

### 性能优化

- **最小化 API 调用**：批量处理订单数据，避免不必要的轮询
- **智能缓存**：使用内存缓存减少重复数据库查询
- **懒加载**：按需加载扫描历史和监控数据
- **减少脚本负载**：替换 Additional Scripts，使用 Web Pixels（Web Worker 沙箱环境）

### 稳定性保障

- **断路器模式**：防止级联故障，自动熔断和恢复
- **智能重试**：带指数退避的重试机制，处理临时错误
- **Dead Letter Queue**：失败任务自动进入死信队列，支持手动恢复
- **优雅降级**：平台 API 不可用时保留事件数据等待重试

### 安全与合规

- **最小权限原则**：仅请求必需的 API 权限
- **数据加密**：所有敏感凭证使用 AES-256-GCM 加密存储。IV 长度由 `app/utils/crypto.server` 的 `IV_LENGTH`（当前 16 bytes）统一管理，`token-encryption` 与通用 `encrypt`/`decrypt` 均使用该常量。若未来迁移到 12-byte IV，需引入版本前缀、保留对 16-byte 旧格式的解密，并在迁移脚本与运行手册中写清兼容期与轮换方式。
- **隐私策略**：可配置的 consent 策略（严格/平衡模式）
- **数据保留**：可配置的数据保留期限（30-365天）
- **审计日志**：所有敏感操作均记录审计日志

#### 后续加固与架构建议

- **用户可配置 URL 且服务端 fetch**：仅 hostname 字符串/`isPublicUrl` 不足，需在服务端做 DNS 解析后对解析结果做私网/本地/metadata 段拦截，并对 30x 重定向的最终落点做同样校验。
- **`/ingest` 处理模型**：当前为「快速返回 + 后台继续处理」；中长期可改为写入队列（Redis/DB job）→ 独立 worker 拉取，以降低高峰期 worker 占满风险。

#### 像素扩展 ingestion_key 威胁模型

**重要说明**：像素扩展（`extensions/tracking-pixel`）会将 `ingestion_key` 下发到客户端执行环境，用于完整性校验（HMAC 签名）上报事件。**ingestion_key 是完整性校验密钥，不是安全密钥。**

**威胁模型与安全边界**：

1. **客户端密钥的局限性**：
   - `ingestion_key` 主要用于防止"随便伪造请求"，而不是防止"有能力逆向/注入的攻击者"
   - 客户端环境中的任何密钥都可能被提取（通过浏览器 DevTools、网络抓包、代码逆向等）
   - 这是客户端安全模型的固有限制，无法完全避免

2. **多层防护机制**（缓解措施）：
   - **Origin 白名单校验**：仅允许来自 Shopify 店铺域名的请求
   - **Rate limiting**：限制同 shop 的请求频率，防止滥用
   - **Nonce 防重放**：每个事件包含唯一 nonce，防止重放攻击
   - **Timestamp 窗口校验**：限制请求时间戳的有效窗口
   - **Body size 限制**：限制请求体大小，防止 DoS
   - **IP/Shop rate limit**：基于 IP 和 shop 的限流
   - **异常检测与熔断**：检测异常峰值并自动熔断

3. **监控与告警**：
   - 监控同 shop 的异常峰值（如短时间内大量请求）
   - 监控签名失败率（可能表示密钥泄露或攻击尝试）
   - 监控 nonce 重放率（检测重放攻击）
   - 监控异常 IP 和请求模式

4. **最佳实践**：
   - 定期轮换 `ingestion_key`（虽然客户端仍可提取新密钥，但可限制旧密钥的有效期）
   - 监控异常请求模式，及时响应安全事件
   - 在生产环境启用所有安全校验（Origin、nonce、timestamp 等，HMAC 作为完整性信号）
   - 使用服务端追踪（CAPI）作为主要追踪方式，客户端追踪作为补充

**结论**：`ingestion_key` 是完整性校验密钥，用于完整性校验和反滥用，不是强认证凭证。其设计目标是"提高攻击门槛"而非"完全防止攻击"。通过多层防护机制，可以有效防止大部分自动化攻击和误用，但对于有能力的攻击者，客户端密钥的提取是不可避免的。这是客户端安全模型的权衡，需要在安全性和可用性之间取得平衡。真正的安全由 webhook/订单对账与整体架构设计提供。

#### 上线前安全压测建议（必须执行）

为确保生产环境稳定性，**必须在正式上线前执行以下压测**。这些测试是上线前的关键验证步骤，避免在生产环境高峰期出现事件丢失或服务不可用。

1. **高并发下单/事件峰值测试（上线前必须执行）**
   - **测试目标**：模拟黑五等高峰期的下单场景（建议峰值：100-1000 订单/分钟）
   - **验证内容**：
     - 验证 rate limit 配置是否会导致误杀正常请求
     - 检查事件队列处理能力和延迟情况
     - 监控数据库连接池和 API 调用频率
     - 验证事件处理吞吐量和响应时间
   - **重点验证**：rate limit 阈值是否合理，避免在高并发场景下误杀正常请求。建议根据实际业务峰值调整 `RATE_LIMIT_CONFIG.PIXEL_EVENTS` 配置。如果压测中发现误杀，需要调整 `app/utils/rate-limiter.ts` 中的 `pixel-events` 配置。
   - **实战建议**：使用项目内置压测脚本 `scripts/load-test-pixel-ingestion.mjs` 进行测试，建议在测试环境先验证，确认无误后再部署到生产环境。
   - **执行命令**：
     ```bash
     # 高并发压测（50并发，持续60秒）
     CONCURRENT_REQUESTS=50 DURATION=60 node scripts/load-test-pixel-ingestion.mjs
     
     # 峰值压测（100并发，持续120秒）
     CONCURRENT_REQUESTS=100 DURATION=120 node scripts/load-test-pixel-ingestion.mjs
     ```
   - **验收标准**：
     - 无 rate limit 误杀（所有正常请求应成功）
     - 事件处理延迟 < 2秒（P95）
     - 错误率 < 0.1%
     - 数据库连接池无耗尽

2. **Origin: null 场景测试（上线前必须执行）**
   - **测试目标**：验证 Web Pixel 在沙箱环境中发送事件时 Origin 为 null 的情况
   - **验证内容**：
     - 验证 `PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY` 环境变量已显式设置（生产环境必须设置）
     - 确认事件仍能正常接收和处理（不因 Origin 校验失败而丢失）
     - 检查日志中 Origin: null 的请求是否被正确标记和允许
   - **重点验证**：某些 Shopify 场景（如 Web Worker 沙箱环境）可能出现 `Origin: null`。若需要正常接收 null/missing origin 的 pixel 事件，建议显式设置 `PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=true`（仅带签名请求放行）；=false 时 null 请求将无法通过 CORS，导致事件丢失。
   - **实战建议**：使用压测脚本的 `--null-origin-only` 参数专门测试 Origin: null 场景，确保生产环境配置正确。
   - **执行命令**：
     ```bash
     # 仅测试 Origin: null 场景
     node scripts/load-test-pixel-ingestion.mjs --null-origin-only
     
     # 验证环境变量已设置
     echo $PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY
     ```
   - **验收标准**：
     - 所有 Origin: null 请求应成功处理
     - 无事件丢失
     - 日志中正确标记 Origin: null 请求

**压测工具建议**：
- 使用项目内置的压测脚本：`node scripts/load-test-pixel-ingestion.mjs`（推荐）
- 使用 Apache Bench (ab) 或 wrk 进行 HTTP 压力测试
- 使用 Shopify 测试订单功能模拟真实下单流程
- 监控应用日志、数据库性能和 API 响应时间
- **重要**：建议在测试环境先进行压测，确认配置无误后再部署到生产环境

**使用内置压测脚本**：
```bash
# 基础压测（10并发，100请求）
node scripts/load-test-pixel-ingestion.mjs

# 自定义并发和请求数
CONCURRENT_REQUESTS=50 TOTAL_REQUESTS=1000 node scripts/load-test-pixel-ingestion.mjs

# 高并发压测（50并发，持续60秒）
CONCURRENT_REQUESTS=50 DURATION=60 node scripts/load-test-pixel-ingestion.mjs

# 仅测试 Origin: null 场景（必须执行）
node scripts/load-test-pixel-ingestion.mjs --null-origin-only

# 指定后端 URL 和店铺域名
SHOPIFY_APP_URL=https://your-app.com SHOP_DOMAIN=test-shop.myshopify.com INGESTION_SECRET=your-secret node scripts/load-test-pixel-ingestion.mjs
```

**压测脚本自动检测内容**：
- Rate limit 触发情况（关键指标）
- Origin: null 场景支持（关键指标）
- 平均响应时间和 QPS
- 错误类型和频率
- 事件处理吞吐量

**上线前压测检查清单**：
- [ ] 高并发压测已执行（50+ 并发，持续 60+ 秒）
- [ ] Origin: null 场景测试已通过
- [ ] Rate limit 配置已验证（无误杀）
- [ ] 事件处理延迟 < 2秒（P95）
- [ ] 错误率 < 0.1%
- [ ] 数据库连接池无耗尽
- [ ] 环境变量 `PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=true` 已设置
- [ ] 压测结果已记录并归档

### 商家体验

- **清晰的 Onboarding**：3 步引导快速开始使用
- **诊断工具**：自助排障，快速定位问题
- **FAQ 支持**：常见问题内置解答
- **一键修复**：常见问题一键修复/引导
- **低打扰提示**：仅在关键时刻显示警告

### 监控与告警

- **健康度评分**：基于追踪成功率的综合评分
- **多渠道告警**：支持邮件、Slack、Telegram
- **事件漏斗**：可视化事件处理全流程
- **自动对账**：每日自动检查数据一致性

## 测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试
pnpm test tests/services/scanner.test.ts

# 运行测试并生成覆盖率报告
pnpm test:coverage
```

## 贡献指南

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 许可证

MIT License

## 支持

如有问题，请创建 GitHub Issue 或联系技术支持。
