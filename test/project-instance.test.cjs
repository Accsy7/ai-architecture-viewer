'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { migrateFile } = require('../schema/migrate-state.cjs');
const {
  ContractError,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  MAX_EDGE_COUNT,
  MAX_NODE_COUNT,
  SCHEMA_VERSION,
  diffGraphs,
  migrateLegacyState,
  revisionSummary,
  semanticProjectionFromCanonical,
  semanticProjectionFromLegacy,
  validateActionRequest,
  validateDraftRequest,
  validateGraph,
  validateRevisionRequest,
  validateState,
} = require('../schema/state-contract.cjs');
const {
  DOCUMENT_SCHEMA_VERSION,
  validateDocumentPath,
  validateRegistry,
  validateRegistryWriteRequest,
} = require('../schema/document-contract.cjs');
const {
  CATALOG_SCHEMA_VERSION,
  resolveArchitectureCatalog,
  validateArchitectureCatalog,
} = require('../schema/architecture-catalog-contract.cjs');
const { ANALYSIS_SCHEMA_VERSION, validateAnalysis } = require('../schema/analysis-contract.cjs');
const { LAYOUT_SCHEMA_VERSION, validateLayout } = require('../schema/viewer-layout-contract.cjs');

const ROOT = path.resolve(__dirname, '..');
const INSTANCE_ROOT = path.join(ROOT, 'projects', 'demo');
const LEGACY_STATE = path.join(__dirname, 'fixtures', 'generic-state-legacy.json');
const V2_STATE = path.join(__dirname, 'fixtures', 'generic-state-v2.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertContractError(fn, code, status) {
  assert.throws(fn, (error) => error instanceof ContractError
    && (!code || error.code === code)
    && (!status || error.status === status));
}

function noDraftLock(head, extra = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    expectedHeadRevision: head.revision,
    expectedHeadRevisionId: head.revisionId,
    expectedDraftId: null,
    expectedDraftRevision: 0,
    ...extra,
  };
}

function withAutoRouting(graph) {
  const result = structuredClone(graph);
  result.edges = result.edges.map((edge) => ({
    ...edge,
    data: { ...edge.data, routingMode: edge.data?.routingMode || 'auto' },
  }));
  return result;
}

function stripRouting(value) {
  const result = structuredClone(value);
  const visitGraph = (graph) => graph?.edges?.forEach((edge) => {
    delete edge.data.routingMode;
    delete edge.data.sourcePort;
    delete edge.data.targetPort;
    delete edge.data.waypoints;
  });
  ['current', 'target'].forEach((view) => {
    visitGraph(result[view].published.graph);
    visitGraph(result[view].draft?.graph);
    result[view].history.forEach((revision) => visitGraph(revision.graph));
  });
  return result;
}

test('legacy migration is deterministic, idempotent and preserves semantic content', () => {
  const legacy = readJson(LEGACY_STATE);
  const canonical = migrateLegacyState(legacy);
  assert.equal(canonical.schemaVersion, SCHEMA_VERSION);
  assert.equal(canonical.current.published.revision, 1);
  assert.equal(canonical.current.published.revisionId, 'current-r1');
  assert.equal(canonical.current.published.origin, 'migration');
  assert.equal(canonical.current.published.message, null);
  assert.equal(canonical.current.published.graph.nodes.length, 3);
  assert.equal(canonical.current.draft, null);
  assert.equal(canonical.target.published.revision, 0);
  assert.equal(canonical.target.published.revisionId, 'target-r0');
  assert.equal(canonical.target.published.graph.nodes.length, 0);
  assert.equal(canonical.target.draft.draftId, 'target-draft-migrated-r0');
  assert.equal(canonical.target.draft.draftRevision, 1);
  assert.equal(canonical.target.draft.graph.nodes.length, 3);
  assert.deepEqual(semanticProjectionFromCanonical(canonical), semanticProjectionFromLegacy(legacy));
  assert.deepEqual(migrateLegacyState(canonical), canonical);
  validateState(canonical);
});

