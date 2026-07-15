---
name: architecture-discovery
description: Inspect an authorized code repository and produce an evidence-backed architecture snapshot for AI Architecture Viewer. Use when onboarding a project, refreshing the current architecture, explaining an unfamiliar repository, or preparing grounded context before architecture planning. Do not use it to implement changes.
---

# Architecture Discovery

Create a factual current-state architecture package without modifying application code.

## Workflow

1. Confirm the repository root and the user-authorized scope. Treat unspecified external directories, secrets, generated output, dependency caches, and customer data as out of scope.
2. When AI Architecture Viewer MCP tools are available, call `get_project_context`, then call `create_agent_run` with task type `architecture-discovery`. Retain the returned run ID. If MCP is unavailable, continue with file artifacts and the CLI fallback below.
3. Record the workspace revision. Prefer a commit identifier when available; otherwise use a stable workspace label and state that the tree is uncommitted.
4. Inspect entry points, manifests, build and test configuration, runtime boundaries, modules, storage, external integrations, and human or authorization gates.
5. Support every current-state node and edge with one or more `code-fact` evidence IDs. Put uncertain interpretations in assumptions or unknowns; they must not masquerade as implemented facts.
6. Use repository-relative forward-slash paths. Never emit absolute paths, credentials, full secret values, or unapproved source bodies.
7. Write the artifacts under `ai-coding/discovery/<run-id>/`:
   - `architecture-snapshot.json`
   - `evidence-manifest.json`
8. If `protocol/validate-artifact.cjs` is available, validate both files before submission.
9. Submit both artifacts with `submit_architecture_snapshot`. If MCP is unavailable, run `npm run agent -- submit --run <run-id> --artifact <snapshot-path> --evidence <manifest-path>` after a run ID has been created through the viewer API or CLI.
10. Report unknowns and conflicting evidence explicitly. Do not invent missing architecture facts.

## Output rules

- Read [references/output-contract.md](references/output-contract.md) before writing artifacts.
- Start from the JSON files in [assets](assets) when useful.
- Keep node IDs stable across repeated discovery runs whenever the same responsibility still exists.
- Use only `flow`, `support`, `reference`, `governance`, or `handoff` as relation types.
- Use `sourceKind: workspace-file` and `basis: code-fact` for every evidence entry referenced by the current architecture snapshot.
- Do not edit `state.json`, `analysis.json`, viewer layout files, or any published architecture revision.
- Treat the viewer as a handoff and review surface, not as the repository scanner. Use the coding agent's authorized repository tools for inspection.
- Never call or simulate approval or publication. A submitted snapshot remains a candidate until the user reviews it.

## Completion gate

Finish only when the artifacts parse as JSON, all referenced evidence IDs exist, all paths are repository-relative, and limitations are visible to the user.
