import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDraftContract, sensitiveDraftChanges } from '../src/development-contract-preview.mjs';

const graph = {
  nodes: [{ id: 'module-a' }],
  edges: [{ id: 'edge-a' }],
};

test('draft contract preview matches publication executability for target references', () => {
  assert.deepEqual(evaluateDraftContract([], graph), { executable: false, missingReferences: [] });
  assert.equal(evaluateDraftContract([{
    id: 'criterion-valid',
    statement: 'Observable result',
    targetRefs: [{ targetType: 'node', targetId: 'module-a' }, { targetType: 'edge', targetId: 'edge-a' }],
  }], graph).executable, true);

  const invalid = evaluateDraftContract([{
    id: 'criterion-stale',
    statement: 'References a removed module',
    targetRefs: [{ targetType: 'node', targetId: 'removed-module' }],
  }], graph);
  assert.equal(invalid.executable, false);
  assert.deepEqual(invalid.missingReferences[0].missingTargetRefs, [{ targetType: 'node', targetId: 'removed-module' }]);
});

test('sensitive preview includes added and removed permission boundaries and relationship endpoints', () => {
  const removedNode = {
    id: 'draft-diff:node:admin',
    targetType: 'node',
    targetId: 'admin',
    kind: 'remove',
    fields: [],
    before: { id: 'admin', data: { authorization: 'human-only' } },
    after: null,
  };
  const removedEdge = {
    id: 'draft-diff:edge:approval',
    targetType: 'edge',
    targetId: 'approval',
    kind: 'remove',
    fields: [],
    before: { id: 'approval', source: 'admin', target: 'service', data: { controlledBoundaryPosture: 'controlled' } },
    after: null,
  };
  const addedEdge = {
    id: 'draft-diff:edge:new',
    targetType: 'edge',
    targetId: 'new',
    kind: 'add',
    fields: [],
    before: null,
    after: { id: 'new', source: 'client', target: 'service', data: { controlledBoundaryPosture: 'blocked' } },
  };
  const changes = sensitiveDraftChanges([removedNode, removedEdge, addedEdge]);
  assert.deepEqual(changes.filter((entry) => entry.item === removedNode).map((entry) => entry.field), ['authorization']);
  assert.deepEqual(changes.filter((entry) => entry.item === removedEdge).map((entry) => entry.field), ['controlledBoundaryPosture', 'source', 'target']);
  assert.deepEqual(changes.filter((entry) => entry.item === addedEdge).map((entry) => entry.field), ['controlledBoundaryPosture', 'source', 'target']);
  assert.equal(changes.find((entry) => entry.item === removedEdge && entry.field === 'source').after, null);
  assert.equal(changes.find((entry) => entry.item === addedEdge && entry.field === 'target').before, null);
});
