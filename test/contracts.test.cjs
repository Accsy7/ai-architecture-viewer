'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ContractError,
  SCHEMA_VERSION,
  diffGraphs,
  migrateLegacyState,
  revisionSummary,
  semanticProjectionFromCanonical,
  semanticProjectionFromLegacy,
  validateDraftRequest,
  validateGraph,
  validateState,
} = require('../schema/state-contract.cjs');
const {
  DOCUMENT_SCHEMA_VERSION,
  validateDocumentPath,
  validateRegistry,
} = require('../schema/document-contract.cjs');
const {
  CATALOG_SCHEMA_VERSION,
  resolveArchitectureCatalog,
  validateArchitectureCatalog,
} = require('../schema/architecture-catalog-contract.cjs');
const {
  LAYOUT_SCHEMA_VERSION,
  LayoutContractError,
  createInitialLayout,
  mergeLayout,
  validateLayout,
} = require('../schema/viewer-layout-contract.cjs');
const { resolveProjectDirectory } = require('../server.js');

const FIXTURES = path.join(__dirname, 'fixtures');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function contractError(fn, code) {
  assert.throws(fn, (error) => error instanceof ContractError && (!code || error.code === code));
}

test('legacy state migration is deterministic, semantic-preserving and idempotent', () => {
  const legacy = readJson(path.join(FIXTURES, 'generic-state-legacy.json'));
  const canonical = migrateLegacyState(legacy);
  assert.equal(canonical.schemaVersion, SCHEMA_VERSION);
  assert.equal(canonical.current.published.revisionId, 'current-r1');
  assert.equal(canonical.current.published.graph.nodes.length, 3);
  assert.equal(canonical.target.published.revisionId, 'target-r0');
  assert.equal(canonical.target.draft.graph.nodes.length, 3);
  assert.deepEqual(semanticProjectionFromCanonical(canonical), semanticProjectionFromLegacy(legacy));
  assert.ok(canonical.current.published.graph.edges.every((edge) => edge.data.routingMode === 'auto'));
  assert.deepEqual(migrateLegacyState(canonical), canonical);
  validateState(canonical);
});
test('previous canonical state gains routing metadata without changing semantic data', () => {
  const previous = readJson(path.join(FIXTURES, 'generic-state-v2.json'));
  const migrated = migrateLegacyState(previous);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.current.published.graph.nodes[0].data.name, previous.current.published.graph.nodes[0].data.name);
  assert.ok(migrated.current.published.graph.edges.every((edge) => edge.data.routingMode === 'auto'));
  assert.ok(migrated.target.draft.graph.edges.every((edge) => edge.data.routingMode === 'auto'));
  validateState(migrated);
});

test('state 3.2 interaction modes and architecture layers migrate without semantic loss', () => {
  const previous = migrateLegacyState(readJson(path.join(FIXTURES, 'generic-state-legacy.json')));
  previous.schemaVersion = '3.2.0';
  for (const view of ['current', 'target']) {
    for (const revision of [...previous[view].history, previous[view].published]) delete revision.developmentContract;
    if (previous[view].draft) delete previous[view].draft.developmentContract;
  }
  previous.current.published.graph.nodes[0].data.interactionModes = ['human-ui', 'system-service'];
  previous.current.published.graph.nodes[0].data.architectureLayer = 'application-layer';
  const migrated = migrateLegacyState(previous);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.current.published.graph.nodes[0].data.interactionModes, ['human-ui', 'system-service']);
  assert.equal(migrated.current.published.graph.nodes[0].data.architectureLayer, 'application-layer');
  assert.equal(migrated.target.published.developmentContract.status, 'legacy-unbound');
  assert.equal(migrated.target.published.developmentContract.target.semanticHash, null);
});

test('state and graph contracts reject drift, duplicate identities and invalid target data', () => {
  const canonical = migrateLegacyState(readJson(path.join(FIXTURES, 'generic-state-legacy.json')));
  const wrongVersion = structuredClone(canonical);
  wrongVersion.schemaVersion = '0.0.0';
  contractError(() => validateState(wrongVersion), 'SCHEMA_VERSION_MISMATCH');

  const duplicate = structuredClone(canonical.current.published.graph);
  duplicate.nodes[1].id = duplicate.nodes[0].id;
  contractError(() => validateGraph(duplicate, 'current'));

  const brokenEdge = structuredClone(canonical.current.published.graph);
  brokenEdge.edges[0].target = 'missing-module';
  contractError(() => validateGraph(brokenEdge, 'current'));

  const missingHorizon = structuredClone(canonical.target.draft.graph);
  delete missingHorizon.nodes[0].data.horizon;
  contractError(() => validateGraph(missingHorizon, 'target'));
});

