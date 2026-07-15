---
name: architecture-change-plan
description: Turn a user's product goal into an evidence-backed semantic patch for the target draft in AI Architecture Viewer. Use before AI coding begins, when comparing options, defining scope and acceptance criteria, or revising a published target. Do not use it to implement code or publish architecture.
---

# Architecture Change Plan

Convert user intent and available evidence into a small target-architecture patch. A concept project does not need a code repository: user-confirmed discussion conclusions and Markdown design materials are valid target-design inputs. The patch writes only to a locked draft; publication is the sole human architecture gate.

## Workflow

1. When AI Architecture Viewer MCP tools are available, call `get_project_context` for the target view and `get_approved_target`. Read the compact active draft when present, then call `create_agent_run` with task type `architecture-change-plan` and view `target`. Retain the returned run ID and its published/draft lock.
2. Read the user goal, constraints, exclusions, latest published target, explicitly confirmed discussion conclusions, and the document index. Use `read_project_document` with `documentId` and an optional exact heading for registered Markdown; do not require repository code for a concept project or read every document by default.
3. Ask only for missing decisions that would materially change scope, safety, data handling, or acceptance.
4. Create up to three viable options. State advantages, disadvantages, migration impact, and important unknowns.
5. Recommend one option, but keep the recommendation separate from the user's approval.
6. Express the recommended option as basis-backed node and edge changes. Do not include coordinates, layout, branding, or manual-confirmation fields.
7. Define observable acceptance criteria with stable IDs and explicit node/edge target references, plus explicit non-goals. Read the compact draft contract before editing it. For a follow-up revision, use an explicit `contractPatch`: `upsert` adds or updates a stable criterion ID and `delete` removes one. Omitting both preserves every existing draft criterion. Each contract operation must cite evidence.
8. Write the artifacts under `ai-coding/plans/<request-id>/`:
   - `task-request.json`
   - `architecture-proposal.json`
   - `evidence-manifest.json`
9. If `protocol/validate-artifact.cjs` is available, validate every artifact before handoff.
10. Submit the patch and evidence with `submit_change_proposal`. The server applies validated changes directly to the exact locked draft and rejects a stale lock. If MCP is unavailable, run `npm run agent -- submit --run <run-id> --artifact <proposal-path> --evidence <manifest-path>`.
11. Use one architecture patch per run. For a follow-up patch, reread the compact draft and create a new run automatically; this advances the lock without asking the user to operate the viewer.

## Output rules

- Read [references/output-contract.md](references/output-contract.md) before writing artifacts.
- Start from the JSON files in [assets](assets) when useful.
- Link every proposed change to one or more basis entries. Use `user-confirmed` for an explicit user decision, `design-document` for an authorized file, `code-fact` for observed implementation, and `agent-inference` for an unconfirmed conclusion.
- Use `sourceKind: discussion` only with `user-confirmed` or `agent-inference`. Prefer `sourceKind: project-document` with `documentId`, optional exact `section`, and the hash returned by `read_project_document` for registered Markdown. Use `sourceKind: workspace-file` only for files inside the configured code workspace.
- A registered project document may use `design-document` or an explicitly `user-confirmed` target basis, but never `code-fact`. Bind relevant document IDs to proposed nodes through `documentRefs`.
- Never describe discussion conclusions, design documents, or agent inference as current implemented architecture. They support the target design only.
- Keep code execution, file mutation, deployment, and publication outside this skill.
- Never mark the patch user-approved. A successful write means only `draft-applied`; publication is a separate human-only action in the viewer.
- Never replace the whole state or publish the viewer's current or target architecture. Submit only stable-ID semantic changes against the run lock.
- A contract-only target correction may use an empty `changes` array with a non-empty `contractPatch`. Never put `contractPatch` on a current-architecture run. Do not create a new criterion ID merely to leave an obsolete condition behind.
- In protocol 1.4 node updates, use explicit `null` only to withdraw a supported optional semantic field. Clear `relatedDiagramId` and `relatedNodeId` together; never clear required fields or target `horizon`. Omitted fields remain unchanged. Do not submit an exact no-op merely to advance a draft lock.
- The viewer is not an embedded planner. Perform reasoning and decisions with the user in the coding agent, then use the viewer for structured draft handoff and final publication review.

## Completion gate

Finish only when the patch is recorded in the locked draft, its provenance is visible, and the user can inspect the complete unpublished draft, scope, risks, acceptance criteria, and net difference from the formal version.
