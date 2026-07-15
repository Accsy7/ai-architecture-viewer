import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availableFlowsForFocus,
  flowCanvasProjection,
  oneHopProjection,
  projectionNodeForSource,
  sourceNodeForProjection,
} from '../src/registered-flows.mjs';

const flow = {
  id: 'flow',
  focusNodeIds: ['a', 'b'],
  mappedEdgeIds: ['a-b'],
  nodes: [
    { sourceNodeId: 'source-a', projectionNodeId: 'a', step: 1 },
    { sourceNodeId: 'artifact', projectionNodeId: null, step: 2, sidebarOnly: true },
    { sourceNodeId: 'source-b', projectionNodeId: 'b', step: 3 },
  ],
};

test('one-hop focus contains only the focused node, direct neighbors, and incident edges', () => {
  const projection = oneHopProjection(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'c-a', source: 'c', target: 'a' },
      { id: 'c-d', source: 'c', target: 'd' },
    ],
    'a',
  );
  assert.deepEqual([...projection.nodeIds], ['a', 'b', 'c']);
  assert.deepEqual([...projection.edgeIds], ['a-b', 'c-a']);
});

test('flow helpers expose only explicit mappings and keep sidebar artifacts off canvas', () => {
  assert.deepEqual(availableFlowsForFocus([flow], 'a'), [flow]);
  assert.deepEqual(availableFlowsForFocus([flow], 'missing'), []);
  assert.equal(sourceNodeForProjection(flow, 'a').sourceNodeId, 'source-a');
  assert.equal(projectionNodeForSource(flow, 'artifact'), null);
  const projection = flowCanvasProjection(flow);
  assert.deepEqual([...projection.nodeSteps], [['a', 1], ['b', 3]]);
  assert.deepEqual([...projection.edgeIds], ['a-b']);
});
