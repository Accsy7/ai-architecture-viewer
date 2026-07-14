# AI Architecture Viewer

[Read in Chinese](README.md)

AI Architecture Viewer is a local-first tool for building a shared understanding
of software architecture between people and AI. It brings the current
architecture, target intent, and explicitly selected project materials into a
single visual workspace. From these controlled inputs, the AI produces a
traceable interpretation of the architecture and proposes candidate changes.
The user reviews, corrects, accepts, or rejects those results, turning shared
understanding into drafts and versioned architecture records. The AI does not
automatically scan the entire code repository, and it cannot modify a published
architecture without human confirmation.

## Use cases

- **Understand an unfamiliar or complex project**: Bring existing architecture
  diagrams, module descriptions, technical designs, and process materials into
  one view. Based only on the materials you explicitly select, the AI presents
  its understanding of responsibilities, relationships, data flows, and control
  boundaries for you to correct item by item.
- **Review architecture evolution proposals**: Compare the current
  architecture, target architecture, and their differences side by side before
  adding a module, changing a call chain, or introducing a governance control.
  The result is a candidate draft that can be discussed and revised
  iteratively.
- **Turn design materials into reviewable suggestions**: Extract evidence from
  explicitly selected design notes, technical documents, or project materials
  and produce candidate changes that remain traceable to their sources, rather
  than changing a diagram without supporting evidence.
- **Practice collaborative human–AI architecture governance**: The AI organizes
  its architectural understanding and lays out options with their trade-offs;
  people make the decisions and publish formal versions. Every change requires
  human confirmation, and the AI cannot alter a published architecture version.
- **Teach and demonstrate publicly**: Use the built-in fictional example to
  explain architecture visualization, AI-assisted understanding, evidence
  traceability, human review, and version evolution without using real business
  or customer materials.

The interface is isolated from project data. The viewer does not embed a domain
model for any specific business, and the public repository contains fictional
examples only.

## Quick start

Requires [Node.js](https://nodejs.org/) 20 or later.

```powershell
npm install
npm start
```

Open `http://127.0.0.1:8800` in your browser. `npm start` first builds the
frontend and then starts the local API and web server.

To use a different port:

```powershell
$env:PORT = '8891'
npm start
```

To load your own project data package from outside the repository, explicitly
set its directory:

```powershell
$env:VIEWER_PROJECT_DIR = 'D:\work\my-architecture-package'
npm start
```

## Configure a model provider (optional)

### Data-sharing boundary

When generating a proposal, the server sends **evidence excerpts extracted from
the materials you explicitly selected**, together with **the nodes,
relationships, and fields in the current architecture view**, to the configured
model provider. Do not select materials that you are not authorized to transmit,
and never put real secrets in project files.

Without a model API key, viewing, comparison, manual drafting, and demo data
remain available. Only AI-generated proposals are unavailable.

The server reads model configuration only from the process environment.
`.env.example` documents the available variables, but the project does not
automatically load a `.env` file. Supply actual values through your terminal
environment, your deployment platform's secret manager, or your own
environment-loading mechanism.

```powershell
$env:DEEPSEEK_API_KEY = 'replace-with-your-own-secret'
$env:DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
$env:DEEPSEEK_MODEL = 'deepseek-v4-flash'
npm start
```

For provider-specific configuration and model information, refer to the
provider's official documentation.

## Project data package

A data package normally contains:

- `project.json`: the instance inventory and default-project marker.
- `viewer.config.json`: configuration for the UI title, views, and detail
  fields.
- `architecture-catalog.json`: the architecture-diagram catalog and
  hierarchical navigation.
- `state.json` and `viewer-layout.json`: published semantic state and local
  layout.
- `document-registry.json` and `documents/`: project materials that can be
  cited.
- `diagrams/`: state and layout for other architecture diagrams.
- `analysis.json`: separate records of sources, evidence, and AI proposals.

Keep real project data outside this repository or in a private workspace.

## AI coding collaboration skills

This repository bundles three vendor-neutral skills that travel with the
project:

- `architecture-discovery`: inspects an authorized repository scope and
  produces a snapshot of the current architecture with an evidence manifest.
- `architecture-change-plan`: turns user intent into alternatives,
  recommendations, target-architecture changes, and acceptance criteria without
  starting implementation.
- `implementation-reconcile`: compares actual AI coding changes and test
  results with the approved architecture, revealing missing, additional,
  changed, or unverified work.

Open the **Collaboration Skills** tab in the AI analysis drawer to inspect a
skill and copy its handoff prompt. Canonical skill instructions are under
[`skills/`](skills/), and the vendor-neutral artifact protocol is under
[`protocol/`](protocol/). Generated `ai-coding/` output is excluded from Git
by default and becomes analysis input only after the user explicitly selects it.

Validate an exchange artifact with:

```powershell
npm run protocol:validate -- ai-coding/path/to/artifact.json
```

Skills produce candidate work only. They cannot accept their own proposals,
modify a published architecture, or approve implementation on the user's behalf.

## Development and verification

```powershell
npm test
npm run build
```

Before submitting changes, run at least:

```powershell
git status --ignored
npm test
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development conventions,
[SECURITY.md](SECURITY.md) for security reporting, and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards.

## Public-release boundaries

- Default examples and documents must be fictional or explicitly authorized for
  public release.
- Do not commit secrets, access tokens, internal paths, customer materials, or
  architecture materials that have not been de-identified.
- The AI may only propose structured changes. Every write and publication must
  be confirmed by a person.
- This project's source code is licensed under the
  [PolyForm Noncommercial License 1.0.0](LICENSE). It is source-available, but
  it is not an open-source license under the OSI definition.
- The license grants rights to use, modify, and distribute the software only for
  the noncommercial purposes it defines. Commercial use requires separate
  written authorization; see
  [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md).
- Derivative works are allowed. Anyone publicly distributing a modified version
  must retain the attribution in [NOTICE](NOTICE) and follow
  [TRADEMARKS.md](TRADEMARKS.md): use a different project name and Logo, and do
  not imply that the version is official, maintained by the original author,
  approved by the original author, or endorsed by the original author.
- Third-party dependencies remain subject to their own licenses.

## Local runtime security boundary

In v0.1.0, the service listens only on `127.0.0.1`. Its mutation APIs do not
yet provide authentication, CSRF protection, or remote-access control. Do not
expose it directly to a LAN or the public internet through a reverse proxy.
Before deploying it for multiple users, add those protections first.
