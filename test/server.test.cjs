'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createServer,
  SCHEMA_VERSION,
  readState,
  resolveSafeDocument,
} = require('../server.js');
const { DOCUMENT_SCHEMA_VERSION } = require('../schema/document-contract.cjs');

const V2_STATE = path.join(__dirname, 'fixtures', 'generic-state-v2.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withAutoRouting(graph) {
  const result = clone(graph);
  result.edges = result.edges.map((edge) => ({
    ...edge,
    data: { ...edge.data, routingMode: edge.data?.routingMode || 'auto' },
  }));
  return result;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function activeDocument(overrides = {}) {
  return {
    id: 'alpha-doc',
    title: 'Alpha 文档',
    type: 'technical_spec',
    status: 'active',
    authority: 'supporting',
    path: 'docs/alpha.md',
    summary: '测试文档元数据，不包含正文。',
    supersedes: null,
    lastVerifiedAt: new Date(Date.now() + 60000).toISOString(),
    ...overrides,
  };
}

function createFixture() {
  const commandRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-viewer-server-'));
  const stateFile = path.join(commandRoot, 'state.json');
  const documentsFile = path.join(commandRoot, 'document-registry.json');
  const layoutFile = path.join(commandRoot, 'viewer-layout.json');
  const configFile = path.join(commandRoot, 'viewer.config.json');
  const staticRoot = path.join(commandRoot, 'dist');
  fs.mkdirSync(path.join(commandRoot, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(staticRoot, 'assets'), { recursive: true });
  fs.copyFileSync(V2_STATE, stateFile);
  fs.writeFileSync(path.join(commandRoot, 'docs', 'alpha.md'), '# Alpha\n\n公开摘要。\n\n## Details\n\n<section>按纯文本预览。</section>\n', 'utf8');
  fs.writeFileSync(path.join(commandRoot, 'docs', 'large.md'), `# Large\n\n${'内容'.repeat(20000)}`, 'utf8');
  fs.writeFileSync(path.join(commandRoot, 'docs', 'new.md'), '# New\n', 'utf8');
  fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><div id="root"></div>', 'utf8');
  fs.writeFileSync(path.join(staticRoot, 'assets', 'app.js'), 'globalThis.__local = true;', 'utf8');
  writeJson(documentsFile, {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    baseRevision: 1,
    lastUpdated: new Date().toISOString(),
    documents: [
      activeDocument(),
      activeDocument({
        id: 'large-doc',
        title: '大文档',
        path: 'docs/large.md',
        type: 'other',
      }),
    ],
  });
  writeJson(configFile, {
    schemaVersion: '1.0.0',
    projectId: 'fixture-project',
    projectName: 'Fixture Project',
    viewerName: 'AI 架构查看器',
    eyebrow: 'FIXTURE ARCHITECTURE',
    scopeNote: '用于验证通用项目配置与独立排版。',
    defaultFocusNodeId: null,
    views: {
      current: { label: '当前架构', description: '当前结构' },
      target: { label: '目标架构', description: '目标结构' },
      compare: { label: '差异对比', description: '差异结构' },
    },
    nodeFields: [
      { key: 'purpose', label: '主要作用', multiline: true },
    ],
  });
  return { commandRoot, projectRoot: commandRoot, stateFile, documentsFile, layoutFile, configFile, staticRoot };
}

async function startFixture(t) {
  const fixture = createFixture();
  const server = createServer(fixture);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(() => {
    fs.rmSync(fixture.commandRoot, { recursive: true, force: true });
    resolve();
  })));
  return { ...fixture, server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function startCatalogFixture(t) {
  const fixture = createFixture();
  const diagramsRoot = path.join(fixture.commandRoot, 'diagrams');
  const productStateFile = path.join(diagramsRoot, 'product.json');
  const productLayoutFile = path.join(diagramsRoot, 'product-layout.json');
  const catalogFile = path.join(fixture.commandRoot, 'architecture-catalog.json');
  fs.mkdirSync(diagramsRoot, { recursive: true });
  const productState = JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8'));
  productState.meta = { ...productState.meta, title: 'Product Fixture' };
  writeJson(productStateFile, productState);
  writeJson(catalogFile, {
    schemaVersion: '1.0.0',
    defaultDiagramId: 'product-overview',
    diagrams: [
      {
        id: 'product-overview',
        title: '产品总览',
        description: 'Fixture 产品总览',
        viewpoint: 'product',
        level: 'project',
        parentDiagramId: null,
        ownerNodeId: null,
        defaultFocusNodeId: null,
        stateFile: 'diagrams/product.json',
        layoutFile: 'diagrams/product-layout.json',
      },
      {
        id: 'event-mainline',
        title: '事件主线',
        description: 'Fixture 事件主线',
        viewpoint: 'business-flow',
        level: 'project',
        parentDiagramId: null,
        ownerNodeId: null,
        defaultFocusNodeId: null,
        stateFile: 'state.json',
        layoutFile: 'viewer-layout.json',
      },
    ],
  });
  const server = createServer({ ...fixture, catalogFile });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(() => {
    fs.rmSync(fixture.commandRoot, { recursive: true, force: true });
    resolve();
  })));
  return {
    ...fixture,
    catalogFile,
    productStateFile,
    productLayoutFile,
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
  });
  const payload = await response.json();
  return { response, payload };
}

