'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const publishedGraph = {
  nodes: [
    { id: 'kept', type: 'architectureNode', position: { x: 20, y: 30 }, data: { name: 'Kept', purpose: 'Old', authorization: 'User only' } },
    { id: 'removed', type: 'architectureNode', position: { x: 320, y: 30 }, data: { name: 'Removed', purpose: 'Legacy' } },
  ],
  edges: [{ id: 'edge-kept', source: 'kept', target: 'removed', data: { label: 'Calls', relationType: 'flow', controlledBoundaryPosture: 'none' } }],
};

test('draft projection counts net semantic differences, ignores layout, and keeps four categories', async () => {
  const { buildDraftChangeProjection, DRAFT_CHANGE_CATEGORIES } = await import('../src/pending-changes.mjs');
  const draft = {
    draftId: 'draft-current-one',
    draftRevision: 3,
    graph: {
      nodes: [
        { id: 'kept', type: 'architectureNode', position: { x: 999, y: 888 }, data: { name: 'Kept', purpose: 'New', authorization: 'User only' } },
        { id: 'added', type: 'architectureNode', position: { x: 620, y: 30 }, data: { name: 'Added', purpose: 'New responsibility' } },
      ],
      edges: [{ id: 'edge-added', source: 'kept', target: 'added', data: { label: 'Routes', relationType: 'flow', controlledBoundaryPosture: 'controlled' } }],
    },
  };
  const projection = buildDraftChangeProjection({ publishedGraph, draft, proposals: [], diagramId: 'overview', view: 'current' });
  assert.deepEqual(Object.keys(projection.counts), DRAFT_CHANGE_CATEGORIES);
  assert.deepEqual(Object.values(projection.counts), [1, 1, 1, 2]);
  assert.equal(projection.totalCount, 5);
  assert.equal(projection.agentAttributedCount, 0);
  assert.deepEqual(projection.items.find((item) => item.targetId === 'kept').fields, ['purpose']);
});

test('layout-only drafts have no semantic changes and a later reversal reduces the net count', async () => {
  const { buildDraftChangeProjection } = await import('../src/pending-changes.mjs');
  const layoutOnly = {
    draftId: 'draft-layout',
    draftRevision: 1,
    graph: {
      nodes: publishedGraph.nodes.map((node) => ({ ...node, position: { x: node.position.x + 50, y: node.position.y + 20 } })),
      edges: structuredClone(publishedGraph.edges),
    },
  };
  assert.equal(buildDraftChangeProjection({ publishedGraph, draft: layoutOnly, diagramId: 'overview', view: 'current' }).totalCount, 0);
  const changed = structuredClone(layoutOnly);
  changed.graph.nodes[0].data.purpose = 'Temporary change';
  assert.equal(buildDraftChangeProjection({ publishedGraph, draft: changed, diagramId: 'overview', view: 'current' }).totalCount, 1);
  changed.graph.nodes[0].data.purpose = 'Old';
  assert.equal(buildDraftChangeProjection({ publishedGraph, draft: changed, diagramId: 'overview', view: 'current' }).totalCount, 0);
});

test('local correction metadata is traceable but never counted as architecture approval or semantic drift', async () => {
  const { buildDraftChangeProjection } = await import('../src/pending-changes.mjs');
  const publishedWithCorrection = structuredClone(publishedGraph);
  publishedWithCorrection.nodes[0].data.humanConfirmed = true;
  publishedWithCorrection.nodes[0].data.confirmationNote = 'Earlier local correction.';
  publishedWithCorrection.nodes[0].data.confirmedAt = '2026-07-15T00:00:00.000Z';
  const metadataOnly = {
    draftId: 'draft-correction-metadata', draftRevision: 1, graph: structuredClone(publishedWithCorrection),
  };
  metadataOnly.graph.nodes[0].data.confirmationNote = 'Updated local correction note.';
  metadataOnly.graph.nodes[0].data.confirmedAt = '2026-07-15T01:00:00.000Z';
  assert.equal(buildDraftChangeProjection({ publishedGraph: publishedWithCorrection, draft: metadataOnly, diagramId: 'overview', view: 'current' }).totalCount, 0);

  metadataOnly.graph.nodes[0].data.purpose = 'Agent changed responsibility';
  const proposal = {
    id: 'proposal-after-correction', status: 'draft-applied', view: 'current', diagramId: 'overview',
    application: { draftId: metadataOnly.draftId, draftRevision: 1 },
    origin: { runId: 'run-after-correction', agentName: 'Codex' }, evidence: [],
    changes: [{
      id: 'change-purpose-after-correction', kind: 'update', targetType: 'node', targetId: 'kept',
      summary: 'Revise responsibility', evidenceIds: [], patch: { data: { purpose: 'Agent changed responsibility' } },
    }],
  };
  const projection = buildDraftChangeProjection({ publishedGraph: publishedWithCorrection, draft: metadataOnly, proposals: [proposal], diagramId: 'overview', view: 'current' });
  assert.equal(projection.totalCount, 1);
  assert.equal(projection.agentAttributedCount, 1);
  assert.deepEqual(projection.items[0].fields, ['purpose']);
  assert.equal(projection.items[0].after.data.humanConfirmed, true);
});

