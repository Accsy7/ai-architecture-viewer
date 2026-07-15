---
name: implementation-reconcile
description: Compare AI-coded repository changes and test results with the exact user-published formal architecture locked by an implementation run, then submit a code-fact snapshot and evidence-backed reconciliation report for local human review. Use after implementation, during acceptance, after a refactor, or when architecture drift is suspected. Do not use it to review, approve, or publish the result automatically.
---

# Implementation Reconcile

Verify what was actually built and make all architecture drift visible to the user.

## Workflow

1. When AI Architecture Viewer MCP tools are available, call `get_approved_target` and `get_project_context`, then call `create_agent_run` with task type `implementation-reconcile`. Retain the run ID and its `approvedTarget` lock. Treat only the returned `published-target` / `formal-baseline` as executable; an accepted proposal with `awaiting-publication` review status is still a draft and must not start implementation.
2. Confirm that the run lock exactly matches the published target descriptor: `diagramId`, `revision`, `revisionId`, and `semanticHash`. Never replace it with a later target silently; create a new run when the formal target changes.
3. Inspect the actual worktree or revision diff. Include uncommitted changes when they are in scope and identify them as uncommitted.
4. Run the relevant tests, builds, checks, or safe diagnostics. Record command, outcome, and a concise result; never hide failures.
5. Map implementation evidence to each acceptance criterion and formal target responsibility, relationship, authorization boundary, and controlled boundary posture.
6. Generate the complete resulting current-state architecture only from `code-fact` evidence. Every relation must include `controlledBoundaryPosture`. Record inference as unresolved or unverified; never present target intent or design documentation as implemented fact.
7. Classify drift as `missing`, `extra`, `changed`, or `unverified`. Explain every observed deviation, but do not rewrite the formal target to match the code. The server recomputes these categories by stable ID and only checks whether your explanation maps to a computed item; it does not judge the explanation reasonable or accepted.
8. Write the artifacts under `ai-coding/reconciliation/<run-id>/`:
   - `implementation-report.json`
   - `architecture-snapshot.json`
   - `evidence-manifest.json`
9. If `protocol/validate-artifact.cjs` is available, validate all files before reporting completion.
10. Submit `architecture-snapshot.json` first with `submit_architecture_snapshot`. Then submit `implementation-report.json` with `submit_implementation_report`, using the same run and referencing the snapshot artifact ID. If MCP is unavailable, submit in the same order with `npm run agent -- submit`.
11. Call `get_review_status` without details for the compact `agentClaim`, `architectureGate`, and `humanReview` state. Set `includeArchitectureGateDetails: true` only when you need individual drift items and evidence. A ready gate still means `humanReview` is pending until the user decides in the local viewer.

## Output rules

- Read [references/output-contract.md](references/output-contract.md) before writing artifacts.
- Start from the JSON files in [assets](assets) when useful.
- Use `complete` only as the agent's own claim when every acceptance criterion is satisfied, required checks pass, every server-computed deviation is reported and explained, and nothing remains unverified. It never represents final user acceptance. Otherwise use `partial` or `blocked`.
- Report changed files using repository-relative paths.
- Do not edit the run-locked formal target, review or accept your own report, or publish a viewer revision.
- Do not claim tests passed unless they were run and their result was observed.
- Use `sourceKind: workspace-file` and `basis: code-fact` for evidence referenced by the implementation report or resulting current snapshot.
- Use the coding agent's repository tools for inspection and testing. The viewer receives the result; it does not run or direct the implementation.

## Handoff gate

Finish the agent handoff only when the user can distinguish the agent's claim, automatic architecture-gate result, failed or unrun checks, missing scope, extra scope, changed responsibilities or boundaries, unverified claims, and remaining decisions. An explained deviation remains pending human judgment and never changes the formal target automatically. Only the local user's `humanReview` decision accepts, rejects, or requests revision of the implementation result.
