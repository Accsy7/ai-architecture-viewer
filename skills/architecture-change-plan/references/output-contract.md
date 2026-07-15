# Change-plan output contract

Produce artifacts compatible with protocol version `1.3.0`.

## task-request.json

Capture the user's goal, constraints, non-goals, acceptance criteria, and unresolved decisions. This file records intent; it does not authorize implementation by itself.

## architecture-proposal.json

Reference the request and base snapshot. Include up to three options, one recommendation, risks, required decisions, and semantic changes. Each change needs a stable target, concise rationale, and evidence IDs. Each acceptance criterion must have a stable `id`, an observable `statement`, and explicit `targetRefs`; implementation reports will be rejected if they omit, invent, or rewrite these IDs after publication.

Allowed change kinds are `add`, `update`, and `remove`. Allowed targets are `node` and `edge`. Allowed relation types are `flow`, `support`, `reference`, `governance`, and `handoff`; controlled boundary postures are `none`, `controlled`, and `blocked`.

## evidence-manifest.json

Carry forward only evidence actually used by the plan and add new decision evidence where needed.

- A user-confirmed discussion entry uses `sourceKind: discussion`, `basis: user-confirmed`, a source label, timestamp, summary, and the exact reviewed excerpt. It does not claim a file path or submitted hash.
- An unconfirmed discussion conclusion uses `basis: agent-inference` and remains visibly distinct from user confirmation.
- A Markdown design source uses `sourceKind: workspace-file`, `basis: design-document`, a workspace-relative path, line range, and SHA-256 content hash.
- A registered project document uses `sourceKind: project-document`, `basis: design-document` or `user-confirmed`, a `documentId`, optional exact `section`, and the content hash returned by `read_project_document`. It does not claim a workspace path.
- Observed implementation uses `basis: code-fact`. Do not use this label for intended design.

Discussion and design-document evidence may support a target proposal, but must never be submitted as proof of the current implementation.

Use the canonical schema at `protocol/ai-coding-exchange.schema.json` when available.