test('2.0.0 migration preserves live draft identity data, timestamps, graphs and document refs', () => {
  const v2 = readJson(V2_STATE);
  v2.current.draft = {
    baseRevision: v2.current.published.revision,
    savedAt: '2026-07-11T23:49:30.807Z',
    graph: structuredClone(v2.current.published.graph),
  };
  v2.current.draft.graph.nodes[0].position = { x: -443.08, y: 219.34 };
  v2.current.draft.graph.nodes[0].width = 333;
  v2.current.draft.graph.nodes[0].data.documentRefs = ['slice-003-charter'];
  const beforeCurrentDraft = structuredClone(v2.current.draft);
  const beforeTargetDraft = structuredClone(v2.target.draft);
  const migrated = migrateLegacyState(v2);
  assert.equal(migrated.current.draft.savedAt, beforeCurrentDraft.savedAt);
  assert.deepEqual(migrated.current.draft.graph, withAutoRouting(beforeCurrentDraft.graph));
  assert.deepEqual(migrated.target.draft.graph, withAutoRouting(beforeTargetDraft.graph));
  assert.equal(migrated.target.draft.savedAt, beforeTargetDraft.savedAt);
  assert.equal(migrated.current.draft.baseRevisionId, migrated.current.published.revisionId);
  assert.deepEqual(migrateLegacyState(migrated), migrated);
});

test('3.0.0 migration adds automatic routing metadata without changing architecture, drafts or history', () => {
  const v3 = migrateLegacyState(readJson(V2_STATE));
  v3.schemaVersion = '3.0.0';
  const source = stripRouting(v3);
  const before = structuredClone(source);
  before.schemaVersion = SCHEMA_VERSION;
  const migrated = migrateLegacyState(source);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(stripRouting(migrated), before);
  for (const view of ['current', 'target']) {
    const graphs = [
      migrated[view].published.graph,
      migrated[view].draft?.graph,
      ...migrated[view].history.map((revision) => revision.graph),
    ].filter(Boolean);
    graphs.forEach((graph) => graph.edges.forEach((edge) => assert.equal(edge.data.routingMode, 'auto')));
  }
  assert.deepEqual(migrateLegacyState(migrated), migrated);
});

