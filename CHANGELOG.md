# Changelog

All notable changes to AI Architecture Viewer are documented in this file.

## [0.5.1] - 2026-07-15

### Fixed

- Agent runs and their proposals now lock the published lane baseline together
  with the active draft ID and revision observed at run creation.
- A user-confirmed proposal can merge into that exact unchanged draft instead
  of forcing the user to publish or discard unrelated draft work first. The
  merge preserves existing graph/layout semantics and increments the draft
  revision; target merges rebuild the draft contract and bound-document index
  while retaining existing criteria and contract identity.
- Concurrent draft edits, draft replacement, or publication of a newer formal
  baseline make the run or proposal explicitly stale rather than silently
  overwriting newer work.
- Stored runs and proposals without a lane lock remain readable. They cannot be
  continued or accepted by guessing a baseline and must be recreated; rejection
  remains available. MCP still has no review, acceptance, or publication tool.

## [0.5.0] - 2026-07-15

### Added

- Self-contained development contracts frozen into every newly published target
  revision, including source proposal/request provenance, target semantic hash, stable observable
  acceptance criteria, target and permission-boundary references, and bound
  document metadata and hashes.
- Strict implementation-report matching against the frozen criterion IDs;
  omitted, extra, duplicated, or rewritten criteria are rejected before the
  automatic architecture gate is computed.
- A separate server-computed contract gate joins immutable criterion text and
  target references with each reported status and evidence ID. Partial,
  blocked, unsatisfied, unverified, and legacy unbound runs cannot be accepted
  even when the architecture graph itself is aligned.
- A bounded read-only MCP document tool using registered `documentId` and an
  optional exact Markdown heading. Registered documents and evidence share the
  same path protection, size limits, section matching, and content hashes.
- Lightweight `documentRefs` in compact semantic graphs and enriched document
  indexes so agents can read only relevant project context.
- Generic `interactionModes` and `architectureLayer` node semantics across
  state, proposals, snapshots, compact reads, diffs, and implementation drift.
- Publication and proposal-review UI summaries showing the contract criteria,
  permission-boundary count, and bound documents before a user publishes.

### Protocol, compatibility, and governance

- State schema `3.3.0` migrates 3.0/3.1/3.2 data without inventing acceptance
  criteria. Earlier formal targets are explicitly `legacy-unbound` and cannot
  start a strict implementation run.
- Exchange protocol `1.3.0` adds executable formal-target locks with contract
  and document-set hashes, stable criterion references, registered document
  evidence, and the generic node interaction/layer fields. Earlier protocol
  artifacts remain readable.
- Analysis schema `2.4.0` preserves proposal criteria and request provenance,
  registered document evidence, and the expanded formal-target lock.
- Project documents may support target design only. Current architecture and
  implementation snapshots still require workspace-relative `code-fact`
  evidence, and MCP still exposes no review, approval, or publication tool.
- A bound document or formal contract change makes an older implementation run
  stale; no run silently migrates to a newer target.
- Direct edits to a published target graph invalidate its contract: runtime
  checks recompute the semantic graph hash, target index, and permission-boundary
  index before exposing or locking an executable baseline.

## [0.4.0] - 2026-07-15

### Added

- Exact formal-target locks for every new implementation reconciliation run,
  including diagram ID, published revision, revision ID, and semantic hash.
- Server-computed implementation reconciliation by stable ID across modules,
  responsibilities, authorization boundaries, relationships, relation types,
  and controlled boundary posture.
- Persisted `missing`, `extra`, `changed`, and `unverified` drift with stable
  drift IDs, target and actual values, code evidence, and explanation status.
- Cross-checking between computed drift and agent implementation reports, plus
  a completion gate for unreported, unsupported, unexplained, or unverified
  results.
- Detailed reconciliation cards in the existing agent workbench and compact,
  opt-in MCP review details to reduce repeated agent context.
- Separate `agentClaim`, `architectureGate`, and `humanReview` states so an
  agent report or passing automatic comparison cannot impersonate user
  acceptance.
- Local human accept, revision-request, and reject actions with immutable
  reviewer, timestamp, decision, and note records. No equivalent MCP mutation
  tool is exposed.

### Protocol and compatibility

- Exchange protocol `1.2.0` replaces the ambiguous implementation-report
  proposal reference with an exact `approvedTarget` descriptor and
  `resultingSnapshotArtifactId`.
- New implementation runs require a code-fact snapshot before their report and
  reject stale target locks. Stored v0.2/v0.3 analysis data and protocol 1.0/1.1
  artifacts remain readable through migration.
- Analysis schema `2.3.0` also migrates the pre-review `2.2.0`
  `reconciliation` shape into the three explicit governance states.
- Snapshot relationships can now carry `controlledBoundaryPosture`; protocol
  1.2 implementation snapshots require it for boundary-aware comparison.

### Governance

- An agent-provided explanation means only that a report entry maps to computed
  drift. Aligned and explained-drift gates become ready for human review, never
  final completion on their own.
- Human acceptance of an explained deviation never rewrites the published
  target. MCP still exposes no review, approval, or publication capability.

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
- `get_approved_target` returns only the latest user-published formal target.
  Accepted drafts remain `awaiting-publication` review state and are never
  exposed to coding agents as executable target graphs.

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
- `get_approved_target` never returns a target draft; only the published formal
  target is available as an executable agent baseline.

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
