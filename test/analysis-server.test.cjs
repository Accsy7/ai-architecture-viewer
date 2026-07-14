'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServer } = require('../server.js');
const { ANALYSIS_SCHEMA_VERSION } = require('../schema/analysis-contract.cjs');

const V2_STATE = path.join(__dirname, 'fixtures', 'generic-state-v2.json');

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createProvider({ invalid = false, empty = false } = {}) {
  return {
    describe: () => ({ provider: 'fixture', configured: true, model: 'fixture-model' }),
    async generate(input) {
      const evidenceId = input.evidence[0]?.id;
      if (empty) return { proposals: [] };
      if (invalid) {
        return {
          proposals: [{
            title: 'Unsafe placement',
            summary: 'This must be rejected by the server.',
            confidence: 'high',
            evidenceIds: [evidenceId],
            changes: [{
              kind: 'add',
              targetType: 'node',
              targetId: 'unsafe-node',
              summary: 'Attempts to direct layout.',
              evidenceIds: [evidenceId],
              patch: {
                position: { x: 999, y: 999 },
                data: {
                  name: 'Unsafe node',
                  purpose: 'Should not reach the graph.',
                  technical: 'Fixture',
                  product: 'Fixture',
                  authorization: 'Fixture',
                },
              },
            }],
          }],
        };
      }
      return {
        proposals: [{
          title: 'Add an evidence evaluation gate',
          summary: 'The selected design note calls for an explicit evidence check before downstream handling.',
          confidence: 'high',
          evidenceIds: [evidenceId],
          changes: [
            {
              kind: 'add',
              targetType: 'node',
              targetId: 'evaluation-gate',
              summary: 'Add a human-reviewable evaluation gate.',
              evidenceIds: [evidenceId],
              patch: {
                data: {
                  name: 'Evaluation gate',
                  purpose: 'Checks whether retrieved evidence supports a candidate response.',
                  technical: 'Rules and evaluator adapter',
                  product: 'A visible hold point before a person reviews the result.',
                  authorization: 'Can recommend hold only; it cannot send or approve a response.',
                },
              },
            },
            {
              kind: 'add',
              targetType: 'edge',
              targetId: 'processing-to-evaluation',
              summary: 'Route normalized work into the evaluation gate.',
              evidenceIds: [evidenceId],
              patch: {
                source: 'processing-module',
                target: 'evaluation-gate',
                data: { label: 'checks evidence', relationType: 'flow' },
              },
            },
          ],
        }],
      };
    },
  };
}

function createFixture(provider = createProvider()) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-analysis-server-'));
  const stateFile = path.join(projectRoot, 'state.json');
  const analysisFile = path.join(projectRoot, 'analysis.json');
  const staticRoot = path.join(projectRoot, 'dist');
  fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'credentials'), { recursive: true });
  fs.mkdirSync(staticRoot, { recursive: true });
  fs.copyFileSync(V2_STATE, stateFile);
  fs.writeFileSync(path.join(projectRoot, 'docs', 'architecture.md'), [
    '# Architecture evidence',
    '',
    'Candidate responses need an explicit evidence evaluation step.',
    'The evaluation step may recommend a hold but never approve or send a response.',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'credentials', 'notes.md'), 'This must never be offered as AI source material.', 'utf8');
  fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><div id="root"></div>', 'utf8');
  return { projectRoot, stateFile, analysisFile, staticRoot, provider };
}

async function startFixture(t, provider) {
  const fixture = createFixture(provider);
  const server = createServer({ ...fixture, analysisProvider: fixture.provider });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(() => {
    fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
    resolve();
  })));
  return { ...fixture, server, baseUrl: `http://127.0.0.1:${server.address().port}` };
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

async function prepareAnalysis(baseUrl, { configured = true } = {}) {
  const initial = await request(baseUrl, '/api/analysis');
  assert.equal(initial.response.status, 200);
  assert.equal(initial.payload.provider.configured, configured);
  const source = initial.payload.sources.find((item) => item.path === 'docs/architecture.md');
  assert.ok(source);
  const selected = await request(baseUrl, '/api/analysis/sources', {
    method: 'PUT',
    body: body({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      baseRevision: initial.payload.baseRevision,
      sources: initial.payload.sources.map((item) => ({ path: item.path, selected: item.path === source.path })),
    }),
  });
  assert.equal(selected.response.status, 200);
  const scanned = await request(baseUrl, '/api/analysis/scan', {
    method: 'POST',
    body: body({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision: selected.payload.baseRevision }),
  });
  assert.equal(scanned.response.status, 200);
  assert.ok(scanned.payload.evidence.length > 0);
  return scanned.payload;
}