function body(value) {
  return JSON.stringify(value);
}

function lockFrom(responseState) {
  return {
    schemaVersion: SCHEMA_VERSION,
    expectedHeadRevision: responseState.published.revision,
    expectedHeadRevisionId: responseState.published.revisionId,
    expectedDraftId: responseState.draft ? responseState.draft.draftId : null,
    expectedDraftRevision: responseState.draft ? responseState.draft.draftRevision : 0,
  };
}

async function getState(baseUrl, view = 'current') {
  const result = await request(baseUrl, `/api/state?view=${view}`);
  assert.equal(result.response.status, 200);
  return result.payload;
}

async function saveDraft(baseUrl, state, graph, view = state.view) {
  return request(baseUrl, `/api/draft?view=${view}`, {
    method: 'PUT',
    body: body({ ...lockFrom(state), graph }),
  });
}

async function publish(baseUrl, state, message = '用户确认发布', view = state.view) {
  return request(baseUrl, `/api/publish?view=${view}`, {
    method: 'POST',
    body: body({ ...lockFrom(state), message, userConfirmed: true }),
  });
}

test('state API explicitly selects a lane, migrates 2.0 losslessly and returns historyCount only', async (t) => {
  const fixture = await startFixture(t);
  const before = JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8'));
  const missingView = await request(fixture.baseUrl, '/api/state');
  assert.equal(missingView.response.status, 400);
  assert.equal(missingView.payload.code, 'INVALID_VIEW');
  const current = await getState(fixture.baseUrl, 'current');
  assert.equal(current.schemaVersion, SCHEMA_VERSION);
  assert.equal(current.published.revisionId, 'current-r1');
  assert.equal(current.historyCount, 0);
  assert.equal('history' in current, false);
  assert.deepEqual(current.published.graph, withAutoRouting(before.current.published.graph));
  const target = await getState(fixture.baseUrl, 'target');
  assert.equal(target.published.revisionId, 'target-r0');
  assert.deepEqual(target.draft.graph, withAutoRouting(before.target.draft.graph));
  assert.equal(target.draft.savedAt, before.target.draft.savedAt);
  assert.deepEqual(readState(fixture.stateFile), JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8')));
});

test('generic project config and viewer layout are independent from architecture semantics', async (t) => {
  const fixture = await startFixture(t);
  const stateWithGroup = JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8'));
  stateWithGroup.meta = {
    ...(stateWithGroup.meta || {}),
    groups: [{
      id: 'fixture-group',
      group: 'Fixture Group',
      label: 'Fixture Group',
      position: { x: 0, y: 0 },
      width: 420,
      height: 360,
    }],
  };
  writeJson(fixture.stateFile, stateWithGroup);
  const config = await request(fixture.baseUrl, '/api/config');
  assert.equal(config.response.status, 200);
  assert.equal(config.payload.projectId, 'fixture-project');
  assert.equal(config.payload.projectName, 'Fixture Project');
  assert.equal(config.payload.views.compare.label, '差异对比');

  const current = await getState(fixture.baseUrl, 'current');
  const stateBeforeLayout = fs.readFileSync(fixture.stateFile, 'utf8');
  const initial = await request(fixture.baseUrl, '/api/layout?view=current');
  assert.equal(initial.response.status, 200);
  assert.equal(initial.payload.baseRevision, 0);
  assert.ok(initial.payload.positions[current.published.graph.nodes[0].id]);
  assert.deepEqual(initial.payload.containers['fixture-group'], { x: 0, y: 0, width: 420, height: 360 });
  assert.ok(fs.existsSync(fixture.layoutFile));
  assert.equal(fs.readFileSync(fixture.stateFile, 'utf8'), stateBeforeLayout);

  const node = current.published.graph.nodes[0];
  const position = { x: node.position.x + 77, y: node.position.y + 33 };
  const container = { x: 20, y: 30, width: 520, height: 460 };
  const saved = await request(fixture.baseUrl, '/api/layout?view=current', {
    method: 'PUT',
    body: body({
      schemaVersion: '1.1.0',
      expectedRevision: initial.payload.baseRevision,
      positions: { [node.id]: position },
      containers: { 'fixture-group': container },
    }),
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.baseRevision, 1);
  assert.deepEqual(saved.payload.positions[node.id], position);
  assert.deepEqual(saved.payload.containers['fixture-group'], container);
  assert.equal(fs.readFileSync(fixture.stateFile, 'utf8'), stateBeforeLayout);
  const stateAfterLayout = await getState(fixture.baseUrl, 'current');
  assert.deepEqual(stateAfterLayout.published.graph, current.published.graph);
  assert.deepEqual(stateAfterLayout.draft, current.draft);

  const stale = await request(fixture.baseUrl, '/api/layout?view=current', {
    method: 'PUT',
    body: body({
      schemaVersion: '1.1.0',
      expectedRevision: 0,
      positions: { [node.id]: { x: 1, y: 2 } },
    }),
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.code, 'STALE_LAYOUT');

  const unknown = await request(fixture.baseUrl, '/api/layout?view=current', {
    method: 'PUT',
    body: body({
      schemaVersion: '1.1.0',
      expectedRevision: saved.payload.baseRevision,
      positions: { 'unknown-module': { x: 1, y: 2 } },
    }),
  });
  assert.equal(unknown.response.status, 409);
  assert.equal(unknown.payload.code, 'UNKNOWN_LAYOUT_NODE');

  const unknownContainer = await request(fixture.baseUrl, '/api/layout?view=current', {
    method: 'PUT',
    body: body({
      schemaVersion: '1.1.0',
      expectedRevision: saved.payload.baseRevision,
      positions: {},
      containers: { 'unknown-group': { x: 0, y: 0, width: 320, height: 240 } },
    }),
  });
  assert.equal(unknownContainer.response.status, 409);
  assert.equal(unknownContainer.payload.code, 'UNKNOWN_LAYOUT_CONTAINER');
});

test('diagram catalog selects independent state and layout files without exposing local paths', async (t) => {
  const fixture = await startCatalogFixture(t);
  const catalog = await request(fixture.baseUrl, '/api/diagrams');
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.payload.defaultDiagramId, 'product-overview');
  assert.deepEqual(catalog.payload.diagrams.map((diagram) => diagram.id), ['product-overview', 'event-mainline']);
  catalog.payload.diagrams.forEach((diagram) => {
    assert.equal('stateFile' in diagram, false);
    assert.equal('layoutFile' in diagram, false);
    assert.equal('statePath' in diagram, false);
    assert.equal('layoutPath' in diagram, false);
  });

  const defaultState = await request(fixture.baseUrl, '/api/state?view=current');
  assert.equal(defaultState.response.status, 200);
  assert.equal(defaultState.payload.diagramId, 'product-overview');
  assert.equal(defaultState.payload.meta.title, 'Product Fixture');

  const eventState = await request(fixture.baseUrl, '/api/state?diagram=event-mainline&view=current');
  assert.equal(eventState.response.status, 200);
  assert.equal(eventState.payload.diagramId, 'event-mainline');
  assert.notEqual(eventState.payload.meta.title, 'Product Fixture');

  const productLayout = await request(fixture.baseUrl, '/api/layout?diagram=product-overview&view=current');
  assert.equal(productLayout.response.status, 200);
  assert.ok(fs.existsSync(fixture.productLayoutFile));
  assert.equal(fs.existsSync(fixture.layoutFile), false);

  const eventLayout = await request(fixture.baseUrl, '/api/layout?diagram=event-mainline&view=current');
  assert.equal(eventLayout.response.status, 200);
  assert.ok(fs.existsSync(fixture.layoutFile));
  assert.notEqual(fixture.productLayoutFile, fixture.layoutFile);

  const missing = await request(fixture.baseUrl, '/api/state?diagram=missing&view=current');
  assert.equal(missing.response.status, 404);
  assert.equal(missing.payload.code, 'DIAGRAM_NOT_FOUND');
});

test('draft save uses complete head/draft locks, increments monotonically and preserves lane isolation', async (t) => {
  const fixture = await startFixture(t);
  const current = await getState(fixture.baseUrl);
  const targetBefore = await getState(fixture.baseUrl, 'target');
  const graph = clone(current.published.graph);
  graph.nodes[0].position.x += 25;
  const saved = await saveDraft(fixture.baseUrl, current, graph);
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.draft.draftRevision, 1);
  assert.match(saved.payload.draft.draftId, /^current-draft-/);
  const firstDraftId = saved.payload.draft.draftId;

  const stale = await saveDraft(fixture.baseUrl, current, graph);
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.code, 'STALE_DRAFT');
  assert.equal(stale.payload.details.draftRevision, 1);

  graph.nodes[0].position.x += 10;
  const updated = await saveDraft(fixture.baseUrl, saved.payload, graph);
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.draft.draftId, firstDraftId);
  assert.equal(updated.payload.draft.draftRevision, 2);
  const targetAfter = await getState(fixture.baseUrl, 'target');
  assert.deepEqual(targetAfter.published, targetBefore.published);
  assert.deepEqual(targetAfter.draft, targetBefore.draft);
});

