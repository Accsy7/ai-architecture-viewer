---
name: implementation-reconcile
description: Compare AI-coded repository changes and test results with an approved architecture proposal, then produce an evidence-backed implementation report and refreshed current architecture snapshot. Use after implementation, during acceptance, after a refactor, or when architecture drift is suspected. Do not use it to approve or publish the result automatically.
---

# Implementation Reconcile

Verify what was actually built and make all architecture drift visible to the user.

## Workflow

1. When AI Architecture Viewer MCP tools are available, call `get_approved_target` and `get_project_context`, then call `create_agent_run` with task type `implementation-reconcile`. Retain the returned run ID.
2. Read the approved request, approved architecture proposal, base snapshot, and repository revision.
3. Inspect the actual worktree or revision diff. Include uncommitted changes when they are in scope and identify them as uncommitted.
4. Run the relevant tests, builds, checks, or safe diagnostics. Record command, outcome, and a concise result; never hide failures.
5. Map implementation evidence to each acceptance criterion and approved architecture change.
6. Classify drift as `missing`, `extra`, `changed`, or `unverified`. Explain whether it appears justified, but do not silently rewrite the approved target.
7. Generate the resulting current-state architecture from code facts, keeping facts separate from inference.
8. Write the artifacts under `ai-coding/reconciliation/<run-id>/`:
   - `implementation-report.json`
   - `architecture-snapshot.json`
   - `evidence-manifest.json`
9. If `protocol/validate-artifact.cjs` is available, validate all files before reporting completion.
10. Submit the report with `submit_implementation_report`, then submit the resulting snapshot with `submit_architecture_snapshot`, using the same run and evidence manifest. If MCP is unavailable, submit each artifact with `npm run agent -- submit`.

## Output rules

- Read [references/output-contract.md](references/output-contract.md) before writing artifacts.
- Start from the JSON files in [assets](assets) when useful.
- Use `complete` only when every acceptance criterion is satisfied and required checks pass. Otherwise use `partial` or `blocked`.
- Report changed files using repository-relative paths.
- Do not edit the approved proposal, accept your own report, or publish a viewer revision.
- Do not claim tests passed unless they were run and their result was observed.
- Use the coding agent's repository tools for inspection and testing. The viewer receives the result; it does not run or direct the implementation.

## Completion gate

Finish only when the user can distinguish completed work, failed or unrun checks, missing scope, extra scope, architectural drift, and remaining decisions.