test('analysis APIs scan safe project evidence, validate model output, and create a user-confirmed draft', async (t) => {
  const fixture = await startFixture(t);
  const scanned = await prepareAnalysis(fixture.baseUrl);
  const generated = await request(fixture.baseUrl, '/api/analysis/proposals?view=current', {
    method: 'POST',
    body: body({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision: scanned.baseRevision }),
  });
  assert.equal(generated.response.status, 201);
  const proposal = generated.payload.proposals[0];
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.changes[0].patch.data.group, undefined);
  assert.equal(proposal.changes[0].patch.position, undefined);
  assert.equal(proposal.evidence.length, 1);

  const accepted = await request(fixture.baseUrl, `/api/analysis/proposals/${proposal.id}/accept`, {
    method: 'POST',
    body: body({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      baseRevision: generated.payload.baseRevision,
      userConfirmed: true,
    }),
  });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.payload.lane.draft.draftRevision, 1);
  const addedNode = accepted.payload.lane.draft.graph.nodes.find((node) => node.id === 'evaluation-gate');
  assert.ok(addedNode);
  assert.equal(addedNode.data.group, '处理');
  assert.equal(addedNode.data.humanConfirmed, undefined);
  const addedEdge = accepted.payload.lane.draft.graph.edges.find((edge) => edge.id === 'processing-to-evaluation');
  assert.deepEqual(addedEdge.data, {
    label: 'checks evidence',
    relationType: 'flow',
    controlledBoundaryPosture: 'none',
    routingMode: 'auto',
  });
  assert.equal(accepted.payload.analysis.proposals[0].status, 'accepted');
  assert.equal(accepted.payload.analysis.proposals[0].application.draftId, accepted.payload.lane.draft.draftId);
});

test('analysis APIs reject unsafe source selection and invalid AI layout patches without persisting a proposal', async (t) => {
  const fixture = await startFixture(t, createProvider({ invalid: true }));
  const initial = await request(fixture.baseUrl, '/api/analysis');
  const unsafe = await request(fixture.baseUrl, '/api/analysis/sources', {
    method: 'PUT',
    body: body({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      baseRevision: initial.payload.baseRevision,
      sources: [{ path: '../outside.md', selected: true }],
    }),
  });
  assert.equal(unsafe.response.status, 422);
  assert.equal(unsafe.payload.code, 'ANALYSIS_SOURCE_NOT_AVAILABLE');

  const scanned = await prepareAnalysis(fixture.baseUrl);
  const generated = await request(fixture.baseUrl, '/api/analysis/proposals?view=current', {
    method: 'POST',
    body: body({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision: scanned.baseRevision }),
  });
  assert.equal(generated.response.status, 502);
  assert.equal(generated.payload.code, 'AI_OUTPUT_INVALID');
  const after = await request(fixture.baseUrl, '/api/analysis');
  assert.equal(after.payload.proposals.length, 0);
});

test('analysis source discovery ignores files inside sensitive directory names', async (t) => {
  const fixture = await startFixture(t);
  const initial = await request(fixture.baseUrl, '/api/analysis');
  assert.equal(initial.response.status, 200);
  assert.equal(initial.payload.sources.some((item) => item.path === 'credentials/notes.md'), false);
  const selected = await request(fixture.baseUrl, '/api/analysis/sources', {
    method: 'PUT',
    body: body({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      baseRevision: initial.payload.baseRevision,
      sources: [{ path: 'credentials/notes.md', selected: true }],
    }),
  });
  assert.equal(selected.response.status, 422);
  assert.equal(selected.payload.code, 'ANALYSIS_SOURCE_NOT_AVAILABLE');
});