test('AI draft writes cannot override user-confirmed architecture without an explicit human correction flag', async (t) => {
  const fixture = await startFixture(t);
  await getState(fixture.baseUrl, 'current');
  const state = JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8'));
  const lockedNodeId = state.current.published.graph.nodes[0].id;
  state.meta.humanConfirmedArchitecture = {
    decisions: [{
      id: 'fixture-user-decision',
      view: 'current',
      confirmedAt: new Date().toISOString(),
      confirmedBy: 'user',
      note: '用户确认模块名称与归属。',
      protectedFields: ['name', 'group'],
      nodeIds: [lockedNodeId],
    }],
  };
  writeJson(fixture.stateFile, state);

  const current = await getState(fixture.baseUrl, 'current');
  const changed = clone(current.published.graph);
  changed.nodes[0].data.name = '人工纠正后的模块名称';
  const rejected = await saveDraft(fixture.baseUrl, current, changed);
  assert.equal(rejected.response.status, 403);
  assert.equal(rejected.payload.code, 'HUMAN_CONFIRMATION_REQUIRED');
  assert.deepEqual(rejected.payload.details.changes, [{ nodeId: lockedNodeId, fields: ['name'] }]);

  Object.assign(changed.nodes[0].data, {
    buildStrategy: '自建',
    humanConfirmed: true,
    confirmationNote: '用户明确纠正模块名称，并确认采用自建方式。',
    confirmedAt: new Date().toISOString(),
  });
  const accepted = await request(fixture.baseUrl, '/api/draft?view=current', {
    method: 'PUT',
    body: body({
      ...lockFrom(current),
      graph: changed,
      userConfirmedSemanticOverride: true,
    }),
  });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.payload.draft.graph.nodes[0].data.humanConfirmed, true);
  assert.equal(accepted.payload.draft.graph.nodes[0].data.buildStrategy, '自建');
});