test('an unknown local revision gap prevents a coincidentally equal value from being attributed to AI', async () => {
  const { buildDraftChangeProjection } = await import('../src/pending-changes.mjs');
  const draft = {
    draftId: 'draft-current-one',
    draftRevision: 4,
    graph: structuredClone(publishedGraph),
  };
  draft.graph.nodes[0].data.purpose = 'Agent result';
  draft.graph.nodes[1].data.authorization = 'Manual edit';
  const applied = {
    id: 'proposal-agent-one',
    status: 'draft-applied',
    diagramId: 'overview',
    view: 'current',
    application: { draftId: draft.draftId, draftRevision: 3 },
    origin: { runId: 'run-agent-one', agentName: 'Codex' },
    evidence: [{ id: 'evidence-code', basis: 'code-fact', summary: 'Repository proof' }],
    changes: [{
      id: 'change-purpose', kind: 'update', targetType: 'node', targetId: 'kept',
      summary: 'Update purpose', evidenceIds: ['evidence-code'], patch: { data: { purpose: 'Agent result' } },
    }],
  };
  const legacyPending = {
    ...structuredClone(applied), id: 'proposal-old', status: 'pending', laneLock: null,
    changes: [{ ...applied.changes[0], id: 'old-change', targetId: 'removed', patch: { data: { authorization: 'Manual edit' } } }],
  };
  const projection = buildDraftChangeProjection({
    publishedGraph, draft, proposals: [legacyPending, applied], diagramId: 'overview', view: 'current',
  });
  assert.equal(projection.totalCount, 2);
  assert.equal(projection.agentAttributedCount, 0);
  assert.equal(projection.traceableItemCount, 0);
  assert.equal(projection.items.find((item) => item.targetId === 'kept').agentSource, null);
  assert.equal(projection.items.find((item) => item.targetId === 'kept').provenance.fields[0].uncertainAfterRevision, 3);
  assert.equal(projection.items.find((item) => item.targetId === 'removed').agentAttributed, false);
  assert.equal(legacyPending.status, 'pending');
});

test('two continuous AI revisions preserve field-level sources from both agents', async () => {
  const { buildDraftChangeProjection } = await import('../src/pending-changes.mjs');
  const draft = { draftId: 'draft-two-agents', draftRevision: 3, graph: structuredClone(publishedGraph) };
  draft.graph.nodes[0].data.purpose = 'Purpose from AI one';
  draft.graph.nodes[0].data.authorization = 'Authorization from AI two';
  const proposal = (id, revision, agentName, field, value) => ({
    id, status: 'draft-applied', diagramId: 'overview', view: 'current',
    application: { draftId: draft.draftId, draftRevision: revision },
    origin: { runId: `run-${id}`, agentName }, evidence: [],
    changes: [{
      id: `change-${id}`, kind: 'update', targetType: 'node', targetId: 'kept',
      summary: `Write ${field}`, evidenceIds: [], patch: { data: { [field]: value } },
    }],
  });
  const projection = buildDraftChangeProjection({
    publishedGraph,
    draft,
    proposals: [
      proposal('purpose', 2, 'Codex', 'purpose', 'Purpose from AI one'),
      proposal('authorization', 3, 'Claude Code', 'authorization', 'Authorization from AI two'),
    ],
    diagramId: 'overview', view: 'current',
  });
  assert.equal(projection.totalCount, 1);
  assert.equal(projection.agentAttributedCount, 1);
  assert.equal(projection.items[0].provenance.status, 'agent');
  assert.equal(projection.items[0].agentSources.length, 2);
  assert.deepEqual(new Set(projection.items[0].agentSources.map((source) => source.origin.agentName)), new Set(['Codex', 'Claude Code']));
  assert.deepEqual(new Set(projection.items[0].agentSources.flatMap((source) => source.fields)), new Set(['purpose', 'authorization']));
});