test('analysis APIs accept an empty evidence-backed result without creating a proposal', async (t) => {
  const fixture = await startFixture(t, createProvider({ empty: true }));
  const scanned = await prepareAnalysis(fixture.baseUrl);
  const generated = await request(fixture.baseUrl, '/api/analysis/proposals?view=current', {
    method: 'POST',
    body: body({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision: scanned.baseRevision }),
  });
  assert.equal(generated.response.status, 200);
  assert.equal(generated.payload.proposals.length, 0);
  assert.equal(generated.payload.generation.proposalCount, 0);
  assert.equal(generated.payload.baseRevision, scanned.baseRevision);
});

test('proposal acceptance requires explicit confirmation and keeps stale or active-draft state safe', async (t) => {
  const fixture = await startFixture(t);
  const scanned = await prepareAnalysis(fixture.baseUrl);
  const generated = await request(fixture.baseUrl, '/api/analysis/proposals?view=current', {
    method: 'POST',
    body: body({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision: scanned.baseRevision }),
  });
  const proposal = generated.payload.proposals[0];
  const missingConfirmation = await request(fixture.baseUrl, `/api/analysis/proposals/${proposal.id}/accept`, {
    method: 'POST',
    body: body({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision: generated.payload.baseRevision }),
  });
  assert.equal(missingConfirmation.response.status, 403);
  assert.equal(missingConfirmation.payload.code, 'USER_CONFIRMATION_REQUIRED');

  const accepted = await request(fixture.baseUrl, `/api/analysis/proposals/${proposal.id}/accept`, {
    method: 'POST',
    body: body({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision: generated.payload.baseRevision, userConfirmed: true }),
  });
  assert.equal(accepted.response.status, 200);
  const repeat = await request(fixture.baseUrl, `/api/analysis/proposals/${proposal.id}/accept`, {
    method: 'POST',
    body: body({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision: accepted.payload.analysis.baseRevision, userConfirmed: true }),
  });
  assert.equal(repeat.response.status, 409);
  assert.equal(repeat.payload.code, 'PROPOSAL_ALREADY_REVIEWED');
});

test('proposal acceptance refuses evidence that changed after the proposal was generated', async (t) => {
  const fixture = await startFixture(t);
  const scanned = await prepareAnalysis(fixture.baseUrl);
  const generated = await request(fixture.baseUrl, '/api/analysis/proposals?view=current', {
    method: 'POST',
    body: body({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision: scanned.baseRevision }),
  });
  const proposal = generated.payload.proposals[0];
  fs.writeFileSync(path.join(fixture.projectRoot, 'docs', 'architecture.md'), '# Changed\n\nThe evidence changed after proposal generation.\n', 'utf8');
  const stale = await request(fixture.baseUrl, `/api/analysis/proposals/${proposal.id}/accept`, {
    method: 'POST',
    body: body({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision: generated.payload.baseRevision, userConfirmed: true }),
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.code, 'PROPOSAL_EVIDENCE_STALE');
  const state = await request(fixture.baseUrl, '/api/state?view=current');
  assert.equal(state.payload.draft, null);
});

test('unconfigured provider never exposes configuration material in API responses', async (t) => {
  const provider = {
    describe: () => ({ provider: 'fixture', configured: false, model: 'fixture-model' }),
    async generate() {
      const error = new Error('missing provider credential');
      error.code = 'AI_PROVIDER_NOT_CONFIGURED';
      error.status = 503;
      throw error;
    },
  };
  const fixture = await startFixture(t, provider);
  const scanned = await prepareAnalysis(fixture.baseUrl, { configured: false });
  const generated = await request(fixture.baseUrl, '/api/analysis/proposals?view=current', {
    method: 'POST',
    body: body({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision: scanned.baseRevision }),
  });
  assert.equal(generated.response.status, 503);
  assert.equal(generated.payload.code, 'AI_PROVIDER_NOT_CONFIGURED');
  assert.equal(JSON.stringify(generated.payload).includes('credential'), false);
});

test('skill catalog API exposes the three bundled workflows without absolute paths', async (t) => {
  const fixture = await startFixture(t);
  const result = await request(fixture.baseUrl, '/api/skills');
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.protocolVersion, '1.0.0');
  assert.deepEqual(result.payload.skills.map((skill) => skill.id), [
    'architecture-discovery',
    'architecture-change-plan',
    'implementation-reconcile',
  ]);
  assert.equal(result.payload.skills.some((skill) => path.isAbsolute(skill.skillPath)), false);
  assert.equal(JSON.stringify(result.payload).includes(fixture.projectRoot), false);
});