test('invalid schema, graph and stale head never mutate state', async (t) => {
  const fixture = await startFixture(t);
  const current = await getState(fixture.baseUrl);
  const baseline = fs.readFileSync(fixture.stateFile, 'utf8');
  const wrongSchema = await request(fixture.baseUrl, '/api/draft?view=current', {
    method: 'PUT',
    body: body({ ...lockFrom(current), schemaVersion: '2.0.0', graph: current.published.graph }),
  });
  assert.equal(wrongSchema.response.status, 409);
  assert.equal(wrongSchema.payload.code, 'SCHEMA_VERSION_MISMATCH');
  const invalidGraph = clone(current.published.graph);
  invalidGraph.nodes[1].id = invalidGraph.nodes[0].id;
  const invalid = await saveDraft(fixture.baseUrl, current, invalidGraph);
  assert.equal(invalid.response.status, 422);
  const staleHead = await request(fixture.baseUrl, '/api/draft?view=current', {
    method: 'PUT',
    body: body({ ...lockFrom(current), expectedHeadRevisionId: 'current-r0', graph: current.published.graph }),
  });
  assert.equal(staleHead.response.status, 409);
  assert.equal(staleHead.payload.code, 'STALE_HEAD');
  assert.equal(fs.readFileSync(fixture.stateFile, 'utf8'), baseline);
});

test('draft delete is guarded and cannot silently discard newer work', async (t) => {
  const fixture = await startFixture(t);
  const current = await getState(fixture.baseUrl);
  const saved = await saveDraft(fixture.baseUrl, current, current.published.graph);
  const staleDelete = await request(fixture.baseUrl, '/api/draft?view=current', {
    method: 'DELETE',
    body: body(lockFrom(current)),
  });
  assert.equal(staleDelete.response.status, 409);
  assert.equal(staleDelete.payload.code, 'STALE_DRAFT');
  const discarded = await request(fixture.baseUrl, '/api/draft?view=current', {
    method: 'DELETE',
    body: body(lockFrom(saved.payload)),
  });
  assert.equal(discarded.response.status, 200);
  assert.equal(discarded.payload.draft, null);
  const noDraft = await request(fixture.baseUrl, '/api/draft?view=current', {
    method: 'DELETE',
    body: body(lockFrom(discarded.payload)),
  });
  assert.equal(noDraft.response.status, 409);
  assert.equal(noDraft.payload.code, 'NO_ACTIVE_DRAFT');
});

test('publish requires message and user confirmation, sets author server-side and keeps immutable history', async (t) => {
  const fixture = await startFixture(t);
  const current = await getState(fixture.baseUrl);
  const graph = clone(current.published.graph);
  graph.nodes[0].position.y += 30;
  const saved = await saveDraft(fixture.baseUrl, current, graph);
  const missingMessage = await request(fixture.baseUrl, '/api/publish?view=current', {
    method: 'POST',
    body: body({ ...lockFrom(saved.payload), userConfirmed: true }),
  });
  assert.equal(missingMessage.response.status, 422);
  const unconfirmed = await request(fixture.baseUrl, '/api/publish?view=current', {
    method: 'POST',
    body: body({ ...lockFrom(saved.payload), message: '布局修订', userConfirmed: false }),
  });
  assert.equal(unconfirmed.response.status, 403);
  assert.equal(unconfirmed.payload.code, 'USER_CONFIRMATION_REQUIRED');
  const published = await publish(fixture.baseUrl, saved.payload, '  布局修订  ');
  assert.equal(published.response.status, 200);
  assert.equal(published.payload.published.revision, 2);
  assert.equal(published.payload.published.revisionId, 'current-r2');
  assert.equal(published.payload.published.parentRevisionId, 'current-r1');
  assert.equal(published.payload.published.origin, 'publish');
  assert.equal(published.payload.published.message, '布局修订');
  assert.equal(published.payload.published.publishedBy, 'user');
  assert.equal(published.payload.draft, null);
  assert.equal(published.payload.historyCount, 1);
  const persisted = readState(fixture.stateFile);
  assert.deepEqual(persisted.current.history[0].graph, current.published.graph);
  assert.deepEqual(persisted.current.published.graph, graph);
});