test('manual routing accepts four-direction ports and bounded waypoints', () => {
  const graph = migrateLegacyState(readJson(path.join(FIXTURES, 'generic-state-legacy.json'))).current.published.graph;
  const manual = structuredClone(graph);
  manual.edges[0].data = {
    ...manual.edges[0].data,
    routingMode: 'manual',
    sourcePort: 'bottom',
    targetPort: 'top',
    waypoints: [{ x: 250, y: 320 }, { x: 520, y: 320 }],
  };
  validateGraph(manual, 'current');
  const invalid = structuredClone(manual);
  invalid.edges[0].data.sourcePort = 'center';
  contractError(() => validateGraph(invalid, 'current'));

  const head = migrateLegacyState(readJson(path.join(FIXTURES, 'generic-state-legacy.json'))).current.published;
  validateDraftRequest({
    schemaVersion: SCHEMA_VERSION,
    expectedHeadRevision: head.revision,
    expectedHeadRevisionId: head.revisionId,
    expectedDraftId: null,
    expectedDraftRevision: 0,
    graph,
  }, 'current');
});

test('automatic routing changes ports after movement and avoids a blocker', async () => {
  const { buildOrthogonalRoute, obstacleBounds, portPoint, resolveEdgePorts, routeIsOrthogonal } = await import('../src/routing.mjs');
  const source = { id: 'source', position: { x: 0, y: 120 }, width: 120, height: 80 };
  const blocker = { id: 'blocker', position: { x: 210, y: 100 }, width: 150, height: 120 };
  const target = { id: 'target', position: { x: 470, y: 120 }, width: 120, height: 80 };
  const ports = resolveEdgePorts([source, blocker, target], {
    source: 'source',
    target: 'target',
    data: { routingMode: 'auto' },
  });
  assert.deepEqual(ports, { sourcePort: 'right', targetPort: 'left', routingMode: 'auto' });
  const route = buildOrthogonalRoute({
    source: portPoint(source, ports.sourcePort),
    target: portPoint(target, ports.targetPort),
    sourcePort: ports.sourcePort,
    targetPort: ports.targetPort,
    obstacles: obstacleBounds([source, blocker, target], ['source', 'target']),
  });
  assert.equal(routeIsOrthogonal(route.points), true);
  assert.equal(route.obstacleHits, 0);
});

test('diff and revision summaries keep categories and omit full graphs', () => {
  const before = migrateLegacyState(readJson(path.join(FIXTURES, 'generic-state-legacy.json'))).current.published.graph;
  const after = structuredClone(before);
  after.nodes[0].position.x += 20;
  after.nodes[1].data.documentRefs = ['alpha-doc'];
  after.nodes[2].data.purpose = '更新后的输出用途。';
  after.edges[0].data.label = '更新后的输入关系';
  const diff = diffGraphs(before, after);
  assert.deepEqual(diff.summary, { structural: 0, layout: 1, document: 1, semantic: 1, relationship: 1 });
  const revision = migrateLegacyState(readJson(path.join(FIXTURES, 'generic-state-legacy.json'))).current.published;
  const summary = revisionSummary(revision, { isHead: true });
  assert.equal(summary.nodeCount, 3);
  assert.equal(summary.edgeCount, 2);
  assert.equal(summary.isHead, true);
  assert.equal('graph' in summary, false);
});

test('document registry and paths are strict and project-relative', () => {
  const registry = readJson(path.join(FIXTURES, 'generic-document-registry.json'));
  validateRegistry(registry);
  assert.equal(registry.schemaVersion, DOCUMENT_SCHEMA_VERSION);
  assert.equal(validateDocumentPath('documents/example.md'), 'documents/example.md');
  for (const unsafe of ['../secret.md', 'C:/secret.md', '//server/share/a.md', 'documents\\a.md', 'documents/a.txt']) {
    contractError(() => validateDocumentPath(unsafe), 'DOCUMENT_PATH_INVALID');
  }
});

