# Change-plan output contract

Produce artifacts compatible with protocol version `1.0.0`.

## task-request.json

Capture the user's goal, constraints, non-goals, acceptance criteria, and unresolved decisions. This file records intent; it does not authorize implementation by itself.

## architecture-proposal.json

Reference the request and base snapshot. Include up to three options, one recommendation, risks, required decisions, and semantic changes. Each change needs a stable target, concise rationale, and evidence IDs.

Allowed change kinds are `add`, `update`, and `remove`. Allowed targets are `node` and `edge`. Allowed relation types are `flow`, `support`, `reference`, `governance`, and `handoff`.

## evidence-manifest.json

Carry forward only evidence actually used by the plan and add new decision evidence where needed. Use repository-relative paths and SHA-256 hashes.

Use the canonical schema at `protocol/ai-coding-exchange.schema.json` when available.
