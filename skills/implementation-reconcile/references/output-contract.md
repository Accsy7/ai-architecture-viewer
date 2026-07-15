# Reconciliation output contract

Produce artifacts compatible with protocol version `1.1.0`.

## implementation-report.json

Reference the approved request and proposal. Record implementation status, resulting revision, changed files, test results, acceptance-criterion results, architecture drift, unresolved items, and the related evidence manifest.

Status values are `complete`, `partial`, and `blocked`. Test outcomes are `passed`, `failed`, and `not-run`. Drift kinds are `missing`, `extra`, `changed`, and `unverified`.

## architecture-snapshot.json

Describe the actual post-implementation architecture, not the intended design. Every material node and relation must link to implementation evidence.

## evidence-manifest.json

Use `sourceKind: workspace-file`, `basis: code-fact`, repository-relative paths, line ranges, SHA-256 hashes, and short summaries. Do not include secrets or unrelated customer data. Design documents and discussion conclusions cannot be used as proof of the implemented current state.

Use the canonical schema at `protocol/ai-coding-exchange.schema.json` when available.
