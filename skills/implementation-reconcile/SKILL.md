---
name: implementation-reconcile
description: Compare AI-coded repository changes and test results with an approved architecture proposal, then produce an evidence-backed implementation report and refreshed current architecture snapshot. Use after implementation, during acceptance, after a refactor, or when architecture drift is suspected. Do not use it to approve or publish the result automatically.
---

# Implementation Reconcile

Verify what was actually built and make all architecture drift visible to the user.

## Workflow

1. Read the approved request, approved architecture proposal, base snapshot, and repository revision.
2. Inspect the actual worktree or revision diff. Include uncommitted changes when they are in scope and identify them as uncommitted.
3. Run the relevant tests, builds, checks, or safe diagnostics. Record command, outcome, and a concise result; never hide failures.
4. Map implementation evidence to each acceptance criterion and approved architecture change.
5. Classify drift as `missing`, `extra`, `changed`, or `unverified`. Explain whether it appears justified, but do not silently rewrite the approved target.
6. Generate the resulting current-state architecture from code facts, keeping facts separate from inference.
7. Write the artifacts under `ai-coding/reconciliation/<run-id>/`:
   - `implementation-report.json`
   - `architecture-snapshot.json`
   - `evidence-manifest.json`
8. If `protocol/validate-artifact.cjs` is available, validate all files before reporting completion.

## Output rules

- Read [references/output-contract.md](references/output-contract.md) before writing artifacts.
- Start from the JSON files in [assets](assets) when useful.
- Use `complete` only when every acceptance criterion is satisfied and required checks pass. Otherwise use `partial` or `blocked`.
- Report changed files using repository-relative paths.
- Do not edit the approved proposal, accept your own report, or publish a viewer revision.
- Do not claim tests passed unless they were run and their result was observed.

## Completion gate

Finish only when the user can distinguish completed work, failed or unrun checks, missing scope, extra scope, architectural drift, and remaining decisions.