test('an AI-created node becomes mixed when an untracked later draft revision may have changed its fields', async () => {
  const { buildDraftChangeProjection } = await import('../src/pending-changes.mjs');
  const draft = {
    draftId: 'draft-add-then-local', draftRevision: 2,
    graph: {
      nodes: [...structuredClone(publishedGraph.nodes), {
        id: 'agent-added', type: 'architectureNode', position: { x: 700, y: 20 },
        data: { name: 'Agent added', purpose: 'Locally revised purpose', authorization: 'Agent boundary' },
      }],
      edges: structuredClone(publishedGraph.edges),
    },
  };
  const proposal = {
    id: 'proposal-add-node', status: 'draft-applied', diagramId: 'overview', view: 'current',
    application: { draftId: draft.draftId, draftRevision: 1 },
    origin: { runId: 'run-add-node', agentName: 'Codex' }, evidence: [],
    changes: [{
      id: 'change-add-node', kind: 'add', targetType: 'node', targetId: 'agent-added',
      summary: 'Create a new module', evidenceIds: [],
      patch: { data: { name: 'Agent added', purpose: 'Initial agent purpose', authorization: 'Agent boundary' } },
    }],
  };
  const projection = buildDraftChangeProjection({ publishedGraph, draft, proposals: [proposal], diagramId: 'overview', view: 'current' });
  const item = projection.items.find((entry) => entry.targetId === 'agent-added');
  assert.equal(item.provenance.status, 'mixed');
  assert.deepEqual(item.agentSources[0].fields, ['__add']);
  assert.deepEqual(new Set(item.provenance.unattributedFields), new Set(['name', 'purpose', 'authorization']));
  assert.equal(projection.agentAttributedCount, 0);
  assert.equal(projection.partiallyAgentAttributedCount, 1);

  draft.graph.nodes.find((node) => node.id === 'agent-added').data.purpose = 'Initial agent purpose';
  const sameValueAgain = buildDraftChangeProjection({ publishedGraph, draft, proposals: [proposal], diagramId: 'overview', view: 'current' });
  assert.equal(sameValueAgain.items.find((entry) => entry.targetId === 'agent-added').provenance.status, 'mixed', 'matching an old value cannot bridge an unknown local revision');
});

test('canvas decoration shows additions, changes and removals without mutating either source graph', async () => {
  const { buildDraftChangeProjection, decorateFlowWithDraftChanges } = await import('../src/pending-changes.mjs');
  const draft = {
    draftId: 'draft-current-one', draftRevision: 1,
    graph: {
      nodes: [
        { id: 'kept', type: 'architectureNode', position: { x: 20, y: 30 }, data: { name: 'Kept', purpose: 'New', authorization: 'User only' } },
        { id: 'added', type: 'architectureNode', position: { x: 620, y: 30 }, data: { name: 'Added', purpose: 'New responsibility' } },
      ],
      edges: [],
    },
  };
  const publishedBefore = structuredClone(publishedGraph);
  const draftBefore = structuredClone(draft.graph);
  const projection = buildDraftChangeProjection({ publishedGraph, draft, diagramId: 'overview', view: 'current' });
  const decorated = decorateFlowWithDraftChanges(
    draft.graph.nodes,
    draft.graph.edges,
    publishedGraph.nodes,
    publishedGraph.edges,
    projection.items,
  );
  assert.equal(decorated.nodes.find((node) => node.id === 'added').data.__draftAddition, true);
  assert.equal(decorated.nodes.find((node) => node.id === 'kept').data.__draftChanges[0].category, 'module-changed');
  assert.equal(decorated.nodes.find((node) => node.id === 'removed').data.__draftRemoval, true);
  assert.equal(decorated.edges.find((edge) => edge.id === 'edge-kept').data.__draftRemoval, true);
  assert.deepEqual(publishedGraph, publishedBefore);
  assert.deepEqual(draft.graph, draftBefore);
});