test('manual ports and route waypoints survive draft save, publish and revision reads', async (t) => {
  const fixture = await startFixture(t);
  const current = await getState(fixture.baseUrl);
  const graph = clone(current.published.graph);
  graph.edges[0].data = {
    ...graph.edges[0].data,
    routingMode: 'manual',
    sourcePort: 'bottom',
    targetPort: 'top',
    waypoints: [{ x: 415.25, y: 725.5 }, { x: 888, y: 725.5 }],
  };
  const saved = await saveDraft(fixture.baseUrl, current, graph);
  assert.equal(saved.response.status, 200);
  assert.deepEqual(saved.payload.draft.graph.edges[0].data, graph.edges[0].data);
  const published = await publish(fixture.baseUrl, saved.payload, '锁定关键关系路径');
  assert.equal(published.response.status, 200);
  assert.deepEqual(published.payload.published.graph.edges[0].data, graph.edges[0].data);
  const revision = await request(fixture.baseUrl, '/api/revision?view=current&id=current-r2');
  assert.equal(revision.response.status, 200);
  assert.deepEqual(revision.payload.revision.graph.edges[0].data, graph.edges[0].data);
  assert.deepEqual(readState(fixture.stateFile).current.published.graph.edges[0].data, graph.edges[0].data);
});

test('revision catalog is summary-only and arbitrary revision read returns the immutable snapshot', async (t) => {
  const fixture = await startFixture(t);
  const current = await getState(fixture.baseUrl);
  const saved = await saveDraft(fixture.baseUrl, current, current.published.graph);
  await publish(fixture.baseUrl, saved.payload, '建立 R2');
  const catalog = await request(fixture.baseUrl, '/api/revisions?view=current');
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.payload.headRevisionId, 'current-r2');
  assert.deepEqual(catalog.payload.revisions.map((item) => item.revisionId), ['current-r2', 'current-r1']);
  assert.equal(catalog.payload.revisions.some((item) => 'graph' in item), false);
  const historical = await request(fixture.baseUrl, '/api/revision?view=current&id=current-r1');
  assert.equal(historical.response.status, 200);
  assert.equal(historical.payload.revision.revisionId, 'current-r1');
  assert.equal(historical.payload.revision.graph.nodes.length, 3);
  const missing = await request(fixture.baseUrl, '/api/revision?view=current&id=current-r999');
  assert.equal(missing.response.status, 404);
});

test('diff reports structural, layout, document, semantic and relationship categories', async (t) => {
  const fixture = await startFixture(t);
  const current = await getState(fixture.baseUrl);
  const graph = clone(current.published.graph);
  graph.nodes[0].position.x += 20;
  graph.nodes[1].data.documentRefs = ['alpha-doc'];
  graph.nodes[2].data.purpose = '变更后的模块用途';
  const addedNode = clone(graph.nodes[0]);
  addedNode.id = 'phase3-added-node';
  addedNode.data.name = '新增节点';
  addedNode.position = { x: 1600, y: 800 };
  graph.nodes.push(addedNode);
  graph.edges.push({
    id: 'phase3-added-edge',
    source: graph.nodes[0].id,
    target: addedNode.id,
    data: { label: '新增关系', relationType: 'reference', controlledBoundaryPosture: 'none', routingMode: 'auto' },
  });
  const saved = await saveDraft(fixture.baseUrl, current, graph);
  assert.equal(saved.response.status, 200);
  const diff = await request(fixture.baseUrl, '/api/diff?view=current&from=head&to=draft');
  assert.equal(diff.response.status, 200);
  assert.equal(diff.payload.summary.structural, 1);
  assert.equal(diff.payload.summary.layout, 1);
  assert.equal(diff.payload.summary.document, 1);
  assert.equal(diff.payload.summary.semantic, 1);
  assert.equal(diff.payload.summary.relationship, 1);
  assert.deepEqual(diff.payload.categories.document.changed[0].added, ['alpha-doc']);
});

test('restore rejects an active draft and otherwise creates a new revision without overwriting history', async (t) => {
  const fixture = await startFixture(t);
  const current = await getState(fixture.baseUrl);
  const graph = clone(current.published.graph);
  graph.nodes[0].position.x += 50;
  const saved = await saveDraft(fixture.baseUrl, current, graph);
  const blocked = await request(fixture.baseUrl, '/api/restore?view=current', {
    method: 'POST',
    body: body({ ...lockFrom(saved.payload), sourceRevisionId: 'current-r1', message: '恢复 R1', userConfirmed: true }),
  });
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.payload.code, 'ACTIVE_DRAFT');
  const published = await publish(fixture.baseUrl, saved.payload, '发布 R2');
  const restored = await request(fixture.baseUrl, '/api/restore?view=current', {
    method: 'POST',
    body: body({ ...lockFrom(published.payload), sourceRevisionId: 'current-r1', message: '恢复到原始布局', userConfirmed: true }),
  });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.payload.published.revision, 3);
  assert.equal(restored.payload.published.origin, 'restore');
  assert.equal(restored.payload.published.restoredFromRevisionId, 'current-r1');
  assert.deepEqual(restored.payload.published.graph, current.published.graph);
  const persisted = readState(fixture.stateFile);
  assert.deepEqual(persisted.current.history.map((item) => item.revisionId), ['current-r1', 'current-r2']);
});

