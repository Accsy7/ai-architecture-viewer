# AI Architecture Viewer

[简体中文](README.md)

[![CI](https://github.com/Accsy7/ai-architecture-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/Accsy7/ai-architecture-viewer/actions/workflows/ci.yml)
![Version: v0.2.0](https://img.shields.io/badge/version-v0.2.0-2f6f5e)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-7c6f64)](LICENSE)

> **License:** Source code is available only for the noncommercial purposes defined by the [PolyForm Noncommercial License 1.0.0](LICENSE). Derivative versions must retain the attribution in [NOTICE](NOTICE) and follow the [Project Name and Brand Usage Policy](TRADEMARKS.en.md).

AI Architecture Viewer is a local-first architecture collaboration surface between coding agents and people. Agents such as Codex and Claude Code inspect a repository with their existing tools, then submit architecture snapshots, change proposals, and implementation reports through standard MCP or JSON artifacts. The viewer turns those results into verifiable diagrams, evidence, and diffs; the user decides what to accept, revise, and publish.

It does not embed a model, require a model API key, or scan a repository on an agent's behalf.

![Current architecture overview in the fictional demo](docs/assets/architecture-overview.png)

All bundled screens and data are fictional. No customer, production, or personal data is included.

## What the v0.2.0 MVP does

- Lets external agents read the published architecture, diagram catalog, and project document index.
- Creates a traceable run for each discovery, planning, or reconciliation task and locks the architecture baseline used by that run.
- Accepts evidence manifests with repository-relative paths, line ranges, and content hashes; rejects escaped, sensitive, or stale evidence.
- Converts agent architecture snapshots into semantic diffs. Existing nodes omitted from a snapshot are never removed automatically.
- Places architecture proposals in a human inbox with per-change evidence and submitter provenance.
- Reserves acceptance and rejection for the user. Acceptance writes only a draft; publication requires a second explicit human action.
- Keeps current architecture, target architecture, diffs, drafts, and immutable revision history.
- Bundles three portable skills for a consistent understand–plan–verify handoff.

## Workflow

```mermaid
flowchart LR
    U["User defines the goal"] --> A["Codex / Claude Code inspects the repository"]
    A --> M["Submit snapshots, proposals, and evidence through MCP"]
    M --> V["Viewer renders architecture diffs"]
    V --> H{"Human review"}
    H -->|Reject| A
    H -->|Accept| D["Write architecture draft"]
    D --> P{"Human publication"}
    P --> R["Formal revision and history"]
```

The capability boundary is explicit: the MCP server exposes no `approve` or `publish` tool. Agents investigate, reason, and submit; people decide and publish.

## Quick start

Requires [Node.js](https://nodejs.org/) 20 or later.

```powershell
npm install
npm start
```

Open `http://127.0.0.1:8800`. To use a different port:

```powershell
$env:PORT = '8891'
npm start
```

The MCP server can be started separately. It starts the local viewer automatically when necessary:

```powershell
npm run mcp
```

### Connect Codex

Configure the local STDIO server in `.codex/config.toml` for a trusted project. Replace the paths with absolute paths on your machine:

```toml
[mcp_servers.ai_architecture_viewer]
command = "node"
args = ["D:/path/to/ai-architecture-viewer/mcp-server.mjs"]
cwd = "D:/path/to/ai-architecture-viewer"

[mcp_servers.ai_architecture_viewer.env]
VIEWER_PROJECT_DIR = "D:/architecture-data/my-project"
VIEWER_WORKSPACE_ROOT = "D:/work/my-project"
```

The Codex desktop app, CLI, and IDE extension share MCP configuration. See the [official Codex MCP documentation](https://developers.openai.com/codex/mcp/).

### Connect Claude Code

Configure the server in the project's `.mcp.json`:

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

The client asks you to trust a new local MCP server on first use. See the [official Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

## MCP tools

| Tool | Purpose | Changes formal architecture? |
| --- | --- | --- |
| `get_project_context` | Read the project, diagrams, baseline, and collaboration boundaries | No |
| `get_current_architecture` | Read the current published architecture | No |
| `create_agent_run` | Create a traceable run and lock its baseline | No |
| `submit_architecture_snapshot` | Submit current-state understanding and evidence | No; creates candidate diffs only |
| `submit_change_proposal` | Submit a target architecture change | No; enters the inbox only |
| `submit_implementation_report` | Submit implementation results, checks, and drift | No |
| `get_review_status` | Read human review outcomes | No |
| `get_approved_target` | Read the accepted target draft or published target | No |

## CLI and file fallback

Agents without MCP support can produce the JSON artifacts defined under [`protocol/`](protocol/) and submit them with the local CLI:

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

Validate one exchange artifact with:

```powershell
npm run protocol:validate -- ai-coding/path/to/artifact.json
```

## Collaboration skills

[`skills/`](skills/) contains three vendor-neutral workflows:

- `architecture-discovery`: inspect a user-authorized repository scope and submit a current architecture snapshot with evidence.
- `architecture-change-plan`: turn user intent into options, a recommendation, target architecture changes, and acceptance criteria.
- `implementation-reconcile`: compare actual code with the human-approved architecture and submit checks, completion status, and all drift.

Skills prefer MCP and fall back to JSON files plus the CLI. They cannot accept their own proposals, alter published architecture, or approve implementation for the user.

## Project data package

The viewer, its project data package, and the inspected code repository can all live in separate directories. A package normally contains:

- `project.json`: instance inventory and default-project marker.
- `viewer.config.json`: titles, views, and detail fields.
- `architecture-catalog.json`: diagram catalog and hierarchy.
- `state.json` and `diagrams/`: semantic architecture, drafts, and revision history.
- `viewer-layout.json`: presentation-only local layout.
- `document-registry.json` and `documents/`: citable project material.
- `analysis.json`: agent runs, exchange artifacts, evidence, and proposal reviews.

Load a package from outside this repository and bind evidence verification to the actual code workspace:

```powershell
$env:VIEWER_PROJECT_DIR = 'D:\work\my-architecture-package'
$env:VIEWER_WORKSPACE_ROOT = 'D:\work\my-code-repository'
npm start
```

Every evidence path submitted by an agent is relative to `VIEWER_WORKSPACE_ROOT`; the viewer rereads that file inside the configured repository and verifies its content hash. When the setting is omitted, it defaults to `VIEWER_PROJECT_DIR`, preserving the simple layout where the data package lives at the repository root. Keep real project data outside the public repository or in a private workspace.

## Development and verification

```powershell
npm test
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development conventions, [SECURITY.md](SECURITY.md) for security reporting, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards, and [CHANGELOG.md](CHANGELOG.md) for release history.

## Public-release and security boundaries

- Default examples and documents must be fictional or explicitly authorized for public release.
- Never commit credentials, access tokens, customer material, internal paths, or architecture data that has not been de-identified.
- Agents may submit structured candidates only. Acceptance and publication require human actions.
- v0.2.0 binds to `127.0.0.1` only. Mutation APIs do not yet provide authentication, CSRF protection, or multi-user authorization; do not proxy the service to a LAN or the public internet.
- Source code uses the [PolyForm Noncommercial License 1.0.0](LICENSE). It is source-available, not OSI open source. Commercial use requires separate written authorization; see [COMMERCIAL_LICENSE.en.md](COMMERCIAL_LICENSE.en.md).
- Derivative works are allowed, but public modified versions must retain [NOTICE](NOTICE) attribution and follow [TRADEMARKS.en.md](TRADEMARKS.en.md): use a different name and logo and do not imply official status or endorsement.
- Third-party dependencies remain subject to their own licenses.
