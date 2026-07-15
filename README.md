# AI 架构查看器

[English](README.en.md)

[![CI](https://github.com/Accsy7/ai-architecture-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/Accsy7/ai-architecture-viewer/actions/workflows/ci.yml)
![Version: v0.6.0](https://img.shields.io/badge/version-v0.6.0-2f6f5e)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-7c6f64)](LICENSE)

> **许可说明：** 本项目源码仅针对 [PolyForm Noncommercial License 1.0.0](LICENSE) 定义的非商业用途开放。二次开发必须保留 [NOTICE](NOTICE) 中的署名，并遵守 [项目名称与标识使用政策](TRADEMARKS.md)。

AI 架构查看器是一个本地优先的“编码智能体 ↔ 用户”架构协作界面。概念项目可以先由用户与 Codex、Claude Code 等智能体通过讨论或 Markdown 设计材料形成目标架构；代码项目可以由智能体使用已有的仓库工具提交当前架构快照和实施报告。查看器把这些结果呈现为可核验的图、依据和差异；AI 只能把验证通过的语义补丁写入锁定草稿，用户通过最终发布形成正式架构。

它不内嵌大模型，不需要模型 API Key，也不会替智能体自动扫描整个代码仓库。

![虚构 Demo 的当前架构总览](docs/assets/architecture-overview.png)

仓库内置的所有画面和数据均为虚构 Demo，不包含客户、生产或个人数据。

## v0.6.0 MVP 能做什么

- 让外部智能体以精简语义结构读取已发布架构、稳定 ID、职责、关系和边界，无需重复传输布局数据。
- 支持无代码仓库的概念项目：从用户确认的讨论结论或 Markdown 设计材料提交目标架构语义补丁。
- 为每次项目理解、架构规划或实施核验创建独立运行记录；实施运行会锁定已发布目标的图、版本、开发合同和绑定文档哈希，绝不绑定草案。
- 区分“用户确认、设计文档、代码事实、智能体推断”四类依据，并在审阅界面逐条显示。
- 对文件依据校验相对路径、行号和内容哈希，拒绝越界、敏感或已经变化的内容。
- 讨论和设计材料只能支持目标设计，不能被提交为当前已经实现的事实。
- 在用户发布目标时冻结版本化开发合同：来源提案、目标语义哈希、稳定验收条件 ID、目标模块与关系、权限边界、绑定文档及其哈希都随正式版本保存。运行时会重算图、目标索引和边界索引；绕过发布流程直接改 JSON 会使合同失效。旧版本不会编造合同，而会明确标为 `legacy-unbound`、不可执行。
- 实施报告必须逐条引用正式合同中的验收条件 ID；漏报、增报或改写条件都会被服务端拒绝。
- 服务端把正式合同中的条件原文和架构引用，与报告的逐条状态和证据合并为独立合同门禁。架构图一致仍不足以接受；`partial / blocked`、未满足、未核验或缺少合同门禁的旧运行只能要求修订或拒绝。
- 节点可保留通用的 `interactionModes`（用户界面 / 系统服务）与 `architectureLayer`，并参与提案、精简读取和实施偏离核对。
- 将智能体的架构快照自动转换为语义差异；快照没有提到的现有节点不会被自动删除。
- 要求实施运行先提交由 `code-fact` 支持的完整实施后快照，再提交引用该快照和正式目标锁的实施报告。
- 由服务端按稳定 ID 自动核对 `missing / extra / changed / unverified`，覆盖模块职责、权限边界、关系端点、关系类型和受控边界姿态，而不是只相信智能体自报。
- 将智能体声明、自动架构门禁、正式合同门禁和人工验收拆成四个独立状态：智能体声称 `complete` 不代表项目完成，两项自动门禁都通过也只能进入“可供人工验收”。
- 将服务端结果与智能体报告逐条交叉核对；未说明、未报告或未核验的偏离会阻止人工接受，智能体提供的解释始终标为“待人工判断”。
- 所有实施报告都必须由用户在本地界面接受、拒绝或要求修订；结论记录验收人、时间和备注，但不会改写正式目标。
- `get_review_status` 默认只返回低成本的智能体声明、架构/合同门禁摘要和人工验收状态，需要时才读取逐项偏离或逐条合同条件、证据与解释。
- 发现与变更规划运行会同时锁定已发布基线和活动草稿 ID/修订号；验证通过的稳定 ID 语义补丁直接合并到该草稿。草稿或正式基线变化时明确返回 stale，不会覆盖用户或其他智能体的并发修改。
- 协议 1.4 允许节点更新用显式 `null` 撤回受支持的可选语义字段；必填字段、关系字段与目标时间范围不能清除，下钻图/节点引用必须成对撤回。完全无效果的补丁原子拒绝；最后一项净变化被撤回后会清除零差异草稿，但保留运行与来源记录。
- 画布直接显示草稿相对正式版的净模块、关系、权限边界与验收条件变化，并按字段保守追溯 AI、用户或未知来源；布局拖动不计入语义变化。
- 旧 v0.2–v0.5 提案与接受/拒绝记录继续只读可查，但不再是正常操作入口，也不会被自动写入草稿或正式版本。
- 发布前逐项显示完整结构净变化、敏感边界、关系改连、验收条件、目标引用和绑定文档；绑定文档若在审阅后变化会拒绝发布，用户可在本地刷新文档锁并重新检查。
- 页面角落提供极简“中文 / English”切换并记住选择；只翻译查看器通用外壳，不翻译项目名称、图、模块、关系、文档、证据和用户原文。
- 保存当前架构、目标架构、差异、草案和不可变版本历史。
- 通过三套可移植 Skill 统一“理解项目—规划变更—核验实施”的交接格式。

## 工作方式

```mermaid
flowchart LR
    U["用户与智能体确认目标"] --> C["讨论结论 / Markdown 设计材料"]
    C --> T["提交目标架构语义补丁"]
    R["代码仓库事实"] --> S["提交当前快照"]
    T --> D["服务端校验并写入锁定目标草稿"]
    S -->|项目理解| E["服务端校验并写入锁定当前草稿"]
    D --> V["画布呈现草稿相对正式版的净变化"]
    E --> V
    V --> P{"用户检查完整草稿并发布"}
    P --> G["正式目标 + 开发合同 + 文档版本"]
    G --> A["实施运行锁定完整合同并开发"]
    A --> R
    S -->|实施核验| X["服务端按稳定 ID 自动核验偏离"]
    G --> X
    X --> I["提交智能体声明并交叉核对"]
    I --> J{"人工验收实施结果"}
    J -->|接受 / 要求修订 / 拒绝| V
```

权限边界很明确：MCP 服务器没有草稿审阅、实施验收或 `publish` 工具。智能体负责调查、推理和写入锁定草稿；用户在外部对话中决定方向，并在查看器中发布正式版本。

实施核验中的“已解释偏离”只表示智能体的说明与服务端计算出的偏离条目能够对应，不表示说明合理、用户已经接受或架构目标已经改变。即使自动架构核对未发现偏离，页面和业务体验仍需用户实际验收。若代码需要成为新目标，智能体必须基于最新锁写入新的目标草稿修改，再由用户检查完整草稿并发布。

| 依据类型 | 含义 | 可证明当前已实现 |
| --- | --- | --- |
| 用户确认 | 用户明确确认的目标或边界 | 否 |
| 设计文档 | Markdown 等材料描述的目标设计 | 否 |
| 代码事实 | 从仓库文件直接核验的实现事实 | 是 |
| 智能体推断 | 尚未被用户或代码证实的判断 | 否 |

## 快速开始

需要 [Node.js](https://nodejs.org/) 20 或更高版本。

```powershell
npm install
npm start
```

浏览器打开 `http://127.0.0.1:8800`。使用其他端口：

```powershell
$env:PORT = '8891'
npm start
```

MCP 服务可单独启动；如果查看器尚未运行，它会自动在本地启动：

```powershell
npm run mcp
```

### 连接 Codex

在受信任项目的 `.codex/config.toml` 中配置本地 STDIO 服务。请把路径替换为本机绝对路径：

```toml
[mcp_servers.ai_architecture_viewer]
command = "node"
args = ["D:/path/to/ai-architecture-viewer/mcp-server.mjs"]
cwd = "D:/path/to/ai-architecture-viewer"

[mcp_servers.ai_architecture_viewer.env]
VIEWER_PROJECT_DIR = "D:/architecture-data/my-project"
VIEWER_WORKSPACE_ROOT = "D:/work/my-project"
```

Codex 桌面应用、CLI 和 IDE 扩展共享 MCP 配置。参阅 [Codex MCP 官方说明](https://developers.openai.com/codex/mcp/)。

### 连接 Claude Code

在项目 `.mcp.json` 中配置：

```json
{
  "mcpServers": {
    "ai-architecture-viewer": {
      "command": "node",
      "args": ["D:/path/to/ai-architecture-viewer/mcp-server.mjs"],
      "cwd": "D:/path/to/ai-architecture-viewer",
      "env": {
        "VIEWER_PROJECT_DIR": "D:/architecture-data/my-project",
        "VIEWER_WORKSPACE_ROOT": "${CLAUDE_PROJECT_DIR:-.}"
      }
    }
  }
}
```

首次使用时，客户端会要求你确认是否信任该本地 MCP 服务。参阅 [Claude Code MCP 官方说明](https://code.claude.com/docs/en/mcp)。

## MCP 工具

| 工具 | 用途 | 是否改变正式架构 |
| --- | --- | --- |
| `get_project_context` | 读取项目、图谱、正式基线状态、合同失效原因和协作边界 | 否 |
| `read_project_document` | 按注册表 `documentId` 和可选标题读取受限 Markdown 片段 | 否 |
| `get_current_architecture` | 以精简语义图读取当前已发布架构 | 否 |
| `create_agent_run` | 创建可追溯运行；实施运行锁定正式目标、开发合同和文档哈希 | 否 |
| `submit_architecture_snapshot` | 发现运行提交当前架构理解并增量写入锁定的当前草稿；实施运行中的快照仅用于核验 | 否；过期写入会拒绝，绝不发布 |
| `submit_change_proposal` | 提交稳定 ID 的目标架构/合同语义补丁并写入锁定目标草稿 | 否；绝不发布，也不伪造人工批准 |
| `submit_implementation_report` | 提交智能体对实施结果的声明、测试和偏离 | 否，不能代替人工验收 |
| `get_review_status` | 查询智能体声明、架构/合同门禁摘要和人工验收状态，按需读取逐项偏离或合同条件详情 | 否 |
| `get_approved_target` | 读取最近一次人工发布的目标、执行状态、精简语义图和冻结合同 | 否 |

草稿写入不会授权智能体据此开发。`get_review_status` 会把该状态标为 `awaiting-publication`；只有用户明确发布后，`get_approved_target` 才会返回新版本及其冻结合同。没有验收条件的旧目标或手工版本会诚实标为不可执行，未发布草稿永远不会作为可执行目标图输出。

## 命令行与文件后备入口

不能使用 MCP 的智能体仍可生成 [`protocol/`](protocol/) 定义的 JSON 工件，并通过本地命令行提交：

```powershell
npm run agent -- context

npm run agent -- create-run `
  --agent Codex `
  --client codex `
  --task architecture-discovery

npm run agent -- submit `
  --run run-id-from-previous-command `
  --artifact ai-coding/discovery/run-id/architecture-snapshot.json `
  --evidence ai-coding/discovery/run-id/evidence-manifest.json
```

校验单个交换工件：

```powershell
npm run protocol:validate -- ai-coding/path/to/artifact.json
```

## 协作 Skill

[`skills/`](skills/) 内置三套供应商中立流程：

- `architecture-discovery`：在用户授权范围内检查仓库，提交当前架构快照和证据清单。
- `architecture-change-plan`：从用户确认的讨论、设计文档或代码事实形成备选方案、目标架构差异和验收标准；概念项目无需代码仓库。
- `implementation-reconcile`：把实际代码与运行锁定的已发布正式目标对照，先提交实施后快照，再提交测试、智能体完成声明和全部偏离；最终结论仍由用户验收。

Skill 优先使用 MCP；不可用时回退到 JSON 文件和命令行。每个发现/变更规划运行只提交一次架构补丁；下一次修改创建新运行并锁定最新草稿。它们不能发布正式架构、修改已发布版本或代表用户验收实施。

## 项目数据包

查看器、项目数据包与待检查代码仓库可以三者分离。数据包通常包含：

- `project.json`：实例清单和默认项目标记。
- `viewer.config.json`：界面标题、视图和详情字段。
- `architecture-catalog.json`：架构图目录和层级导航。
- `state.json`、`diagrams/`：语义架构、草案和版本历史。
- `viewer-layout.json`：仅用于呈现的本地布局。
- `document-registry.json`、`documents/`：可引用的项目资料。
- `analysis.json`：智能体运行、交换工件、证据、自动架构/合同门禁和人工验收记录。

从仓库外加载自己的项目数据包，并将证据校验明确绑定到实际代码仓库：

```powershell
$env:VIEWER_PROJECT_DIR = 'D:\work\my-architecture-package'
$env:VIEWER_WORKSPACE_ROOT = 'D:\work\my-code-repository'
npm start
```

代码事实的文件路径始终相对于 `VIEWER_WORKSPACE_ROOT`，查看器会在该目录内重新读取并核对哈希。项目设计文档使用另一条受控路径：智能体只能通过 `document-registry.json` 中的 `documentId` 与可选 Markdown 标题读取 `VIEWER_PROJECT_DIR` 内的登记文档，不能提交任意磁盘路径；这类依据只能支持目标设计，不能冒充当前实现。讨论依据则保存来源标签、确认时间和审阅摘录。这样，架构数据包与代码仓库可以安全分离，同时避免开放多根目录扫描。未设置工作区时，它默认与 `VIEWER_PROJECT_DIR` 相同。

## 开发与验证

```powershell
npm test
npm run build
```

开发规范见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全报告见 [SECURITY.md](SECURITY.md)，社区标准见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 公开发布与安全边界

- 默认示例和文档必须为虚构内容或已获准公开发布。
- 不得提交密钥、访问令牌、客户材料、内部路径或未经脱敏的架构数据。
- 智能体只能向锁定草稿提交结构化语义补丁和实施声明；架构发布与实施验收只允许本地用户操作。
- v0.6.0 仅监听 `127.0.0.1`，变更 API 尚无身份验证、CSRF 防护或多用户授权。不要将其反向代理到局域网或互联网。
- 源码采用 [PolyForm Noncommercial License 1.0.0](LICENSE)，属于 source-available 而非 OSI 开源许可。商业使用需另行书面授权，见 [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md)。
- 允许衍生作品，但公开发布的修改版本必须保留 [NOTICE](NOTICE) 署名，并遵守 [TRADEMARKS.md](TRADEMARKS.md)：使用不同项目名称和 Logo，不得暗示为官方版本或获得原作者背书。
- 第三方依赖仍受其自身许可证约束。