test('target R0 empty baseline remains restorable as a new formal revision and current stays isolated', async (t) => {
  const fixture = await startFixture(t);
  const currentBefore = await getState(fixture.baseUrl, 'current');
  const target = await getState(fixture.baseUrl, 'target');
  const targetPublished = await publish(fixture.baseUrl, target, '发布目标架构', 'target');
  assert.equal(targetPublished.response.status, 200);
  assert.equal(targetPublished.payload.published.revision, 1);
  assert.equal(targetPublished.payload.published.graph.nodes.length, 3);
  const restored = await request(fixture.baseUrl, '/api/restore?view=target', {
    method: 'POST',
    body: body({ ...lockFrom(targetPublished.payload), sourceRevisionId: 'target-r0', message: '恢复空白目标基线', userConfirmed: true }),
  });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.payload.published.revision, 2);
  assert.equal(restored.payload.published.graph.nodes.length, 0);
  assert.equal(restored.payload.published.graph.edges.length, 0);
  const currentAfter = await getState(fixture.baseUrl, 'current');
  assert.deepEqual(currentAfter.published, currentBefore.published);
  assert.deepEqual(currentAfter.draft, currentBefore.draft);
});

test('legacy undo endpoint is retired instead of oscillating snapshots', async (t) => {
  const fixture = await startFixture(t);
  const result = await request(fixture.baseUrl, '/api/undo?view=current', { method: 'POST', body: '{}' });
  assert.equal(result.response.status, 410);
  assert.equal(result.payload.code, 'ENDPOINT_RETIRED');
});

