# AI Architecture Viewer v0.1.0 MVP 设计规格

> 历史文档：本页记录最初的 v0.1.0 内嵌模型方案。该方向已在 v0.2.0 中被“外部编码智能体 + MCP 交接”架构取代；当前产品说明以 [README](../README.md) 和 [CHANGELOG](../CHANGELOG.md) 为准。

## 产品定位

v0.1.0 是一个本地优先的、可验证的 AI 架构审阅器。它帮助个人开发者或小型团队把明确选择的项目资料转化为可审阅的架构建议；AI 只能生成提案，只有用户可以将提案写入草案并发布正式版本。

核心闭环：

```text
选择本地资料 → 生成证据 → AI 结构化提案 → 查看提案内变更并人工审阅 → 写入既有草案 → 沿用既有发布与版本历史
```

## v0.1.0 必须交付

- 一个完全虚构、可公开的默认示例项目。
- 资料来源登记与受限扫描：只扫描项目根目录内、用户明确选择的文本资料。
- DeepSeek 兼容的服务端 AI 适配器；未配置密钥时提供明确的本地说明和可测试的演示提案。
- 证据记录：相对路径、行范围、摘要、内容哈希、采集时间。
- 单个 AI 架构提案：可包含新增模块、修改模块、新增关系或删除候选。
- 以单个提案为单位接受或拒绝。接受后只写入当前/目标架构的现有草案，绝不直接发布。
- 复用现有当前、目标、对比、版本、文档和布局能力。
- 公开仓库所需的 README、配置模板、许可证、安全说明、示例项目与测试。

## 明确不做

- 用户账号、组织、多人协作、实时协同编辑。
- GitHub App、Webhook、自动扫描 Pull Request。
- 向量数据库、图数据库、持续同步和运行态遥测。
- 全语言 AST 分析、任意目录访问或上传整个仓库。
- AI 自动接受、自动写入正式版或自动发布。
- 改造既有画布的主导航、信息架构或审美语言。

## 用户旅程

1. 用户打开一个项目包，浏览已有当前/目标架构。
2. 用户在画布右上角打开“AI 分析”。
3. 用户查看本次可分析的本地资料，勾选要发送给模型的文件。
4. 系统将已选资料转换为带行号的证据片段，并请求 AI 返回结构化提案。
5. 用户在提案审阅对话框中同时查看建议、影响范围与证据。
6. 用户接受一个完整提案，系统使用现有 revision lock 写入草案。
7. 用户继续使用现有“审阅并发布”操作生成正式版。

## 视觉与交互原则

不增加新的主页面、仪表盘或路由。保留既有的“顶部项目语境 → 画布 → 右侧详情 → 抽屉/对话框”结构。

- 在画布右上角操作区加入紫色的“AI 分析”入口；它不替代绿色的发布操作。
- “AI 分析”打开右侧抽屉，含“资料来源 / AI 提案 / 审阅记录”三个轻量标签。
- “审阅提案”使用双栏对话框：左栏为架构变更，右栏为证据。
- 绿色只表示人工确认与正式发布；琥珀表示待确认；蓝色表示历史/对比；紫色只表示 AI 相关操作。
- 复用既有纸感背景、低饱和配色、细边框、圆角、宋体标题和白色卡片。
- 提案定位到画布时复用既有 compare-new、compare-changed、compare-only 与 focus 弱化样式。

## 数据边界

新增项目包数据使用一个独立、原子写入的项目级文件，且全部路径必须位于项目根目录内：

```text
analysis.json               # sources、evidence、proposals 和独立 baseRevision
```

建议的数据关系：

```text
Source → Evidence[] → ProposalChange[] → existing draft → published revision
```

`analysis.json` 的 `baseRevision` 与架构 revision 独立，避免一次分析写入跨多个文件产生不一致。每个提案绑定其创建时的正式架构 revision；接受前必须重新核验该基线且要求不存在未处理草案。

每个变更最少包含：

