---
name: architecture-change-plan
description: Turn a user's product goal into an evidence-backed, reviewable target architecture proposal for AI Architecture Viewer. Use before AI coding begins, when comparing implementation options, defining scope and acceptance criteria, or revising a published target. Do not use it to implement code.
---

# Architecture Change Plan

Convert user intent and available evidence into a small, decision-ready target architecture proposal. A concept project does not need a code repository: user-confirmed discussion conclusions and Markdown design materials are valid target-design inputs.

## Workflow

1. When AI Architecture Viewer MCP tools are available, call `get_project_context` for the target view and `get_approved_target`, then call `create_agent_run` with task type `architecture-change-plan` and view `target`. Retain the returned run ID.
2. Read the user goal, constraints, exclusions, latest published target, explicitly confirmed discussion conclusions, and any authorized Markdown design materials. Do not require repository code for a concept project.
3. Ask only for missing decisions that would materially change scope, safety, data handling, or acceptance.
4. Create up to three viable options. State advantages, disadvantages, migration impact, and important unknowns.
5. Recommend one option, but keep the recommendation separate from the user's approval.
6. Express the recommended option as basis-backed node and edge changes. Do not include coordinates, layout, branding, or manual-confirmation fields.
7. Define observable acceptance criteria and explicit non-goals.
8. Write the artifacts under `ai-coding/plans/<request-id>/`:
   - `task-request.json`
   - `architecture-proposal.json`
   - `evidence-manifest.json`
9. If `protocol/validate-artifact.cjs` is available, validate every artifact before handoff.
10. Submit the proposal and evidence with `submit_change_proposal`. If MCP is unavailable, run `npm run agent -- submit --run <run-id> --artifact <proposal-path> --evidence <manifest-path>`.

## Output rules

- Read [references/output-contract.md](references/output-contract.md) before writing artifacts.
- Start from the JSON files in [assets](assets) when useful.
- Link every proposed change to one or more basis entries. Use `user-confirmed` for an explicit user decision, `design-document` for an authorized file, `code-fact` for observed implementation, and `agent-inference` for an unconfirmed conclusion.
- Use `sourceKind: discussion` only with `user-confirmed` or `agent-inference`. Use `sourceKind: workspace-file` with a relative path, line range, and SHA-256 hash for Markdown or code.
- Never describe discussion conclusions, design documents, or agent inference as current implemented architecture. They support the target design only.
- Keep code execution, file mutation, deployment, and publication outside this skill.
- Never mark the proposal approved. User acceptance writes only a draft; publication is a separate human-only action in the viewer.
- Never replace or publish the viewer's current or target architecture directly.
- The viewer is not an embedded planner. Perform reasoning in the coding agent, then use the viewer only for structured handoff and human review.

## Completion gate

Finish only when the user can see the recommended option, alternatives, scope, risks, acceptance criteria, required decisions, and the exact architecture changes that would follow.