test('document listing returns metadata and diagnostics only; preview is explicit, section-scoped and capped', async (t) => {
  const fixture = await startFixture(t);
  const listing = await request(fixture.baseUrl, '/api/documents');
  assert.equal(listing.response.status, 200);
  assert.equal(listing.payload.schemaVersion, DOCUMENT_SCHEMA_VERSION);
  assert.equal(listing.payload.baseRevision, 1);
  assert.equal(listing.payload.documents.length, 2);
  assert.equal('content' in listing.payload.documents[0], false);
  assert.ok(listing.payload.documents[0].diagnostics.some((item) => item.code === 'ORPHANED'));
  const preview = await request(fixture.baseUrl, '/api/documents/alpha-doc/preview?section=Details');
  assert.equal(preview.response.status, 200);
  assert.match(preview.payload.content, /^## Details/);
  assert.match(preview.payload.content, /<section>/);
  assert.equal(preview.payload.truncated, false);
  const large = await request(fixture.baseUrl, '/api/documents/large-doc/preview');
  assert.equal(large.response.status, 200);
  assert.equal(large.payload.truncated, true);
  assert.ok(Buffer.byteLength(large.payload.content, 'utf8') <= 32 * 1024);
});

test('document diagnostics expose stale, missing, superseded and archived conditions without reading bodies', async (t) => {
  const fixture = await startFixture(t);
  const registry = JSON.parse(fs.readFileSync(fixture.documentsFile, 'utf8'));
  registry.documents[0].lastVerifiedAt = '2020-01-01T00:00:00.000Z';
  registry.documents[1].status = 'superseded';
  writeJson(fixture.documentsFile, registry);
  let listing = (await request(fixture.baseUrl, '/api/documents')).payload;
  assert.ok(listing.documents.find((item) => item.id === 'alpha-doc').diagnostics.some((item) => item.code === 'STALE_FILE'));
  assert.ok(listing.documents.find((item) => item.id === 'large-doc').diagnostics.some((item) => item.code === 'SUPERSEDED'));

  registry.documents[1].status = 'archived';
  writeJson(fixture.documentsFile, registry);
  listing = (await request(fixture.baseUrl, '/api/documents')).payload;
  assert.ok(listing.documents.find((item) => item.id === 'large-doc').diagnostics.some((item) => item.code === 'ARCHIVED'));

  fs.rmSync(path.join(fixture.commandRoot, 'docs', 'alpha.md'));
  listing = (await request(fixture.baseUrl, '/api/documents')).payload;
  assert.ok(listing.documents.find((item) => item.id === 'alpha-doc').diagnostics.some((item) => item.code === 'DOCUMENT_MISSING'));
});

test('a missing registered document can still be archived without deleting its stable record', async (t) => {
  const fixture = await startFixture(t);
  fs.rmSync(path.join(fixture.commandRoot, 'docs', 'alpha.md'));
  const listing = (await request(fixture.baseUrl, '/api/documents')).payload;
  const alpha = listing.documents.find((item) => item.id === 'alpha-doc');
  const archivedDocument = {
    id: alpha.id,
    title: alpha.title,
    type: alpha.type,
    status: 'archived',
    authority: alpha.authority,
    path: alpha.path,
    summary: alpha.summary,
    supersedes: alpha.supersedes,
    lastVerifiedAt: alpha.lastVerifiedAt,
  };
  const archived = await request(fixture.baseUrl, '/api/documents/alpha-doc', {
    method: 'PUT',
    body: body({ schemaVersion: DOCUMENT_SCHEMA_VERSION, baseRevision: listing.baseRevision, document: archivedDocument }),
  });
  assert.equal(archived.response.status, 200);
  const saved = archived.payload.documents.find((item) => item.id === 'alpha-doc');
  assert.equal(saved.status, 'archived');
  assert.ok(saved.diagnostics.some((item) => item.code === 'DOCUMENT_MISSING'));
  assert.ok(saved.diagnostics.some((item) => item.code === 'ARCHIVED'));
});

test('document registry writes use independent revision guards and safe paths', async (t) => {
  const fixture = await startFixture(t);
  const document = activeDocument({ id: 'new-doc', title: 'New', path: 'docs/new.md' });
  const created = await request(fixture.baseUrl, '/api/documents', {
    method: 'POST',
    body: body({ schemaVersion: DOCUMENT_SCHEMA_VERSION, baseRevision: 1, document }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.baseRevision, 2);
  const stale = await request(fixture.baseUrl, '/api/documents/new-doc', {
    method: 'PUT',
    body: body({ schemaVersion: DOCUMENT_SCHEMA_VERSION, baseRevision: 1, document }),
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.code, 'STALE_DOCUMENT_REGISTRY');
  const unsafe = await request(fixture.baseUrl, '/api/documents', {
    method: 'POST',
    body: body({
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      baseRevision: 2,
      document: activeDocument({ id: 'unsafe-doc', path: '../outside.md' }),
    }),
  });
  assert.equal(unsafe.response.status, 422);
  assert.equal(unsafe.payload.code, 'DOCUMENT_PATH_INVALID');
  assert.throws(() => resolveSafeDocument('docs/missing.md', fixture.commandRoot), (error) => error.code === 'DOCUMENT_MISSING');
  fs.mkdirSync(path.join(fixture.commandRoot, 'docs', 'directory.md'));
  assert.throws(() => resolveSafeDocument('docs/directory.md', fixture.commandRoot), (error) => error.code === 'DOCUMENT_NOT_FILE');
  fs.writeFileSync(path.join(fixture.commandRoot, 'docs', 'too-large.md'), Buffer.alloc(1024 * 1024 + 1, 97));
  assert.throws(() => resolveSafeDocument('docs/too-large.md', fixture.commandRoot), (error) => error.code === 'DOCUMENT_TOO_LARGE');

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-document-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'linked.md'), '# Outside', 'utf8');
    fs.symlinkSync(outside, path.join(fixture.commandRoot, 'docs', 'linked'), 'junction');
    assert.throws(
      () => resolveSafeDocument('docs/linked/linked.md', fixture.commandRoot),
      (error) => error.code === 'DOCUMENT_REPARSE_POINT',
    );
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('unknown, archived and superseded documents cannot become new bindings', async (t) => {
  const fixture = await startFixture(t);
  const current = await getState(fixture.baseUrl);
  const unknownGraph = clone(current.published.graph);
  unknownGraph.nodes[0].data.documentRefs = ['unknown-doc'];
  const unknown = await saveDraft(fixture.baseUrl, current, unknownGraph);
  assert.equal(unknown.response.status, 422);
  assert.equal(unknown.payload.code, 'UNKNOWN_DOCUMENT_BINDING');

  const registry = (await request(fixture.baseUrl, '/api/documents')).payload;
  const alpha = registry.documents.find((item) => item.id === 'alpha-doc');
  const persistedAlpha = {
    id: alpha.id,
    title: alpha.title,
    type: alpha.type,
    status: 'archived',
    authority: alpha.authority,
    path: alpha.path,
    summary: alpha.summary,
    supersedes: alpha.supersedes,
    lastVerifiedAt: alpha.lastVerifiedAt,
  };
  const archived = await request(fixture.baseUrl, '/api/documents/alpha-doc', {
    method: 'PUT',
    body: body({ schemaVersion: DOCUMENT_SCHEMA_VERSION, baseRevision: registry.baseRevision, document: persistedAlpha }),
  });
  assert.equal(archived.response.status, 200);
  const archivedGraph = clone(current.published.graph);
  archivedGraph.nodes[0].data.documentRefs = ['alpha-doc'];
  const blocked = await saveDraft(fixture.baseUrl, current, archivedGraph);
  assert.equal(blocked.response.status, 422);
  assert.equal(blocked.payload.code, 'DOCUMENT_BINDING_BLOCKED');
});

test('existing broken references are preserved and surfaced instead of blocking unrelated draft edits', async (t) => {
  const fixture = await startFixture(t);
  // Trigger migration only in the isolated fixture, then simulate a pre-existing reference anomaly.
  await getState(fixture.baseUrl);
  const state = JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8'));
  state.current.published.graph.nodes[0].data.documentRefs = ['unknown-doc'];
  writeJson(fixture.stateFile, state);
  const current = await getState(fixture.baseUrl);
  const graph = clone(current.published.graph);
  graph.nodes[0].position.x += 5;
  const saved = await saveDraft(fixture.baseUrl, current, graph);
  assert.equal(saved.response.status, 200);
  assert.deepEqual(saved.payload.draft.graph.nodes[0].data.documentRefs, ['unknown-doc']);
  const listing = await request(fixture.baseUrl, '/api/documents');
  assert.ok(listing.payload.bindingDiagnostics.some((item) => item.code === 'UNKNOWN_DOCUMENT'));
});

test('hard delete is blocked by draft, published or historical references, including historical-only bindings', async (t) => {
  const fixture = await startFixture(t);
  const current = await getState(fixture.baseUrl);
  const boundGraph = clone(current.published.graph);
  boundGraph.nodes[0].data.documentRefs = ['alpha-doc'];
  const boundDraft = await saveDraft(fixture.baseUrl, current, boundGraph);
  let registry = (await request(fixture.baseUrl, '/api/documents')).payload;
  const draftBlocked = await request(fixture.baseUrl, '/api/documents/alpha-doc', {
    method: 'DELETE',
    body: body({ schemaVersion: DOCUMENT_SCHEMA_VERSION, baseRevision: registry.baseRevision }),
  });
  assert.equal(draftBlocked.response.status, 409);
  assert.equal(draftBlocked.payload.code, 'DOCUMENT_REFERENCED');
  const r2 = await publish(fixture.baseUrl, boundDraft.payload, '绑定文档');
  const unboundGraph = clone(r2.payload.published.graph);
  delete unboundGraph.nodes[0].data.documentRefs;
  const unboundDraft = await saveDraft(fixture.baseUrl, r2.payload, unboundGraph);
  await publish(fixture.baseUrl, unboundDraft.payload, '移除当前绑定');
  registry = (await request(fixture.baseUrl, '/api/documents')).payload;
  const alpha = registry.documents.find((item) => item.id === 'alpha-doc');
  assert.equal(alpha.referenceSummary.activeCount, 0);
  assert.ok(alpha.referenceSummary.historicalCount > 0);
  assert.ok(alpha.diagnostics.some((item) => item.code === 'HISTORICAL_ONLY'));
  const historyBlocked = await request(fixture.baseUrl, '/api/documents/alpha-doc', {
    method: 'DELETE',
    body: body({ schemaVersion: DOCUMENT_SCHEMA_VERSION, baseRevision: registry.baseRevision }),
  });
  assert.equal(historyBlocked.response.status, 409);
  assert.ok(historyBlocked.payload.details.references.every((item) => item.scope === 'history'));
});

test('unreferenced registry documents can be deleted without changing architecture state', async (t) => {
  const fixture = await startFixture(t);
  const stateBefore = await getState(fixture.baseUrl);
  const registry = (await request(fixture.baseUrl, '/api/documents')).payload;
  const deleted = await request(fixture.baseUrl, '/api/documents/large-doc', {
    method: 'DELETE',
    body: body({ schemaVersion: DOCUMENT_SCHEMA_VERSION, baseRevision: registry.baseRevision }),
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.payload.baseRevision, registry.baseRevision + 1);
  assert.equal(deleted.payload.documents.some((item) => item.id === 'large-doc'), false);
  const stateAfter = await getState(fixture.baseUrl);
  assert.deepEqual(stateAfter.published, stateBefore.published);
  assert.deepEqual(stateAfter.draft, stateBefore.draft);
});

test('a registry supersedes reference also prevents destructive hard deletion', async (t) => {
  const fixture = await startFixture(t);
  const replacement = activeDocument({
    id: 'replacement-doc',
    title: 'Replacement',
    path: 'docs/new.md',
    supersedes: 'alpha-doc',
  });
  const created = await request(fixture.baseUrl, '/api/documents', {
    method: 'POST',
    body: body({ schemaVersion: DOCUMENT_SCHEMA_VERSION, baseRevision: 1, document: replacement }),
  });
  assert.equal(created.response.status, 201);
  const blocked = await request(fixture.baseUrl, '/api/documents/alpha-doc', {
    method: 'DELETE',
    body: body({ schemaVersion: DOCUMENT_SCHEMA_VERSION, baseRevision: created.payload.baseRevision }),
  });
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.payload.code, 'DOCUMENT_REFERENCED');
  assert.deepEqual(blocked.payload.details.supersedingDocuments, ['replacement-doc']);
});

test('server requires a built frontend instead of falling back to project files', () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => createServer({ ...fixture, staticRoot: path.join(fixture.commandRoot, 'missing-dist') }),
      /Static build is missing/,
    );
  } finally {
    fs.rmSync(fixture.commandRoot, { recursive: true, force: true });
  }
});

test('server safely serves Vite assets with localhost-only CSP and blocks private static paths', async (t) => {
  const fixture = await startFixture(t);
  fs.writeFileSync(path.join(fixture.staticRoot, 'server.js'), 'private server source', 'utf8');
  fs.writeFileSync(path.join(fixture.staticRoot, '.env'), 'PRIVATE_TOKEN=not-for-browser', 'utf8');
  fs.mkdirSync(path.join(fixture.staticRoot, 'projects', 'private'), { recursive: true });
  fs.writeFileSync(path.join(fixture.staticRoot, 'projects', 'private', 'project.json'), '{"private":true}', 'utf8');
  const asset = await fetch(`${fixture.baseUrl}/assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /^text\/javascript/);
  assert.match(asset.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.equal(await asset.text(), 'globalThis.__local = true;');
  const missing = await fetch(`${fixture.baseUrl}/assets/missing.js`);
  assert.equal(missing.status, 404);
  const traversal = await fetch(`${fixture.baseUrl}/%2e%2e/server.js`);
  assert.notEqual(traversal.status, 200);
  const source = await fetch(`${fixture.baseUrl}/server.js`);
  assert.notEqual(source.status, 200);
  const environment = await fetch(`${fixture.baseUrl}/.env`);
  assert.notEqual(environment.status, 200);
  const project = await fetch(`${fixture.baseUrl}/projects/private/project.json`);
  assert.notEqual(project.status, 200);
});
