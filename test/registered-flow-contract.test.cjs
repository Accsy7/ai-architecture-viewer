'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  canonicalSha256,
  resolveRegisteredFlowRegistry,
  validateRegisteredFlowRegistry,
} = require('../schema/registered-flow-contract.cjs');

function fixture() {
  const sourceDraft = {
    draftId: 'source-draft',
    draftRevision: 7,
    graph: {
      nodes: [
        { id: 'source-a', data: { name: 'A' } },
        { id: 'source-b', data: { name: 'B' } },
        { id: 'source-c', data: { name: 'C' } },
        { id: 'artifact', data: { name: 'Artifact', purpose: 'Not a product' } },
        { id: 'source-d', data: { name: 'D' } },
      ],
      edges: [
        { id: 'edge-a-c', source: 'source-a', target: 'source-c', data: { label: 'A to C' } },
        { id: 'edge-b-c', source: 'source-b', target: 'source-c', data: { label: 'B to C' } },
        { id: 'edge-c-artifact', source: 'source-c', target: 'artifact', data: { label: 'Prepare' } },
        { id: 'edge-artifact-d', source: 'artifact', target: 'source-d', data: { label: 'Handoff' } },
      ],
    },
  };
  const projectionDraft = {
    draftId: 'projection-draft',
    draftRevision: 3,
    graph: {
      nodes: ['product-a', 'product-b', 'product-c', 'product-d'].map((id) => ({ id, data: { name: id } })),
      edges: [
        { id: 'projection-a-c', source: 'product-a', target: 'product-c', data: { label: 'A to C' } },
        { id: 'projection-b-c', source: 'product-b', target: 'product-c', data: { label: 'B to C' } },
      ],
    },
  };
  const states = {
    'source-state': { target: { draft: sourceDraft, published: null } },
    'projection-state': { target: { draft: projectionDraft, published: null } },
  };
  const catalog = {
    diagrams: [
      { id: 'source-diagram', statePath: 'source-state' },
      { id: 'projection-diagram', statePath: 'projection-state' },
    ],
  };
  const raw = {
    schemaVersion: '1.0.0',
    flows: [{
      id: 'registered-flow',
      title: 'Registered flow',
      description: 'A registered DAG projection.',
      source: {
        diagramId: 'source-diagram',
        view: 'target',
        revision: {
          kind: 'draft', id: sourceDraft.draftId, revision: sourceDraft.draftRevision,
          canonicalSha256: canonicalSha256(sourceDraft),
        },
      },
      projection: {
        diagramId: 'projection-diagram',
        view: 'target',
        revision: {
          kind: 'draft', id: projectionDraft.draftId, revision: projectionDraft.draftRevision,
          canonicalSha256: canonicalSha256(projectionDraft),
        },
      },
      order: 'topological-stages',
      nodeMappings: [
        ['source-a', 'product-a'], ['source-b', 'product-b'], ['source-c', 'product-c'], ['source-d', 'product-d'],
      ].map(([sourceNodeId, projectionNodeId]) => ({ sourceNodeId, projectionNodeId })),
      edgeMappings: [
        ['edge-a-c', 'projection-a-c'], ['edge-b-c', 'projection-b-c'],
      ].map(([sourceEdgeId, projectionEdgeId]) => ({ sourceEdgeId, projectionEdgeId })),
      sidebarOnlyNodeIds: ['artifact'],
      sidebarOnlyEdgeIds: ['edge-c-artifact', 'edge-artifact-d'],
    }],
  };
  return { raw, catalog, states, sourceDraft, projectionDraft };
}

const resolve = ({ raw, catalog, states }) => resolveRegisteredFlowRegistry(raw, {
  catalog,
  diagramId: 'projection-diagram',
  view: 'target',
  readState: (statePath) => states[statePath],
});

test('registered flow projects only explicit stable mappings and assigns parallel DAG stages', () => {
  const data = fixture();
  const result = resolve(data);
  assert.equal(result.flows.length, 1);
  const flow = result.flows[0];
  assert.deepEqual(flow.nodes.map((node) => [node.sourceNodeId, node.step]), [
    ['source-a', 1], ['source-b', 1], ['source-c', 2], ['artifact', 3], ['source-d', 4],
  ]);
  assert.equal(flow.nodes.find((node) => node.sourceNodeId === 'artifact').projectionNodeId, null);
  assert.equal(flow.nodes.find((node) => node.sourceNodeId === 'artifact').sidebarOnly, true);
  assert.deepEqual(flow.mappedEdgeIds, ['projection-a-c', 'projection-b-c']);
  assert.equal(flow.edges.filter((edge) => edge.sidebarOnly).length, 2);
});

test('registered flow fails closed when a revision hash drifts', () => {
  const data = fixture();
  data.raw.flows[0].source.revision.canonicalSha256 = '0'.repeat(64);
  assert.throws(() => resolve(data), (error) => (
    error.code === 'REGISTERED_FLOW_INVALID' && /版本锁失配/.test(error.message)
  ));
});

test('registered flow rejects incomplete node or edge coverage', () => {
  const missingNode = fixture();
  missingNode.raw.flows[0].sidebarOnlyNodeIds = [];
  assert.throws(() => resolve(missingNode), /未完整覆盖源节点/);

  const missingEdge = fixture();
  missingEdge.raw.flows[0].sidebarOnlyEdgeIds.pop();
  assert.throws(() => resolve(missingEdge), /未完整覆盖源边/);
});

test('registered flow rejects mapped edges whose projection direction differs', () => {
  const data = fixture();
  data.projectionDraft.graph.edges[0] = {
    ...data.projectionDraft.graph.edges[0],
    source: 'product-c',
    target: 'product-a',
  };
  data.raw.flows[0].projection.revision.canonicalSha256 = canonicalSha256(data.projectionDraft);
  assert.throws(() => resolve(data), /边方向或端点映射失配/);
});

test('registered flow rejects a cycle instead of inventing an order', () => {
  const data = fixture();
  data.sourceDraft.graph.edges.push({ id: 'edge-d-a', source: 'source-d', target: 'source-a', data: { label: 'cycle' } });
  data.raw.flows[0].sidebarOnlyEdgeIds.push('edge-d-a');
  data.raw.flows[0].source.revision.canonicalSha256 = canonicalSha256(data.sourceDraft);
  assert.throws(() => resolve(data), /不是有向无环图/);
});

test('registry schema is strict and does not accept path-finding options', () => {
  const data = fixture();
  data.raw.flows[0].shortestPath = true;
  assert.throws(() => validateRegisteredFlowRegistry(data.raw), /包含未登记字段/);
});