test('file migration writes only the isolated output and is idempotent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-state-migration-'));
  try {
    const input = path.join(directory, 'input.json');
    const output = path.join(directory, 'output.json');
    fs.copyFileSync(V2_STATE, input);
    const before = readJson(input);
    const first = migrateFile(input, output);
    assert.equal(first.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(first.current.published.graph, withAutoRouting(before.current.published.graph));
    assert.deepEqual(first.target.draft.graph, withAutoRouting(before.target.draft.graph));
    const second = migrateFile(output, output);
    assert.deepEqual(second, first);
    assert.deepEqual(readJson(input), before);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('migration separates React Flow layout from semantic node data', () => {
  const legacy = readJson(LEGACY_STATE);
  const node = migrateLegacyState(legacy).current.published.graph.nodes[0];
  const legacyNode = legacy.current.published.nodes[0];
  assert.equal(node.id, legacyNode.id);
  assert.deepEqual(node.position, {
    x: Number((legacyNode.x * 10 - DEFAULT_NODE_WIDTH / 2).toFixed(3)),
    y: Number((legacyNode.y - DEFAULT_NODE_HEIGHT / 2).toFixed(3)),
  });
  assert.equal(node.width, DEFAULT_NODE_WIDTH);
  assert.equal(node.height, DEFAULT_NODE_HEIGHT);
  assert.equal(node.data.name, legacyNode.name);
  assert.equal('x' in node.data, false);
  assert.equal('technical' in node, false);
});

test('migration maps legacy relation style without losing controlled boundary meaning', () => {
  const edges = new Map(migrateLegacyState(readJson(LEGACY_STATE)).current.published.graph.edges.map((edge) => [edge.id, edge]));
  assert.equal(edges.get('edge-input-processing').data.relationType, 'support');
  assert.equal(edges.get('edge-input-processing').data.controlledBoundaryPosture, 'none');
  assert.equal(edges.get('edge-processing-output').data.relationType, 'flow');
  assert.equal(edges.get('edge-processing-output').data.controlledBoundaryPosture, 'blocked');
});

test('state validator rejects schema drift, duplicate version identities and broken lineage', () => {
  const canonical = migrateLegacyState(readJson(LEGACY_STATE));
  const wrongVersion = structuredClone(canonical);
  wrongVersion.schemaVersion = '2.0.0';
  assertContractError(() => validateState(wrongVersion), 'SCHEMA_VERSION_MISMATCH', 409);

  const duplicateId = structuredClone(canonical);
  duplicateId.target.published.revisionId = duplicateId.current.published.revisionId;
  duplicateId.target.draft.baseRevisionId = duplicateId.current.published.revisionId;
  // IDs are lane-local, so cross-lane equality remains valid.
  validateState(duplicateId);

  const brokenParent = structuredClone(canonical);
  brokenParent.current.published.parentRevisionId = 'missing-revision';
  assertContractError(() => validateState(brokenParent));

  const duplicateRevision = structuredClone(canonical);
  duplicateRevision.current.history.push(structuredClone(duplicateRevision.current.published));
  assertContractError(() => validateState(duplicateRevision));

  const futureParent = structuredClone(canonical);
  futureParent.current.history.push({
    ...structuredClone(futureParent.current.published),
    revision: 0,
    revisionId: 'current-r0',
    parentRevisionId: 'current-r1',
    publishedAt: null,
    publishedBy: null,
    graph: { nodes: [], edges: [] },
  });
  futureParent.current.history.sort((left, right) => left.revision - right.revision);
  assertContractError(() => validateState(futureParent));
});

test('graph validator rejects duplicate nodes, missing edge references and missing target horizon', () => {
  const canonical = migrateLegacyState(readJson(LEGACY_STATE));
  const duplicate = structuredClone(canonical.current.published.graph);
  duplicate.nodes[1].id = duplicate.nodes[0].id;
  assertContractError(() => validateGraph(duplicate, 'current'));
  const brokenReference = structuredClone(canonical.current.published.graph);
  brokenReference.edges[0].source = 'missing-node';
  assertContractError(() => validateGraph(brokenReference, 'current'));
  const missingHorizon = structuredClone(canonical.target.draft.graph);
  delete missingHorizon.nodes[0].data.horizon;
  assertContractError(() => validateGraph(missingHorizon, 'target'));
});

test('routing contract accepts locked four-direction ports and bounded waypoints, and rejects ambiguous state', () => {
  const canonical = migrateLegacyState(readJson(LEGACY_STATE));
  const graph = structuredClone(canonical.current.published.graph);
  graph.edges[0].data = {
    ...graph.edges[0].data,
    routingMode: 'manual',
    sourcePort: 'bottom',
    targetPort: 'top',
    waypoints: [{ x: 425.5, y: 780 }, { x: 910, y: 780 }],
  };
  validateGraph(graph, 'current');

  const invalidPort = structuredClone(graph);
  invalidPort.edges[0].data.sourcePort = 'center';
  assertContractError(() => validateGraph(invalidPort, 'current'));

  const ambiguousAuto = structuredClone(graph);
  ambiguousAuto.edges[0].data.routingMode = 'auto';
  assertContractError(() => validateGraph(ambiguousAuto, 'current'));

  const tooMany = structuredClone(graph);
  tooMany.edges[0].data.waypoints = Array.from({ length: 25 }, (_, index) => ({ x: index, y: index }));
  assertContractError(() => validateGraph(tooMany, 'current'));
});

test('smart route changes automatic ports after a card moves, avoids blockers and respects manual locks', async () => {
  const {
    buildOrthogonalRoute,
    obstacleBounds,
    portPoint,
    resolveEdgePorts,
    routeIsOrthogonal,
  } = await import('../src/routing.mjs');
  const source = { id: 'source', position: { x: 0, y: 120 }, width: 120, height: 80 };
  const blocker = { id: 'blocker', position: { x: 210, y: 100 }, width: 150, height: 120 };
  const target = { id: 'target', position: { x: 470, y: 120 }, width: 120, height: 80 };
  const edge = { source: 'source', target: 'target', data: { routingMode: 'auto' } };
  const horizontal = resolveEdgePorts([source, blocker, target], edge);
  assert.deepEqual(horizontal, { sourcePort: 'right', targetPort: 'left', routingMode: 'auto' });
  const route = buildOrthogonalRoute({
    source: portPoint(source, horizontal.sourcePort),
    target: portPoint(target, horizontal.targetPort),
    sourcePort: horizontal.sourcePort,
    targetPort: horizontal.targetPort,
    obstacles: obstacleBounds([source, blocker, target], ['source', 'target']),
  });
  assert.equal(routeIsOrthogonal(route.points), true);
  assert.equal(route.obstacleHits, 0);
  assert.ok(route.points.length >= 4);

  const movedTarget = { ...target, position: { x: 0, y: -260 } };
  const vertical = resolveEdgePorts([source, blocker, movedTarget], edge);
  assert.deepEqual(vertical, { sourcePort: 'top', targetPort: 'bottom', routingMode: 'auto' });

  const locked = resolveEdgePorts([source, blocker, movedTarget], {
    ...edge,
    data: { routingMode: 'manual', sourcePort: 'left', targetPort: 'right' },
  });
  assert.deepEqual(locked, { sourcePort: 'left', targetPort: 'right', routingMode: 'manual' });
});

test('locked draft request requires both head identity and exact draft lock', () => {
  const canonical = migrateLegacyState(readJson(LEGACY_STATE));
  const request = noDraftLock(canonical.current.published, { graph: canonical.current.published.graph });
  validateDraftRequest(request, 'current');
  assertContractError(() => validateDraftRequest({ ...request, expectedDraftRevision: 1 }, 'current'));
  assertContractError(() => validateDraftRequest({ ...request, expectedHeadRevisionId: 'INVALID ID' }, 'current'));
  assertContractError(() => validateDraftRequest({ ...request, baseRevision: 1 }, 'current'));
  validateRevisionRequest(noDraftLock(canonical.current.published));
});

test('publish and restore action validators require message and explicit confirmation', () => {
  const head = migrateLegacyState(readJson(LEGACY_STATE)).current.published;
  const valid = noDraftLock(head, { message: '发布布局修订', userConfirmed: true });
  validateActionRequest(valid);
  assertContractError(() => validateActionRequest({ ...valid, message: '  ' }));
  assertContractError(() => validateActionRequest({ ...valid, userConfirmed: false }), 'USER_CONFIRMATION_REQUIRED', 403);
  validateActionRequest({ ...valid, sourceRevisionId: head.revisionId }, { restore: true });
  assertContractError(() => validateActionRequest(valid, { restore: true }));
});

test('diff categorizes structural, layout, document, semantic and relationship changes separately', () => {
  const before = migrateLegacyState(readJson(LEGACY_STATE)).current.published.graph;
  const after = structuredClone(before);
  after.nodes[0].position.x += 10;
  after.nodes[1].data.documentRefs = ['slice-003-charter'];
  after.nodes[1].data.purpose = '修订后的用途';
  after.nodes.pop();
  after.edges = after.edges.filter((edge) => after.nodes.some((node) => node.id === edge.source) && after.nodes.some((node) => node.id === edge.target));
  after.edges[0].data.label = '修订关系';
  const diff = diffGraphs(before, after);
  assert.equal(diff.summary.layout, 1);
  assert.equal(diff.summary.document, 1);
  assert.equal(diff.summary.semantic, 1);
  assert.ok(diff.summary.structural >= 1);
  assert.ok(diff.summary.relationship >= 1);
  assert.deepEqual(diff.categories.document.changed[0].added, ['slice-003-charter']);
});

test('diff keeps bindings on inserted and removed cards in the document category', () => {
  const before = migrateLegacyState(readJson(LEGACY_STATE)).current.published.graph;
  const after = structuredClone(before);
  const inserted = structuredClone(after.nodes[0]);
  inserted.id = 'inserted-with-doc';
  inserted.data.documentRefs = ['slice-003-charter'];
  after.nodes.push(inserted);
  const added = diffGraphs(before, after);
  assert.equal(added.summary.structural, 1);
  assert.equal(added.summary.document, 1);
  assert.deepEqual(added.categories.document.changed[0], {
    nodeId: 'inserted-with-doc',
    added: ['slice-003-charter'],
    removed: [],
  });
  const removed = diffGraphs(after, before);
  assert.equal(removed.summary.structural, 1);
  assert.equal(removed.summary.document, 1);
  assert.deepEqual(removed.categories.document.changed[0].removed, ['slice-003-charter']);
});

test('revision summaries omit graphs while retaining traceability and counts', () => {
  const revision = migrateLegacyState(readJson(LEGACY_STATE)).current.published;
  const summary = revisionSummary(revision, { isHead: true });
  assert.equal(summary.revisionId, revision.revisionId);
  assert.equal(summary.nodeCount, 3);
  assert.equal(summary.edgeCount, 2);
  assert.equal(summary.isHead, true);
  assert.equal('graph' in summary, false);
});

test('schema safety limits stay above the visual readability target', () => {
  const schema = readJson(path.join(ROOT, 'schema', 'architecture-state.schema.json'));
  assert.equal(schema.properties.schemaVersion.const, SCHEMA_VERSION);
  assert.equal(schema.$defs.graph.properties.nodes.maxItems, MAX_NODE_COUNT);
  assert.equal(schema.$defs.graph.properties.edges.maxItems, MAX_EDGE_COUNT);
  assert.ok(MAX_NODE_COUNT > 12);
});

test('document registry contract is independent, strict and contains no reverse module list', () => {
  const registry = readJson(path.join(INSTANCE_ROOT, 'document-registry.json'));
  validateRegistry(registry);
  assert.equal(registry.schemaVersion, DOCUMENT_SCHEMA_VERSION);
  assert.equal(registry.documents.length, 3);
  assert.deepEqual(registry.documents.map((document) => document.id).sort(), [
    'evaluation-proposal',
    'retrieval-design',
    'system-brief',
  ]);
  registry.documents.forEach((document) => {
    assert.equal('moduleIds' in document, false);
    assert.equal('bindings' in document, false);
  });
  validateRegistryWriteRequest({
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    baseRevision: registry.baseRevision,
    document: registry.documents[0],
  });
});

test('document path contract rejects traversal, absolute, UNC, backslash, non-Markdown and empty segments', () => {
  assert.equal(validateDocumentPath('docs/example.md'), 'docs/example.md');
  for (const unsafe of ['../secret.md', 'C:/secret.md', '//server/share/a.md', 'docs\\a.md', 'docs/a.txt', 'docs//a.md', './docs/a.md']) {
    assertContractError(() => validateDocumentPath(unsafe), 'DOCUMENT_PATH_INVALID');
  }
});

test('migration layout keeps current and target cards from overlapping', () => {
  const canonical = migrateLegacyState(readJson(LEGACY_STATE));
  const overlaps = (nodes) => {
    const collisions = [];
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const a = nodes[left];
        const b = nodes[right];
        const separated = a.position.x + a.width <= b.position.x
          || b.position.x + b.width <= a.position.x
          || a.position.y + a.height <= b.position.y
          || b.position.y + b.height <= a.position.y;
        if (!separated) collisions.push(`${a.id}/${b.id}`);
      }
    }
    return collisions;
  };
  assert.deepEqual(overlaps(canonical.current.published.graph.nodes), []);
  assert.deepEqual(overlaps(canonical.target.draft.graph.nodes), []);
});