- 稳定 ID、变更类型、待审状态和一段说明。
- 证据 ID 列表和中/高/低置信度。
- 目标架构视图和图 ID。
- 可由服务端验证的单项架构补丁。

AI 只能提出语义补丁，不能提供或修改节点坐标、尺寸、人工确认字段、文档绑定、分组边框或路由点。服务端为新增节点确定性生成布局，并在人工接受后通过既有草案锁写入。

## AI Coding 协作 Skill

v0.1.0 内置三个独立、可复制的 Skill，以 `protocol/ai-coding-exchange.schema.json` 作为跨平台交换契约：

```text
architecture-discovery     → architecture-snapshot + evidence-manifest
architecture-change-plan   → task-request + architecture-proposal + evidence-manifest
implementation-reconcile   → implementation-report + architecture-snapshot + evidence-manifest
```

Skill 由拥有代码仓库权限的 Coding AI 执行，查看器只展示固定清单和可复制调用提示。生成物默认位于 `ai-coding/`，不会自动进入正式架构；用户仍需明确选择资料、审阅提案并执行发布确认。

所有交换文件必须使用仓库相对路径，并通过本地契约校验。实施报告只有在测试被实际执行且通过、全部验收标准有证据满足、没有未解决事项时，才能标记为 `complete`。

## 服务端边界

新增 API 必须继续遵守本地项目根目录限制、JSON Schema 校验和原子写入：

```text
GET  /api/analysis
GET  /api/skills
PUT  /api/analysis/sources
POST /api/analysis/scan
POST /api/analysis/proposals
POST /api/analysis/proposals/:id/accept
POST /api/analysis/proposals/:id/reject
```

模型调用仅在 Node 服务端发生。`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL` 只从进程环境读取，永不返回给浏览器、写入项目包或提交至 Git。默认模型为 `deepseek-v4-flash`。

服务端应当提供可预测的演示提案路径，使公开示例可在没有密钥时完整展示审阅闭环；真实模型请求则必须验证输出的 JSON 结构、引用的证据 ID 与项目根目录边界。

## 文件选择与安全规则

- 只能读取项目根目录内的普通文件，拒绝符号链接、绝对路径和路径穿越。
- 默认允许 Markdown、JSON、YAML、文本、`package.json`、`pyproject.toml` 与 Docker Compose 文件。
- 默认忽略 `.git/`、`node_modules/`、`dist/`、构建目录、锁文件、`.env*`、密钥/证书扩展名和单个超过 256 KiB 的文件。
- 每次 AI 分析前在界面列出实际选中的文件、路径和最近扫描状态。
- 不将完整仓库、锁文件、环境文件或任何未选资料发送给模型。

## 公开发布边界

公开仓库只包含通用查看器内核、测试和虚构的 `projects/demo/` 数据包。

- 不提交本机保留、已被忽略的旧项目数据包。
- 不提交现有迁移记录或任何包含外部绝对路径、业务资料、内部系统名称的文档。
- `package.json` 版本更新为 `0.1.0`，但继续保持 `private: true`，防止误发布到 npm。
- 增加 `.env.example`，不含密钥；增加许可证、贡献说明与安全披露说明。
- GitHub Pages 如有演示，仅承载静态只读示例；完整 AI 分析在本地 Node 服务中运行。

## 验收标准

1. 在未配置模型密钥时，示例项目仍能展示一条完整的演示提案并走完接受到草案的流程。
2. 配置 DeepSeek 环境变量后，模型请求只发生在本地服务端，且浏览器响应中没有密钥。
3. 每个提案变更至少引用一条可验证证据；无证据或无效补丁不可接受。
4. 接受提案不会改变已发布版本；发布仍需消息与人工确认。
5. 已有节点的位置与分组布局不会被 AI 提案覆盖；新节点才使用确定性自动布局。
6. `npm test`、`npm run build` 和本地浏览器验收均通过。
7. 初始化公开 Git 仓库前的扫描确认没有旧项目标识、内部系统名、绝对源路径、`.env` 或私钥进入暂存区。
