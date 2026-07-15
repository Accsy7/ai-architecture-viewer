# Reconciliation output contract

Produce artifacts compatible with protocol version `1.4.0`.

## implementation-report.json

Reference the approved request and copy the run's exact `approvedTarget` descriptor (`diagramId`, `revision`, `revisionId`, `semanticHash`, `contractId`, `contractHash`, and `documentSetHash`). Reference the already submitted snapshot through `resultingSnapshotArtifactId`. Never use an accepted but unpublished, legacy/unbound, or stale target as the implementation contract. Every `acceptanceResults` entry must use a frozen `criterionId` exactly once; omitted, extra, or rewritten criteria are rejected.

Status values are `complete`, `partial`, and `blocked`, but they are only the agent's claim. They do not represent final completion or user acceptance. Test outcomes are `passed`, `failed`, and `not-run`. Drift kinds are `missing`, `extra`, `changed`, and `unverified`.

After submission, the server exposes four separate states: `agentClaim`, the automatic `architectureGate`, the server-computed `contractGate`, and the local user's `humanReview`. The contract gate joins immutable criterion statements and target references from the published contract with your submitted result statuses and evidence IDs. A `partial` or `blocked` claim, or any `unsatisfied` or `unverified` criterion, blocks acceptance even when the architecture graph is aligned. Only the user can accept, reject, or request revision, and an agent explanation matching a drift item is still pending human judgment.

## architecture-snapshot.json

Describe the complete actual post-implementation architecture, not the intended design. Every material node and relation must link to implementation evidence. Preserve optional `interactionModes`, `architectureLayer`, and `documentRefs` when present. Each relation must include `controlledBoundaryPosture` with `none`, `controlled`, or `blocked` so the server can compare governance boundaries as well as endpoints and labels.

Submit this snapshot before the implementation report. The server compares it with the run-locked formal target by stable ID and rejects a report that points to another snapshot. A successful comparison does not skip local human review.

## evidence-manifest.json

Use `sourceKind: workspace-file`, `basis: code-fact`, repository-relative paths, line ranges, SHA-256 hashes, and short summaries. Do not include secrets or unrelated customer data. Design documents and discussion conclusions cannot be used as proof of the implemented current state.

Use the canonical schema at `protocol/ai-coding-exchange.schema.json` when available.
