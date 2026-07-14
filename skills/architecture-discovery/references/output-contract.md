# Discovery output contract

Produce artifacts compatible with protocol version `1.0.0`.

## architecture-snapshot.json

Required sections:

- artifact identity, creation time, project name and revision;
- included and excluded scope;
- architecture nodes and relations;
- assumptions and unknowns;
- relative reference to `evidence-manifest.json`.

Every node needs `id`, `name`, `purpose`, `technical`, `product`, `authorization`, and at least one `evidenceId`. Every edge needs stable endpoints, a relation type, and evidence.

## evidence-manifest.json

Each entry needs a stable ID, repository-relative path, line range, SHA-256 content hash, short summary, and `basis` of `fact` or `inference`. Include a short excerpt only when it is approved for the artifact.

Use the canonical schema at `protocol/ai-coding-exchange.schema.json` when the skill is running inside the AI Architecture Viewer repository.
