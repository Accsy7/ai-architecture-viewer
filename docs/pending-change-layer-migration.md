# v0.6 direct-draft compatibility notes

This release replaces the normal proposal-inbox approval step with a direct, locked draft-write flow. It is a non-destructive compatibility change: historical proposals, evidence, runs, reviews, published revisions, and drafts remain readable.

## Governance model

- External agents discuss architecture with the user in Codex, Claude Code, or another coding-agent conversation.
- A discovery or change-plan run submits one evidence-backed stable-ID semantic patch. The server applies it directly to the exact draft locked when the run was created.
- The patch never changes a published revision, never records human approval, and never publishes a development contract.
- Publication in the local viewer is the sole human gate for architecture. Implementation results still have their separate local human acceptance gate.
- MCP exposes no publication, approval, proposal-review, or implementation-review tool.

## Locking and provenance

Every architecture run locks the published revision plus the active draft ID and revision. A changed baseline or draft makes the submission stale. One discovery or change-plan run accepts one architecture patch; for another patch, the agent rereads the compact draft and creates a new run. No user action is required between those runs.

A successful draft write stores its run/client identity, artifact ID, stable change IDs, evidence, time, summary, and resulting draft identity. State and analysis provenance are committed together: a failed provenance write rolls the draft back, and an exact artifact replay performs no write or revision increment.

Architecture-discovery snapshots update the locked current draft additively from code facts. Snapshots submitted by an implementation-reconcile run remain reconciliation evidence only and do not update the current draft.

## Existing data

- Existing `accepted` and `rejected` proposals and their review records remain historical facts.
- Existing `pending` proposals are preserved as historical agent submissions. The old accept/reject endpoints are retired; no migration invents a user decision or silently applies them.
- A legacy pending proposal without a lane lock is explicitly shown as needing a new run if its idea is still relevant.
- Existing drafts are preserved. Their differences are not labelled as AI-authored unless a matching `draft-applied` record can be traced to the same draft.
- v0.2–v0.5 analysis and state packages continue through the normal compatible migration path.

## Canvas projection

The canvas computes a read-only net semantic difference between the active draft and its published version. It is not an approval queue and not a fourth architecture state.

- additions, changes, removals, relationships, and controlled boundaries are highlighted;
- later patches that reverse earlier work reduce the count automatically;
- layout-only moves are excluded;
- the UI reports both total unpublished differences and the subset traceable to agent draft writes;
- unknown, migrated, or manual changes are never mislabelled as AI changes.

The formal current-versus-target comparison remains published-to-published unless the user is viewing an individual lane's draft projection.
