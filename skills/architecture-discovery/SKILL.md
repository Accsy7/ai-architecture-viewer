---
name: architecture-discovery
description: Inspect an authorized code repository and produce an evidence-backed architecture snapshot for AI Architecture Viewer. Use when onboarding a project, refreshing the current architecture, explaining an unfamiliar repository, or preparing grounded context before architecture planning. Do not use it to implement changes.
---

# Architecture Discovery

Create a factual current-state architecture package without modifying application code.

## Workflow

1. Confirm the repository root and the user-authorized scope. Treat unspecified external directories, secrets, generated output, dependency caches, and customer data as out of scope.
2. Record the workspace revision. Prefer a commit identifier when available; otherwise use a stable workspace label and state that the tree is uncommitted.
3. Inspect entry points, manifests, build and test configuration, runtime boundaries, modules, storage, external integrations, and human or authorization gates.
4. Separate facts from inferences. Support every node, edge, and material conclusion with one or more evidence IDs.
5. Use repository-relative forward-slash paths. Never emit absolute paths, credentials, full secret values, or unapproved source bodies.
6. Write the artifacts under `ai-coding/discovery/<run-id>/`:
   - `architecture-snapshot.json`
   - `evidence-manifest.json`
7. If `protocol/validate-artifact.cjs` is available, validate both files before reporting completion.
8. Report unknowns and conflicting evidence explicitly. Do not invent missing architecture facts.

## Output rules

- Read [references/output-contract.md](references/output-contract.md) before writing artifacts.
- Start from the JSON files in [assets](assets) when useful.
- Keep node IDs stable across repeated discovery runs whenever the same responsibility still exists.
- Use only `flow`, `support`, `reference`, `governance`, or `handoff` as relation types.
- Mark evidence as `fact` or `inference`; an inference must explain its uncertainty.
- Do not edit `state.json`, `analysis.json`, viewer layout files, or any published architecture revision.

## Completion gate

Finish only when the artifacts parse as JSON, all referenced evidence IDs exist, all paths are repository-relative, and limitations are visible to the user.
