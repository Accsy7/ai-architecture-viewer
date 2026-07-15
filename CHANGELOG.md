# Changelog

All notable changes to AI Architecture Viewer are documented in this file.

## [0.3.0] - 2026-07-15

### Added

- A concept-project target proposal flow that accepts user-confirmed discussion
  conclusions and Markdown design material without requiring a code repository.
- Four visible basis types: user confirmation, design document, code fact, and
  agent inference, with file and discussion sources represented separately.
- Compact semantic architecture responses for coding agents so stable IDs,
  responsibilities, relationships, and boundaries can be reused without layout
  coordinates or repeated full-context explanation.

### Compatibility and governance

- Exchange protocol `1.1.0` remains compatible with stored `1.0.0` artifacts;
  analysis schema `2.1.0` migrates v0.2 sources and evidence in place.
- Discussion and design intent may support target proposals but are rejected as
  evidence of current implementation. Current snapshots and implementation
  reports must reference code facts.
- Agent submissions still cannot approve or publish. Human acceptance creates
  only a draft, and publication remains a separate human-confirmed action.

## [0.2.0] - 2026-07-14

### Changed

- Reframed the product as an external architecture handoff and review surface
  for Codex, Claude Code, and other coding agents rather than an application
  with an embedded model provider.
- Replaced the AI analysis drawer with an agent workspace containing traceable
  runs, a proposal inbox, review history, and portable collaboration skills.
- Removed the DeepSeek provider integration and all model-key requirements from
  the core runtime.

### Added

- A production-oriented local STDIO MCP server built on the recommended v1
  Model Context Protocol TypeScript SDK.
- MCP tools for project context, published architecture, agent runs,
  architecture snapshots, change proposals, implementation reports, review
  status, and approved targets.
- A vendor-neutral CLI and JSON-file fallback for agents without MCP support.
- Agent-run and artifact provenance in analysis schema `2.0.0`, including safe
  migration from v1 analysis data.
- Repository-code evidence support with path, sensitive-directory, line-range,
  and current-content-hash validation.
- Independent project-data and code-workspace roots so the viewer can remain
  outside the repository it helps an agent explain.
- Snapshot-to-diff conversion that never interprets an omitted node as an
  automatic removal.
- End-to-end MCP handshake and external-submission tests.

### Security and governance

- MCP exposes no approval or publication tool. Submitted artifacts always enter
  the human review workflow, and accepted proposals create drafts only.
- Agent submissions are locked to the published architecture baseline captured
  when their run was created.
- Every run accepts only its declared artifact types, and each submission must
  carry a manifest covering all referenced evidence.
- `get_approved_target` never returns an unrelated, unapproved target draft.

## [0.1.0] - 2026-07-14

### Added

- A local-first visual workspace for comparing current and target architecture.
- Human-controlled drafts, publication, immutable revision history, restore, and
  structured architecture differences.
- Evidence-backed AI proposals generated only from materials explicitly
  selected by the user.
- A project document registry with safe preview, diagnostics, references, and
  lifecycle controls.
- Independent architecture diagrams, layout persistence, smart edge routing,
  and focused detail inspection.
- A fictional public demo package that requires no customer or internal data.
- Three vendor-neutral AI coding collaboration skills and a validated exchange
  artifact protocol.
- Chinese and English project documentation, contribution guidance, security
  reporting, and community standards.

### Security and governance

- The local server binds to `127.0.0.1` by default.
- Model credentials are read only from the process environment.
- AI cannot publish or modify a formal architecture without explicit human
  confirmation.
- Real project packages, generated output, local migrations, dependencies, and
  secret files are excluded from the public repository by default.

### Known limitations

- The v0.1.x server has no authentication, CSRF protection, or multi-user
  authorization and must not be exposed directly to a LAN or the public
  internet.
- Repository understanding is based on explicitly selected materials; automatic
  whole-repository scanning is not included.
- The built-in model provider integration currently uses DeepSeek-compatible
  environment configuration.
- GitHub may display the PolyForm license as “Other”; the authoritative terms
  remain in [LICENSE](LICENSE) and [NOTICE](NOTICE).
