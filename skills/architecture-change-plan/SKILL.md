---
name: architecture-change-plan
description: Turn a user's product goal into an evidence-backed, reviewable target architecture proposal for AI Architecture Viewer. Use before AI coding begins, when comparing implementation options, defining scope and acceptance criteria, or revising an approved target. Do not use it to implement code.
---

# Architecture Change Plan

Convert user intent and current-state evidence into a small, decision-ready target architecture proposal.

## Workflow

1. Read the user goal, constraints, exclusions, latest architecture snapshot, and evidence manifest.
2. Ask only for missing decisions that would materially change scope, safety, data handling, or acceptance.
3. Create up to three viable options. State advantages, disadvantages, migration impact, and important unknowns.
4. Recommend one option, but keep the recommendation separate from the user's approval.
5. Express the recommended option as evidence-backed node and edge changes. Do not include coordinates, layout, branding, or manual-confirmation fields.
6. Define observable acceptance criteria and explicit non-goals.
7. Write the artifacts under `ai-coding/plans/<request-id>/`:
   - `task-request.json`
   - `architecture-proposal.json`
   - `evidence-manifest.json`
8. If `protocol/validate-artifact.cjs` is available, validate every artifact before handoff.

## Output rules

- Read [references/output-contract.md](references/output-contract.md) before writing artifacts.
- Start from the JSON files in [assets](assets) when useful.
- Link every proposed change to evidence or label it as a decision assumption requiring confirmation.
- Keep code execution, file mutation, deployment, and publication outside this skill.
- Never mark the proposal approved. The user must approve it in the viewer.
- Never replace or publish the viewer's current or target architecture directly.

## Completion gate

Finish only when the user can see the recommended option, alternatives, scope, risks, acceptance criteria, required decisions, and the exact architecture changes that would follow.
