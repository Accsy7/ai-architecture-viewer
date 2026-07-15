'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServer, readState } = require('../server.js');
const { canonicalSha256 } = require('../schema/registered-flow-contract.cjs');

const STATE_FIXTURE = path.join(__dirname, 'fixtures', 'generic-state-v2.json');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registered-flow-server-'));
  const staticRoot = path.join(root, 'dist');
  const sourceStateFile = path.join(root, 'source-state.json');
  const projectionStateFile = path.join(root, 'projection-state.json');
  const sourceLayoutFile = path.join(root, 'source-layout.json');
  const projectionLayoutFile = path.join(root, 'projection-layout.json');
  const catalogFile = path.join(root, 'architecture-catalog.json');
  const registeredFlowsFile = path.join(root, 'registered-business-flows.json');
  const analysisFile = path.join(root, 'analysis.json');
  fs.mkdirSync(staticRoot, { recursive: true });
  fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><div id="root"></div>', 'utf8');
  fs.copyFileSync(STATE_FIXTURE, sourceStateFile);
  fs.copyFileSync(STATE_FIXTURE, projectionStateFile);
  writeJson(sourceLayoutFile, { sentinel: 'source-layout' });
  writeJson(projectionLayoutFile, { sentinel: 'projection-layout' });
  writeJson(analysisFile, { sentinel: 'analysis' });
  writeJson(catalogFile, {
    schemaVersion: '1.0.0',
    defaultDiagramId: 'projection-diagram',
    diagrams: [
      {
        id: 'projection-diagram', title: 'Projection', description: 'Projection diagram', viewpoint: 'product', level: 'project',
        parentDiagramId: null, ownerNodeId: null, defaultFocusNodeId: null,
        stateFile: 'projection-state.json', layoutFile: 'projection-layout.json',
      },
      {
        id: 'source-diagram', title: 'Source', description: 'Source flow', viewpoint: 'flow', level: 'project',
        parentDiagramId: null, ownerNodeId: null, defaultFocusNodeId: null,
        stateFile: 'source-state.json', layoutFile: 'source-layout.json',
      },
    ],
  });
  const sourceState = readState(sourceStateFile);
  const projectionState = readState(projectionStateFile);
  const sourceRevision = sourceState.current.published;
  const projectionRevision = projectionState.current.published;
  writeJson(registeredFlowsFile, {
    schemaVersion: '1.0.0',
    flows: [{
      id: 'fixture-flow',
      title: 'Fixture flow',
      description: 'Explicit identity projection for a read-only endpoint test.',
      source: {
        diagramId: 'source-diagram', view: 'current',
        revision: {
          kind: 'published', id: sourceRevision.revisionId, revision: sourceRevision.revision,
          canonicalSha256: canonicalSha256(sourceRevision),
        },
      },
      projection: {
        diagramId: 'projection-diagram', view: 'current',
        revision: {
          kind: 'published', id: projectionRevision.revisionId, revision: projectionRevision.revision,
          canonicalSha256: canonicalSha256(projectionRevision),
        },
      },
      order: 'topological-stages',
      nodeMappings: sourceRevision.graph.nodes.map((node) => ({ sourceNodeId: node.id, projectionNodeId: node.id })),
      edgeMappings: sourceRevision.graph.edges.map((edge) => ({ sourceEdgeId: edge.id, projectionEdgeId: edge.id })),
      sidebarOnlyNodeIds: [],
      sidebarOnlyEdgeIds: [],
    }],
  });
  return {
    root, staticRoot, sourceStateFile, projectionStateFile, sourceLayoutFile, projectionLayoutFile,
    catalogFile, registeredFlowsFile, analysisFile,
  };
}

async function startFixture(t) {
  const fixture = createFixture();
  const server = createServer({
    projectRoot: fixture.root,
    stateFile: fixture.sourceStateFile,
    catalogFile: fixture.catalogFile,
    registeredFlowsFile: fixture.registeredFlowsFile,
    staticRoot: fixture.staticRoot,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    resolve();
  })));
  return { ...fixture, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test('registered flow GET resolves the explicit projection without writing project files', async (t) => {
  const fixture = await startFixture(t);
  const guardedFiles = [
    fixture.sourceStateFile,
    fixture.projectionStateFile,
    fixture.sourceLayoutFile,
    fixture.projectionLayoutFile,
    fixture.analysisFile,
    fixture.catalogFile,
    fixture.registeredFlowsFile,
  ];
  const before = Object.fromEntries(guardedFiles.map((file) => [file, sha256(file)]));
  const response = await fetch(`${fixture.baseUrl}/api/registered-flows?diagram=projection-diagram&view=current`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.flows.length, 1);
  assert.equal(payload.flows[0].id, 'fixture-flow');
  assert.deepEqual(Object.fromEntries(guardedFiles.map((file) => [file, sha256(file)])), before);

  const unrelated = await fetch(`${fixture.baseUrl}/api/registered-flows?diagram=projection-diagram&view=target`);
  assert.equal(unrelated.status, 200);
  assert.deepEqual((await unrelated.json()).flows, []);
  assert.deepEqual(Object.fromEntries(guardedFiles.map((file) => [file, sha256(file)])), before);
});

test('registered flow endpoint fails closed on a stale hash', async (t) => {
  const fixture = await startFixture(t);
  const registry = JSON.parse(fs.readFileSync(fixture.registeredFlowsFile, 'utf8'));
  registry.flows[0].source.revision.canonicalSha256 = '0'.repeat(64);
  writeJson(fixture.registeredFlowsFile, registry);
  const response = await fetch(`${fixture.baseUrl}/api/registered-flows?diagram=projection-diagram&view=current`);
  const payload = await response.json();
  assert.equal(response.status, 500);
  assert.equal(payload.code, 'REGISTERED_FLOW_INVALID');
  assert.match(payload.error, /版本锁失配/);
});

test('projects without a registry get an empty, non-misleading response', async (t) => {
  const fixture = createFixture();
  fs.unlinkSync(fixture.registeredFlowsFile);
  const server = createServer({
    projectRoot: fixture.root,
    stateFile: fixture.sourceStateFile,
    catalogFile: fixture.catalogFile,
    registeredFlowsFile: fixture.registeredFlowsFile,
    staticRoot: fixture.staticRoot,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    resolve();
  })));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/registered-flows?diagram=projection-diagram&view=current`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).flows, []);
});