test('target draft projection exposes contract-only additions, updates, removals and traceable sources', async () => {
  const { buildDraftChangeProjection } = await import('../src/pending-changes.mjs');
  const publishedContract = {
    status: 'executable',
    acceptanceCriteria: [
      { id: 'criterion-update', statement: 'Original statement', targetRefs: [{ targetType: 'node', targetId: 'kept' }] },
      { id: 'criterion-remove', statement: 'Remove me', targetRefs: [{ targetType: 'node', targetId: 'removed' }] },
    ],
  };
  const draft = {
    draftId: 'draft-target-contract',
    draftRevision: 4,
    graph: structuredClone(publishedGraph),
    developmentContract: {
      status: 'draft',
      acceptanceCriteria: [
        { id: 'criterion-update', statement: 'Revised statement', targetRefs: [{ targetType: 'node', targetId: 'kept' }] },
        { id: 'criterion-add', statement: 'New observable result', targetRefs: [{ targetType: 'node', targetId: 'kept' }] },
      ],
    },
  };
  const proposal = {
    id: 'proposal-contract-write',
    status: 'draft-applied',
    diagramId: 'overview',
    view: 'target',
    title: 'Revise development contract',
    summary: 'Keep criterion IDs stable.',
    application: { draftId: draft.draftId, draftRevision: 4 },
    origin: { runId: 'run-contract-write', agentName: 'Codex' },
    evidenceIds: ['evidence-discussion'],
    changes: [],
    contractPatch: {
      upsert: [
        { ...draft.developmentContract.acceptanceCriteria[0], evidenceIds: ['evidence-discussion'] },
        { ...draft.developmentContract.acceptanceCriteria[1], evidenceIds: ['evidence-discussion'] },
      ],
      delete: [{ id: 'criterion-remove', evidenceIds: ['evidence-discussion'] }],
    },
  };
  const evidence = [{ id: 'evidence-discussion', basis: 'user-confirmed', summary: 'Confirmed in discussion.' }];
  const projection = buildDraftChangeProjection({
    publishedGraph,
    publishedContract,
    draft,
    proposals: [proposal],
    evidence,
    diagramId: 'overview',
    view: 'target',
  });
  assert.equal(projection.graphChangeCount, 0);
  assert.equal(projection.criterionChangeCount, 3);
  assert.equal(projection.totalCount, 3);
  assert.deepEqual(Object.values(projection.criterionCounts), [1, 1, 1]);
  assert.equal(projection.agentAttributedCount, 3);
  assert.equal(projection.items.find((item) => item.targetId === 'criterion-update').fields[0], 'statement');
  assert.equal(projection.items.find((item) => item.targetId === 'criterion-remove').agentSource.origin.runId, 'run-contract-write');
  assert.equal(projection.items.find((item) => item.targetId === 'criterion-add').agentSource.evidence[0].basis, 'user-confirmed');
});

test('explicit null removal is projected as a traceable before-to-none semantic change', async () => {
  const { buildDraftChangeProjection } = await import('../src/pending-changes.mjs');
  const withDrilldown = structuredClone(publishedGraph);
  const target = withDrilldown.nodes.find((node) => node.id === 'kept');
  target.data.relatedDiagramId = 'details';
  target.data.relatedNodeId = 'detail-entry';
  const draft = {
    draftId: 'draft-clear-drilldown',
    draftRevision: 1,
    graph: structuredClone(withDrilldown),
  };
  delete draft.graph.nodes.find((node) => node.id === 'kept').data.relatedDiagramId;
  delete draft.graph.nodes.find((node) => node.id === 'kept').data.relatedNodeId;
  const proposal = {
    id: 'proposal-clear-drilldown', status: 'draft-applied', diagramId: 'overview', view: 'current',
    title: 'Clear drill-down', summary: 'Remove an obsolete drill-down target.',
    application: { draftId: draft.draftId, draftRevision: 1, outcome: 'draft-updated' },
    origin: { runId: 'run-clear-drilldown', agentName: 'Codex' },
    evidenceIds: ['evidence-code'],
    changes: [{
      id: 'change-clear-drilldown', kind: 'update', targetType: 'node', targetId: 'kept',
      summary: 'Clear the drill-down pair.', evidenceIds: ['evidence-code'],
      patch: { data: { relatedDiagramId: null, relatedNodeId: null } },
    }],
  };
  const projection = buildDraftChangeProjection({
    publishedGraph: withDrilldown,
    draft,
    proposals: [proposal],
    evidence: [{ id: 'evidence-code', basis: 'code-fact' }],
    diagramId: 'overview',
    view: 'current',
  });
  assert.equal(projection.totalCount, 1);
  assert.deepEqual(projection.items[0].fields.sort(), ['relatedDiagramId', 'relatedNodeId']);
  assert.equal(projection.items[0].agentAttributed, true);
  assert.equal(projection.items[0].after.data.relatedDiagramId, undefined);
});