test('architecture catalog resolves files within its own project directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-catalog-'));
  try {
    const raw = {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      defaultDiagramId: 'overview',
      diagrams: [{
        id: 'overview',
        title: '总览',
        description: '通用总览图',
        viewpoint: 'product',
        level: 'project',
        parentDiagramId: null,
        ownerNodeId: null,
        defaultFocusNodeId: null,
        navigation: {
          sectionId: 'overview-level',
          sectionLabel: '总览层',
          sectionOrder: 10,
          label: '总览',
          order: 10,
          sectionRoot: true,
          menuVisible: true,
        },
        stateFile: 'diagrams/overview.json',
        layoutFile: 'diagrams/overview-layout.json',
      }],
    };
    validateArchitectureCatalog(raw);
    const resolved = resolveArchitectureCatalog(raw, path.join(root, 'architecture-catalog.json'));
    assert.equal(resolved.diagrams[0].statePath, path.join(root, 'diagrams', 'overview.json'));
    contractError(() => validateArchitectureCatalog({
      ...raw,
      diagrams: [{ ...raw.diagrams[0], stateFile: '../outside.json' }],
    }), 'ARCHITECTURE_CATALOG_INVALID');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('layout contract derives and guards generic group containers', () => {
  const state = migrateLegacyState(readJson(path.join(FIXTURES, 'generic-state-legacy.json')));
  state.meta.groups = [{
    id: 'input-group',
    group: '输入',
    label: '输入',
    position: { x: -20, y: 20 },
    width: 340,
    height: 320,
  }];
  const layout = createInitialLayout(state, '2026-07-13T00:00:00.000Z');
  assert.equal(layout.schemaVersion, LAYOUT_SCHEMA_VERSION);
  assert.deepEqual(layout.layouts.current.containers['input-group'], { x: -20, y: 20, width: 340, height: 320 });
  validateLayout(layout);
  const merged = mergeLayout(layout, state, 'current', {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    expectedRevision: 0,
    positions: { 'input-module': { x: 50, y: 60 } },
    containers: { 'input-group': { x: 0, y: 10, width: 360, height: 340 } },
  });
  assert.deepEqual(merged.layouts.current.positions['input-module'], { x: 50, y: 60 });
  assert.throws(() => mergeLayout(layout, state, 'current', {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    expectedRevision: 0,
    positions: {},
    containers: { missing: { x: 0, y: 0, width: 320, height: 240 } },
  }), (error) => error instanceof LayoutContractError && error.code === 'UNKNOWN_LAYOUT_CONTAINER');
});

test('canonical reads preserve groups and safely expose legacy capability domains as groups', () => {
  const canonical = migrateLegacyState(readJson(path.join(FIXTURES, 'generic-state-legacy.json')));
  delete canonical.meta.groups;
  canonical.meta.capabilityDomains = Array.from({ length: 7 }, (_, index) => ({
    id: `domain-${index + 1}`,
    group: `Capability ${index + 1}`,
    label: `Domain ${index + 1}`,
    description: `Legacy capability domain ${index + 1}`,
    position: { x: index * 400, y: 20 },
    width: 360,
    height: 420,
    legacyMarker: `keep-${index + 1}`,
  }));

  const migrated = migrateLegacyState(canonical);
  assert.deepEqual(migrated.meta.groups, canonical.meta.capabilityDomains);
  assert.deepEqual(migrated.meta.capabilityDomains, canonical.meta.capabilityDomains);
  assert.notEqual(migrated.meta.groups, migrated.meta.capabilityDomains);
  assert.equal(migrated.meta.groups.length, 7);
  assert.equal(migrated.meta.groups[4].legacyMarker, 'keep-5');
  assert.equal(canonical.meta.groups, undefined, 'reading compatibility must not mutate the source object');

  const explicit = structuredClone(canonical);
  explicit.meta.groups = [];
  assert.deepEqual(migrateLegacyState(explicit).meta.groups, [], 'an explicit canonical groups array always wins');
});

test('an explicitly selected project directory is resolved without global state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-project-'));
  try {
    assert.equal(resolveProjectDirectory(root), path.resolve(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
