# Reconciliation output contract

Produce artifacts compatible with protocol version `1.2.0`.

## implementation-report.json

Reference the approved request and copy the run's exact `approvedTarget` descriptor (`diagramId`, `revision`, `revisionId`, and `semanticHash`). Reference the already submitted snapshot through `resultingSnapshotArtifactId`. Never use an accepted but unpublished draft as the implementation contract. Record implementation status, resulting revision, changed files, test results, acceptance-criterion results, architecture drift, unresolved items, and the related evidence manifest.

Status values are `complete`, `partial`, and `blocked`. Test outcomes are `passed`, `failed`, and `not-run`. Drift kinds are `missing`, `extra`, `changed`, and `unverified`.

## architecture-snapshot.json

Describe the complete actual post-implementation architecture, not the intended design. Every material node and relation must link to implementation evidence. Each relation must include `controlledBoundaryPosture` with `none`, `controlled`, or `blocked` so the server can compare governance boundaries as well as endpoints and labels.

Submit this snapshot before the implementation report. The server compares it with the run-locked formal target by stable ID and rejects a report that points to another snapshot.

## evidence-manifest.json

Use `sourceKind: workspace-file`, `basis: code-fact`, repository-relative paths, line ranges, SHA-256 hashes, and short summaries. Do not include secrets or unrelated customer data. Design documents and discussion conclusions cannot be used as proof of the implemented current state.

Use the canonical schema at `protocol/ai-coding-exchange.schema.json` when available.
