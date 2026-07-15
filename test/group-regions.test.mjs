import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGroupRegionNodes } from '../src/group-regions.mjs';

test('seven capability-domain groups render as usable region nodes behind stable group members', () => {
  const groups = Array.from({ length: 7 }, (_, index) => ({
    id: `domain-${index + 1}`,
    group: `Capability ${index + 1}`,
    label: `Domain ${index + 1}`,
    description: `Capability domain ${index + 1}`,
    level: 'L1',
    legacyMarker: `preserved-${index + 1}`,
  }));
  const semanticNodes = groups.map((group, index) => ({
    id: `node-${index + 1}`,
    type: 'architectureNode',
    position: { x: index * 420 + 40, y: 120 },
    width: 260,
    height: 150,
    data: { name: `Node ${index + 1}`, group: group.group },
  }));
  const containers = Object.fromEntries(groups.map((group, index) => [group.id, {
    x: index * 420,
    y: 20,
    width: 360,
    height: 420,
  }]));

  const regions = buildGroupRegionNodes({
    groups,
    semanticNodes,
    layout: { containers },
    preview: {},
    selectedRegionId: null,
    draggable: true,
    fallbackLabel: (index) => `Group ${index + 1}`,
    onResize: () => {},
    onResizeEnd: () => {},
  });

  assert.equal(regions.length, 7);
  regions.forEach((region, index) => {
    const expected = containers[groups[index].id];
    assert.equal(region.type, 'groupRegion');
    assert.deepEqual(region.position, { x: expected.x, y: expected.y });
    assert.equal(region.width, expected.width);
    assert.equal(region.height, expected.height);
    assert.equal(region.style.width, expected.width);
    assert.equal(region.style.height, expected.height);
    assert.equal(region.data.__group, groups[index].group);
    assert.equal(region.data.__groupId, groups[index].id);
    assert.equal(region.draggable, true);
    assert.equal(region.data.__resizable, true);
    assert.equal(region.zIndex, -1);
  });
});

test('region membership follows stable group data instead of card coordinates', () => {
  const groups = [{ id: 'domain-a', group: 'A', label: 'A' }, { id: 'domain-b', group: 'B', label: 'B' }];
  const semanticNodes = [
    { id: 'far-a', position: { x: 2000, y: 2000 }, width: 260, height: 150, data: { group: 'A' } },
    { id: 'near-b', position: { x: 5, y: 5 }, width: 260, height: 150, data: { group: 'B' } },
  ];
  const regions = buildGroupRegionNodes({
    groups,
    semanticNodes,
    layout: { containers: { 'domain-a': { x: 0, y: 0, width: 320, height: 240 }, 'domain-b': { x: 0, y: 0, width: 320, height: 240 } } },
  });

  assert.equal(regions.length, 2);
  assert.equal(regions.find((region) => region.data.__group === 'A').data.__minWidth > 2000, true);
  assert.equal(regions.find((region) => region.data.__group === 'B').data.__minWidth < 1000, true);
});