test('architecture catalog keeps diagrams isolated with safe local state and layout paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-catalog-'));
  const catalogFile = path.join(root, 'architecture-catalog.json');
  const raw = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    defaultDiagramId: 'product-overview',
    diagrams: [
      {
        id: 'product-overview',
        title: '产品总览',
        description: '顶层产品模块',
        viewpoint: 'product',
        level: 'project',
        parentDiagramId: null,
        ownerNodeId: null,
        defaultFocusNodeId: 'command-home',
        navigation: {
          sectionId: 'product-l1',
          sectionLabel: '产品总览（L1）',
          sectionOrder: 10,
          label: '产品总览',
          order: 10,
          sectionRoot: true,
          menuVisible: true,
        },
        stateFile: 'diagrams/product.json',
        layoutFile: 'diagrams/product-layout.json',
      },
      {
        id: 'event-mainline',
        title: '事件主线',
        description: '业务—财务事件关系',
        viewpoint: 'business-flow',
        level: 'project',
        parentDiagramId: null,
        ownerNodeId: null,
        defaultFocusNodeId: 'event-routing',
        stateFile: 'state.json',
        layoutFile: 'viewer-layout.json',
      },
    ],
  };
  const validated = validateArchitectureCatalog(raw);
  assert.equal(validated.diagrams.length, 2);
  const resolved = resolveArchitectureCatalog(raw, catalogFile);
  assert.equal(resolved.defaultDiagramId, 'product-overview');
  assert.equal(resolved.diagrams[0].navigation.sectionLabel, '产品总览（L1）');
  assert.equal(resolved.diagrams[1].navigation, null);
  assert.equal(resolved.diagrams[0].statePath, path.join(root, 'diagrams', 'product.json'));
  assert.equal(resolved.diagrams[1].layoutPath, path.join(root, 'viewer-layout.json'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('architecture catalog rejects traversal, duplicate identities and cyclic hierarchy', () => {
  const base = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    defaultDiagramId: 'one',
    diagrams: [{
      id: 'one',
      title: 'One',
      description: 'One diagram',
      viewpoint: 'product',
      level: 'project',
      parentDiagramId: null,
      ownerNodeId: null,
      defaultFocusNodeId: null,
      stateFile: 'one.json',
      layoutFile: 'one-layout.json',
    }],
  };
  assertContractError(() => validateArchitectureCatalog({
    ...base,
    diagrams: [{ ...base.diagrams[0], stateFile: '../outside.json' }],
  }), 'ARCHITECTURE_CATALOG_INVALID', 500);
  assertContractError(() => validateArchitectureCatalog({
    ...base,
    diagrams: [{
      ...base.diagrams[0],
      navigation: {
        sectionId: 'missing-root',
        sectionLabel: '缺少根图',
        sectionOrder: 10,
        label: 'One',
        order: 10,
        sectionRoot: false,
        menuVisible: true,
      },
    }],
  }), 'ARCHITECTURE_CATALOG_INVALID', 500);
  assertContractError(() => validateArchitectureCatalog({
    ...base,
    diagrams: [base.diagrams[0], { ...base.diagrams[0] }],
  }), 'ARCHITECTURE_CATALOG_INVALID', 500);
  assertContractError(() => validateArchitectureCatalog({
    ...base,
    diagrams: [
      { ...base.diagrams[0], parentDiagramId: 'two', ownerNodeId: 'owner' },
      { ...base.diagrams[0], id: 'two', parentDiagramId: 'one', ownerNodeId: 'owner' },
    ],
  }), 'ARCHITECTURE_CATALOG_INVALID', 500);
});

test('public synthetic demo package keeps architecture, evidence, layouts, and review proposals coherent', () => {
  const demoRoot = INSTANCE_ROOT;
  const manifest = readJson(path.join(demoRoot, 'project.json'));
  assert.equal(manifest.id, 'demo');
  assert.equal(manifest.default, true);
  assert.equal(manifest.snapshot.classification, 'synthetic-public-demo');

  const registry = validateRegistry(readJson(path.join(demoRoot, 'document-registry.json')));
  const documentIds = new Set(registry.documents.map((document) => document.id));
  registry.documents.forEach((document) => {
    assert.ok(fs.existsSync(path.join(demoRoot, document.path)));
  });

  const catalog = validateArchitectureCatalog(readJson(path.join(demoRoot, 'architecture-catalog.json')));
  assert.equal(catalog.defaultDiagramId, 'system-overview');
  assert.deepEqual(catalog.diagrams.map((diagram) => diagram.id), ['system-overview', 'retrieval-flow']);

  const overview = catalog.diagrams.find((diagram) => diagram.id === 'system-overview');
  const retrievalFlow = catalog.diagrams.find((diagram) => diagram.id === 'retrieval-flow');
  assert.equal(overview.navigation.sectionRoot, true);
  assert.equal(retrievalFlow.parentDiagramId, overview.id);
  assert.equal(retrievalFlow.ownerNodeId, 'retrieval-service');
  assert.equal(retrievalFlow.navigation.sectionId, overview.navigation.sectionId);

  const validateDemoDiagram = (diagram) => {
    const state = validateState(readJson(path.join(demoRoot, diagram.stateFile)));
    const layout = validateLayout(readJson(path.join(demoRoot, diagram.layoutFile)));
    const graphByView = {
      current: state.current.published.graph,
      target: state.target.draft.graph,
    };

    Object.entries(graphByView).forEach(([view, graph]) => {
      graph.nodes.forEach((node) => {
        const position = layout.layouts[view].positions[node.id];
        assert.ok(position, `missing ${view} layout for ${node.id}`);
        assert.equal(Number.isFinite(position.x), true);
        assert.equal(Number.isFinite(position.y), true);
        (node.data.documentRefs || []).forEach((documentId) => assert.ok(documentIds.has(documentId)));
      });
    });

    state.meta.groups.forEach((group) => {
      assert.ok(layout.layouts.current.containers[group.id]);
      assert.ok(layout.layouts.target.containers[group.id]);
    });
    return state;
  };

  const overviewState = validateDemoDiagram(overview);
  assert.ok(overviewState.current.published.graph.nodes.some((node) => node.id === 'retrieval-service'));
  assert.equal(overviewState.current.published.graph.nodes.some((node) => node.id === 'evaluation-gate'), false);
  assert.ok(overviewState.target.draft.graph.nodes.some((node) => node.id === 'evaluation-gate'));
  const retrievalNode = overviewState.target.draft.graph.nodes.find((node) => node.id === 'retrieval-service');
  assert.equal(retrievalNode.data.relatedDiagramId, retrievalFlow.id);
  assert.equal(retrievalNode.data.relatedNodeId, 'retrieval-service');

  const retrievalState = validateDemoDiagram(retrievalFlow);
  assert.equal(retrievalState.current.published.graph.nodes.some((node) => node.id === 'citation-check'), false);
  assert.ok(retrievalState.target.draft.graph.nodes.some((node) => node.id === 'citation-check'));

  const analysis = validateAnalysis(readJson(path.join(demoRoot, 'analysis.json')));
  assert.equal(analysis.schemaVersion, ANALYSIS_SCHEMA_VERSION);
  assert.equal(analysis.baseRevision, 0);
  assert.equal(analysis.proposals.length, 1);
  const sourcesById = new Map(analysis.sources.map((source) => [source.id, source]));
  analysis.sources.forEach((source) => {
    assert.ok(documentIds.has(source.id));
    assert.equal(source.selected, true);
    assert.ok(source.lastScannedAt);
    const sourceFile = path.join(demoRoot, source.path);
    const content = fs.readFileSync(sourceFile);
    assert.equal(source.sizeBytes, content.length);
    assert.equal(source.contentHash, crypto.createHash('sha256').update(content).digest('hex'));
  });

  const evidenceIds = new Set(analysis.evidence.map((evidence) => evidence.id));
  analysis.evidence.forEach((evidence) => {
    const source = sourcesById.get(evidence.sourceId);
    assert.ok(source);
    assert.equal(evidence.path, source.path);
    assert.equal(evidence.contentHash, source.contentHash);
    assert.ok(evidence.lineStart > 0);
    assert.ok(evidence.lineEnd >= evidence.lineStart);
  });

  const proposal = analysis.proposals[0];
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.view, 'current');
  assert.equal(proposal.diagramId, overview.id);
  assert.equal(proposal.baseRevision, overviewState.current.published.revision);
  assert.equal(proposal.baseRevisionId, overviewState.current.published.revisionId);
  assert.equal(proposal.reviewedAt, null);
  assert.equal(proposal.application, null);
  assert.equal(proposal.confidence, 'high');
  proposal.evidenceIds.forEach((evidenceId) => assert.ok(evidenceIds.has(evidenceId)));

  const nodeChange = proposal.changes.find((change) => change.targetType === 'node' && change.targetId === 'evaluation-gate');
  assert.ok(nodeChange);
  assert.equal(nodeChange.kind, 'add');
  assert.deepEqual(Object.keys(nodeChange.patch), ['data']);
  assert.deepEqual(Object.keys(nodeChange.patch.data).sort(), [
    'aiCollaboration',
    'authorization',
    'name',
    'product',
    'purpose',
    'technical',
  ]);
  ['group', 'documentRefs', 'humanConfirmed', 'confirmationNote', 'confirmedAt'].forEach((field) => {
    assert.equal(field in nodeChange.patch.data, false);
  });

  const edgeChanges = proposal.changes.filter((change) => change.targetType === 'edge');
  assert.equal(edgeChanges.length, 2);
  edgeChanges.forEach((change) => {
    assert.equal(change.kind, 'add');
    assert.deepEqual(Object.keys(change.patch).sort(), ['data', 'source', 'target']);
    assert.deepEqual(Object.keys(change.patch.data).sort(), ['label', 'relationType']);
    assert.equal('routingMode' in change.patch.data, false);
    assert.equal('controlledBoundaryPosture' in change.patch.data, false);
    change.evidenceIds.forEach((evidenceId) => assert.ok(evidenceIds.has(evidenceId)));
  });

  const syntheticFiles = [
    'project.json',
    'viewer.config.json',
    'architecture-catalog.json',
    'state.json',
    'analysis.json',
    'README.md',
    ...registry.documents.map((document) => document.path),
  ];
  syntheticFiles.forEach((file) => {
    assert.match(fs.readFileSync(path.join(demoRoot, file), 'utf8'), /synthetic|fictional|public demo/i);
  });
});
