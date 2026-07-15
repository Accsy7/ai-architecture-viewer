# Discovery output contract

Produce artifacts compatible with protocol version `1.1.0`.

## architecture-snapshot.json

Required sections:

- artifact identity, creation time, project name and revision;
- included and excluded scope;
- architecture nodes and relations;
- assumptions and unknowns;
- relative reference to `evidence-manifest.json`.

Every node needs `id`, `name`, `purpose`, `technical`, `product`, `authorization`, and at least one `evidenceId`. Every edge needs stable endpoints, a relation type, and evidence.

## evidence-manifest.json

Each entry referenced by the current snapshot needs a stable ID, `sourceKind` of `workspace-file`, `basis` of `code-fact`, a repository-relative path, line range, SHA-256 content hash, and short summary. Include a short excerpt only when it is approved for the artifact. Inferences belong in snapshot assumptions or unknowns and cannot prove current implementation.

Use the canonical schema at `protocol/ai-coding-exchange.schema.json` when the skill is running inside the AI Architecture Viewer repository.
