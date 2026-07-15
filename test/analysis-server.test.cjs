'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServer } = require('../server.js');
const { ANALYSIS_SCHEMA_VERSION } = require('../schema/analysis-contract.cjs');

const ROOT = path.resolve(__dirname, '..');
const V2_STATE = path.join(__dirname, 'fixtures', 'generic-state-v2.json');
const DEMO_CONFIG = path.join(ROOT, 'projects', 'demo', 'viewer.config.json');
const DEMO_DOCUMENTS = path.join(ROOT, 'projects', 'demo', 'document-registry.json');
const NOW = '2020-01-01T00:00:00.000Z';

function hash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function createFixture({
  separateWorkspace = false,
  withoutCodeRepository = false,
  clearTargetDraft = false,
  targetFromCurrent = false,
} = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-agent-server-'));
  const workspaceRoot = separateWorkspace
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-agent-workspace-'))
    : projectRoot;
  const stateFile = path.join(projectRoot, 'state.json');
  const analysisFile = path.join(projectRoot, 'analysis.json');
  const configFile = path.join(projectRoot, 'viewer.config.json');
  const documentsFile = path.join(projectRoot, 'document-registry.json');
  const staticRoot = path.join(projectRoot, 'dist');
  const sourceFile = path.join(workspaceRoot, 'src', 'service.js');
  const designFile = path.join(workspaceRoot, 'docs', 'target-design.md');
  const sourceContent = [
    'export function evaluateEvidence(candidate) {',
    '  return candidate.citations.length > 0;',
    '}',
  ].join('\n');
  if (!withoutCodeRepository) fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.mkdirSync(path.dirname(designFile), { recursive: true });
  fs.mkdirSync(staticRoot, { recursive: true });
  fs.copyFileSync(V2_STATE, stateFile);
  if (clearTargetDraft || targetFromCurrent) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (clearTargetDraft) state.target.draft = null;
    if (targetFromCurrent) {
      state.target.published.revision = 1;
      state.target.published.publishedAt = NOW;
      state.target.published.publishedBy = 'user';
      state.target.published.graph = structuredClone(state.current.published.graph);
      state.target.published.graph.nodes.forEach((node) => { node.data.horizon = '近期'; });
      state.target.draft = null;
    }
    fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }
  fs.copyFileSync(DEMO_CONFIG, configFile);
  fs.copyFileSync(DEMO_DOCUMENTS, documentsFile);
  if (!withoutCodeRepository) fs.writeFileSync(sourceFile, sourceContent, 'utf8');
  const designContent = '# Target design\n\nThe target needs a human-governed architecture decision boundary.\n';
  fs.writeFileSync(designFile, designContent, 'utf8');
  fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><div id="root"></div>', 'utf8');
  return {
    projectRoot, workspaceRoot, stateFile, analysisFile, configFile, documentsFile, staticRoot,
    sourceFile: withoutCodeRepository ? null : sourceFile,
    sourceContent,
    designFile,
    designContent,
  };
}

async function startFixture(t, options = {}) {
  const fixture = createFixture(options);
  const server = createServer(fixture);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(() => {
    fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
    if (fixture.workspaceRoot !== fixture.projectRoot) {
      fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
    }
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

function evidenceManifest(sourceContent, overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    artifactType: 'evidence-manifest',
    artifactId: overrides.artifactId || 'evidence-run-one',
    createdAt: NOW,
    projectRevision: { kind: 'workspace', value: 'test-workspace' },
    entries: [{
      id: overrides.evidenceId || 'evidence-service-behavior',
      path: overrides.path || 'src/service.js',
      lineStart: 1,
      lineEnd: 3,
      summary: 'The service evaluates whether citations are present.',
      contentHash: overrides.contentHash || hash(sourceContent),
      basis: 'fact',
    }],
  };
}

function changeProposal() {
  return {
    schemaVersion: '1.0.0',
    artifactType: 'architecture-proposal',
    artifactId: 'proposal-evaluation-purpose',
    createdAt: NOW,
    requestId: 'request-evaluation-purpose',
    baseSnapshotId: 'snapshot-current-baseline',
    title: 'Clarify the processing module evidence gate',
    summary: 'Reflect the evidence evaluation responsibility observed in the repository.',
    options: [{
      id: 'option-evidence-gate',
      title: 'Document the existing gate',
      summary: 'Update the processing responsibility without changing layout.',
      advantages: ['Matches observed code.'],
      disadvantages: ['Requires human review.'],
    }],
    recommendedOptionId: 'option-evidence-gate',
    changes: [{
      id: 'change-processing-purpose',
      kind: 'update',
      targetType: 'node',
      targetId: 'processing-module',
      summary: 'Describe the evidence evaluation responsibility.',
      evidenceIds: ['evidence-service-behavior'],
      patch: { data: { purpose: 'Evaluates cited evidence before producing a controlled output.' } },
    }],
    acceptanceCriteria: ['The processing module visibly describes evidence evaluation.'],
    risks: [],
    decisionsRequired: [],
    evidenceManifest: 'evidence-manifest.json',
  };
}

function conceptProposal({
  artifactId = 'proposal-concept-governance',
  evidenceId = 'evidence-user-target-decision',
} = {}) {
  return {
    schemaVersion: '1.1.0',
    artifactType: 'architecture-proposal',
    artifactId,
    createdAt: NOW,
    requestId: 'request-concept-governance',
    baseSnapshotId: 'target-baseline-r0',
    title: 'Add a human-governed decision boundary',
    summary: 'Turn the confirmed product direction into a reviewable target architecture node.',
    options: [{
      id: 'option-governed-boundary',
      title: 'Explicit decision boundary',
      summary: 'Represent the human-controlled target boundary as a stable architecture responsibility.',
      advantages: ['Keeps user intent visible to coding agents.'],
      disadvantages: ['Still requires human review and publication.'],
    }],
    recommendedOptionId: 'option-governed-boundary',
    changes: [{
      id: 'change-add-governed-boundary',
      kind: 'add',
      targetType: 'node',
      targetId: 'human-decision-boundary',
      summary: 'Add the confirmed target responsibility.',
      evidenceIds: [evidenceId],
      patch: {
        data: {
          name: 'Human decision boundary',
          purpose: 'Keeps target architecture approval under explicit user control.',
          technical: 'External-agent handoff boundary',
          product: 'Architecture review gate',
          authorization: 'Only the user may approve and publish.',
          horizon: '近期',
        },
      },
    }],
    acceptanceCriteria: ['The target shows a human-controlled decision boundary.'],
    risks: ['The target remains a design until implementation is verified.'],
    decisionsRequired: [],
    evidenceManifest: 'evidence-manifest.json',
  };
}

function discussionEvidenceManifest() {
  return {
    schemaVersion: '1.1.0',
    artifactType: 'evidence-manifest',
    artifactId: 'evidence-concept-discussion',
    createdAt: NOW,
    projectRevision: { kind: 'workspace', value: 'concept-only' },
    entries: [{
      id: 'evidence-user-target-decision',
      sourceKind: 'discussion',
      basis: 'user-confirmed',
      sourceLabel: 'User and Codex target-design discussion',
      recordedAt: NOW,
      summary: 'The user confirmed that architecture approval and publication remain human controlled.',
      excerpt: 'The target architecture must remain under user review; the agent cannot approve or publish it.',
    }],
  };
}

function designEvidenceManifest(designContent) {
  return {
    schemaVersion: '1.1.0',
    artifactType: 'evidence-manifest',
    artifactId: 'evidence-concept-design',
    createdAt: NOW,
    projectRevision: { kind: 'workspace', value: 'concept-design' },
    entries: [{
      id: 'evidence-design-target-boundary',
      sourceKind: 'workspace-file',
      basis: 'design-document',
      path: 'docs/target-design.md',
      lineStart: 1,
      lineEnd: 3,
      summary: 'The Markdown design defines the intended human-governed boundary.',
      contentHash: hash(designContent),
    }],
  };
}

function implementationReport() {
  return {
    schemaVersion: '1.0.0',
    artifactType: 'implementation-report',
    artifactId: 'report-implementation-check',
    createdAt: NOW,
    requestId: 'request-implementation-check',
    approvedProposalId: 'proposal-approved-target',
    status: 'partial',
    resultingRevision: { kind: 'workspace', value: 'test-workspace' },
    changedFiles: ['src/service.js'],
    tests: [{ command: 'npm test', outcome: 'passed', summary: 'The observed fixture check passed.' }],
    acceptanceResults: [{
      criterion: 'The repository contains an evidence evaluation gate.',
      status: 'satisfied',
      evidenceIds: ['evidence-service-behavior'],
    }],
    drift: [{
      kind: 'changed',
      targetId: 'processing-module',
      summary: 'The implementation uses citation presence as its concrete gate.',
      evidenceIds: ['evidence-service-behavior'],
    }],
    unresolved: ['A human still needs to decide whether this gate is sufficient.'],
    evidenceManifest: 'evidence-manifest.json',
    resultingSnapshot: 'architecture-snapshot.json',
  };
}

function implementationEvidenceManifest(sourceContent, overrides = {}) {
  return {
    schemaVersion: '1.2.0',
    artifactType: 'evidence-manifest',
    artifactId: overrides.artifactId || 'evidence-implementation-v12',
    createdAt: NOW,
    projectRevision: { kind: 'workspace', value: overrides.revision || 'implementation-workspace' },
    entries: [{
      id: overrides.evidenceId || 'evidence-service-behavior',
      sourceKind: 'workspace-file',
      basis: 'code-fact',
      path: 'src/service.js',
      lineStart: 1,
      lineEnd: 3,
      summary: 'The implementation evidence supports the submitted architecture snapshot.',
      contentHash: hash(sourceContent),
    }],
  };
}

function implementationSnapshot(formalArchitecture, overrides = {}) {
  const nodes = formalArchitecture.graph.nodes.map((node) => ({
    id: node.id,
    name: node.data.name,
    purpose: node.data.purpose,
    technical: node.data.technical,
    product: node.data.product,
    authorization: node.data.authorization,
    evidenceIds: ['evidence-service-behavior'],
  }));
  const edges = formalArchitecture.graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.data.label,
    relationType: edge.data.relationType,
    controlledBoundaryPosture: edge.data.controlledBoundaryPosture,
    evidenceIds: ['evidence-service-behavior'],
  }));
  return {
    schemaVersion: '1.2.0',
    artifactType: 'architecture-snapshot',
    artifactId: overrides.artifactId || 'snapshot-implementation-v12',
    createdAt: NOW,
    project: {
      name: 'Implementation fixture',
      revision: { kind: 'workspace', value: overrides.revision || 'implementation-workspace' },
    },
    scope: { included: ['src'], excluded: ['node_modules'] },
    nodes,
    edges,
    assumptions: [],
    unknowns: [],
    evidenceManifest: 'evidence-manifest.json',
  };
}

function implementationReportV12(run, snapshot, overrides = {}) {
  return {
    schemaVersion: '1.2.0',
    artifactType: 'implementation-report',
    artifactId: overrides.artifactId || 'report-implementation-v12',
    createdAt: NOW,
    requestId: 'request-implementation-v12',
    approvedTarget: structuredClone(run.approvedTarget),
    status: overrides.status || 'partial',
    resultingRevision: structuredClone(snapshot.project.revision),
    changedFiles: ['src/service.js'],
    tests: overrides.tests || [{ command: 'npm test', outcome: 'passed', summary: 'All observed checks passed.' }],
    acceptanceResults: overrides.acceptanceResults || [{
      criterion: 'The implementation is reconciled with the published formal target.',
      status: 'satisfied',
      evidenceIds: ['evidence-service-behavior'],
    }],
    drift: overrides.drift || [],
    unresolved: overrides.unresolved || [],
    evidenceManifest: 'evidence-manifest.json',
    resultingSnapshotArtifactId: snapshot.artifactId,
  };
}

function advanceFormalTarget(stateFile) {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const prior = structuredClone(state.target.published);
  state.target.history.push(prior);
  state.target.published = {
    ...prior,
    revision: prior.revision + 1,
    revisionId: `target-r${prior.revision + 1}`,
    parentRevisionId: prior.revisionId,
    origin: 'publish',
    restoredFromRevisionId: null,
    message: 'Advance formal target during implementation',
    publishedAt: '2026-07-15T00:00:00.000Z',
    publishedBy: 'user',
  };
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function createRun(baseUrl, overrides = {}) {
  const result = await request(baseUrl, '/api/agent/runs', {
    method: 'POST',
    body: body({
      agentName: 'Codex',
      agentClient: 'codex',
      taskType: 'architecture-change-plan',
      view: 'current',
      summary: 'Prepare an evidence-backed architecture handoff.',
      ...overrides,
    }),
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return result.payload.run;
}

async function reviewImplementation(baseUrl, runId, decision, note) {
  const current = await request(baseUrl, '/api/analysis');
  return request(baseUrl, `/api/analysis/runs/${runId}/review`, {
    method: 'POST',
    body: body({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      baseRevision: current.payload.baseRevision,
      userConfirmed: true,
      decision,
      note,
    }),
  });
}

test('agent APIs expose local context without a model provider or approval capability', async (t) => {
  const fixture = await startFixture(t);
  const context = await request(fixture.baseUrl, '/api/agent/context?view=current');
  assert.equal(context.response.status, 200, JSON.stringify(context.payload));
  assert.equal(context.payload.workflow.createRunFirst, true);
  assert.equal(context.payload.workflow.implementationHumanReviewRequired, true);
  assert.equal(context.payload.workflow.agentCanReview, false);
  assert.equal(context.payload.workflow.agentCanApprove, false);
  assert.equal(context.payload.workflow.agentCanPublish, false);
  assert.equal(context.payload.selected.published.revision, 1);
  assert.equal(context.payload.selected.published.representation, 'semantic-graph-v1');
  assert.equal(context.payload.selected.published.graph.nodes[0].position, undefined);
  assert.equal(context.payload.selected.published.graph.nodes[0].width, undefined);
  assert.deepEqual(context.payload.workflow.supportedEvidenceBases, [
    'user-confirmed', 'design-document', 'code-fact', 'agent-inference',
  ]);

  const analysis = await request(fixture.baseUrl, '/api/analysis');
  assert.equal(analysis.payload.schemaVersion, ANALYSIS_SCHEMA_VERSION);
  assert.equal(analysis.payload.integration.mode, 'external-agent');
  assert.equal(analysis.payload.integration.modelProviderRequired, false);
  assert.equal(analysis.payload.integration.implementationHumanReviewRequired, true);
  assert.equal(analysis.payload.integration.agentCanReview, false);
  assert.equal(Object.hasOwn(analysis.payload, 'provider'), false);
});

test('agent evidence can be verified against a code workspace outside the viewer data package', async (t) => {
  const fixture = await startFixture(t, { separateWorkspace: true });
  const context = await request(fixture.baseUrl, '/api/agent/context?view=current');
  assert.equal(context.payload.workflow.separateWorkspaceConfigured, true);
  assert.equal(context.payload.workflow.evidencePathsAreWorkspaceRelative, true);
  assert.equal(JSON.stringify(context.payload).includes(fixture.workspaceRoot), false);

  const run = await createRun(fixture.baseUrl);
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: changeProposal(),
      evidenceManifest: evidenceManifest(fixture.sourceContent),
    }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
});

test('an external proposal is evidence-verified, human-reviewed, and applied only as a draft', async (t) => {
  const fixture = await startFixture(t);
  const run = await createRun(fixture.baseUrl);
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: changeProposal(),
      evidenceManifest: evidenceManifest(fixture.sourceContent),
    }),
  });
  assert.equal(submitted.response.status, 201);
  assert.equal(submitted.payload.run.status, 'submitted');
  assert.equal(submitted.payload.permissions.canApprove, false);
  assert.equal(submitted.payload.submission.proposalId, 'proposal-evaluation-purpose');
  assert.equal(submitted.payload.proposals[0].status, 'pending');

  const analysis = await request(fixture.baseUrl, '/api/analysis');
  const proposal = analysis.payload.proposals.find((item) => item.id === 'proposal-evaluation-purpose');
  assert.equal(proposal.origin.agentName, 'Codex');
  assert.equal(proposal.evidence.length, 1);
  assert.equal(proposal.changes[0].patch.position, undefined);

  const accepted = await request(fixture.baseUrl, `/api/analysis/proposals/${proposal.id}/accept`, {
    method: 'POST',
    body: body({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      baseRevision: analysis.payload.baseRevision,
      userConfirmed: true,
    }),
  });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.payload));
  assert.equal(accepted.payload.analysis.proposals[0].status, 'accepted');
  assert.equal(accepted.payload.lane.draft.graph.nodes.find((node) => node.id === 'processing-module').data.purpose,
    'Evaluates cited evidence before producing a controlled output.');
  assert.equal(accepted.payload.lane.published.graph.nodes.find((node) => node.id === 'processing-module').data.purpose,
    '执行通用处理。');

  const status = await request(fixture.baseUrl, `/api/agent/runs/${run.id}`);
  assert.equal(status.payload.run.status, 'reviewed');
  assert.equal(status.payload.permissions.canPublish, false);
});

test('a concept project can complete the target-proposal loop from user-confirmed discussion without code', async (t) => {
  const fixture = await startFixture(t, { withoutCodeRepository: true, clearTargetDraft: true });
  assert.equal(fixture.sourceFile, null);
  assert.equal(fs.existsSync(path.join(fixture.workspaceRoot, 'src')), false);

  const run = await createRun(fixture.baseUrl, {
    view: 'target',
    summary: 'Turn the confirmed discussion into a concept-project target proposal.',
  });
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: conceptProposal(), evidenceManifest: discussionEvidenceManifest() }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
  assert.equal(submitted.payload.permissions.canApprove, false);
  assert.equal(submitted.payload.permissions.canPublish, false);

  const analysis = await request(fixture.baseUrl, '/api/analysis');
  const proposal = analysis.payload.proposals.find((item) => item.id === 'proposal-concept-governance');
  assert.equal(proposal.view, 'target');
  assert.deepEqual({
    sourceKind: proposal.evidence[0].sourceKind,
    basis: proposal.evidence[0].basis,
    sourceLabel: proposal.evidence[0].sourceLabel,
    path: proposal.evidence[0].path,
  }, {
    sourceKind: 'discussion',
    basis: 'user-confirmed',
    sourceLabel: 'User and Codex target-design discussion',
    path: null,
  });

  const accepted = await request(fixture.baseUrl, `/api/analysis/proposals/${proposal.id}/accept`, {
    method: 'POST',
    body: body({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      baseRevision: analysis.payload.baseRevision,
      userConfirmed: true,
    }),
  });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.payload));
  assert.equal(accepted.payload.lane.published.graph.nodes.length, 0, 'acceptance must not alter the published target');
  assert.equal(accepted.payload.lane.draft.graph.nodes[0].id, 'human-decision-boundary');

  const formalTargetBeforePublish = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.equal(formalTargetBeforePublish.payload.approvalStatus, 'published-target');
  assert.equal(formalTargetBeforePublish.payload.baselineStatus, 'formal-baseline');
  assert.equal(formalTargetBeforePublish.payload.architecture.revisionId, accepted.payload.lane.published.revisionId);
  assert.equal(formalTargetBeforePublish.payload.architecture.graph.nodes.length, 0);
  assert.equal('approvedProposalIds' in formalTargetBeforePublish.payload, false);

  const reviewBeforePublish = await request(fixture.baseUrl, `/api/agent/runs/${run.id}`);
  const acceptedProposal = reviewBeforePublish.payload.proposals.find((item) => item.id === proposal.id);
  assert.equal(acceptedProposal.publication.status, 'awaiting-publication');
  assert.equal(acceptedProposal.publication.summary, proposal.summary);

  const lane = accepted.payload.lane;
  const published = await request(fixture.baseUrl, '/api/publish?view=target', {
    method: 'POST',
    body: body({
      schemaVersion: lane.schemaVersion,
      expectedHeadRevision: lane.published.revision,
      expectedHeadRevisionId: lane.published.revisionId,
      expectedDraftId: lane.draft.draftId,
      expectedDraftRevision: lane.draft.draftRevision,
      message: 'User publishes the confirmed concept target',
      userConfirmed: true,
    }),
  });
  assert.equal(published.response.status, 200, JSON.stringify(published.payload));

  const approvedTarget = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.equal(approvedTarget.payload.approvalStatus, 'published-target');
  assert.equal(approvedTarget.payload.baselineStatus, 'formal-baseline');
  assert.equal(approvedTarget.payload.architecture.graph.nodes[0].id, 'human-decision-boundary');
  assert.equal(approvedTarget.payload.architecture.graph.nodes[0].data.authorization, 'Only the user may approve and publish.');
  assert.equal(JSON.stringify(approvedTarget.payload.architecture).includes('position'), false);
  assert.equal(JSON.stringify(approvedTarget.payload.architecture).includes('documentRefs'), false);

  const reviewAfterPublish = await request(fixture.baseUrl, `/api/agent/runs/${run.id}`);
  assert.equal(reviewAfterPublish.payload.proposals[0].publication, null);
});

test('a Markdown design can support a target proposal without any code repository', async (t) => {
  const fixture = await startFixture(t, { withoutCodeRepository: true, clearTargetDraft: true });
  const run = await createRun(fixture.baseUrl, { view: 'target' });
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: conceptProposal({
        artifactId: 'proposal-markdown-target',
        evidenceId: 'evidence-design-target-boundary',
      }),
      evidenceManifest: designEvidenceManifest(fixture.designContent),
    }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
  const analysis = await request(fixture.baseUrl, '/api/analysis');
  const proposal = analysis.payload.proposals.find((item) => item.id === 'proposal-markdown-target');
  assert.equal(proposal.evidence[0].basis, 'design-document');
  assert.equal(proposal.evidence[0].sourceKind, 'workspace-file');
  assert.equal(proposal.evidence[0].path, 'docs/target-design.md');
});

test('discussion and design intent cannot be submitted as current implementation facts', async (t) => {
  const fixture = await startFixture(t, { withoutCodeRepository: true });
  const run = await createRun(fixture.baseUrl, { view: 'current' });
  const discussion = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: conceptProposal(), evidenceManifest: discussionEvidenceManifest() }),
  });
  assert.equal(discussion.response.status, 422);
  assert.equal(discussion.payload.code, 'AGENT_EVIDENCE_BASIS_FORBIDDEN');

  const design = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: conceptProposal({
        artifactId: 'proposal-false-current-design',
        evidenceId: 'evidence-design-target-boundary',
      }),
      evidenceManifest: designEvidenceManifest(fixture.designContent),
    }),
  });
  assert.equal(design.response.status, 422);
  assert.equal(design.payload.code, 'AGENT_EVIDENCE_BASIS_FORBIDDEN');

  const mislabeledManifest = designEvidenceManifest(fixture.designContent);
  mislabeledManifest.artifactId = 'evidence-mislabeled-markdown';
  mislabeledManifest.entries[0].basis = 'code-fact';
  const mislabeled = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: conceptProposal({
        artifactId: 'proposal-mislabeled-markdown',
        evidenceId: 'evidence-design-target-boundary',
      }),
      evidenceManifest: mislabeledManifest,
    }),
  });
  assert.equal(mislabeled.response.status, 422);
  assert.equal(mislabeled.payload.code, 'AGENT_EVIDENCE_BASIS_INVALID');
  const after = await request(fixture.baseUrl, '/api/analysis');
  assert.equal(after.payload.proposals.length, 0);
  assert.equal(after.payload.evidence.length, 0);
});

test('a migrated current proposal backed by design intent stays readable but cannot be accepted', async (t) => {
  const fixture = await startFixture(t, { withoutCodeRepository: true, clearTargetDraft: true });
  const run = await createRun(fixture.baseUrl, { view: 'target' });
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: conceptProposal({
        artifactId: 'proposal-legacy-design-current',
        evidenceId: 'evidence-design-target-boundary',
      }),
      evidenceManifest: designEvidenceManifest(fixture.designContent),
    }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));

  const stored = JSON.parse(fs.readFileSync(fixture.analysisFile, 'utf8'));
  const currentState = JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8')).current;
  stored.proposals[0].view = 'current';
  stored.proposals[0].baseRevision = currentState.published.revision;
  stored.proposals[0].baseRevisionId = currentState.published.revisionId;
  stored.agentRuns[0].view = 'current';
  stored.agentRuns[0].baseRevision = currentState.published.revision;
  stored.agentRuns[0].baseRevisionId = currentState.published.revisionId;
  fs.writeFileSync(fixture.analysisFile, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

  const readable = await request(fixture.baseUrl, '/api/analysis');
  assert.equal(readable.response.status, 200);
  assert.equal(readable.payload.proposals[0].evidence[0].basis, 'design-document');
  const accepted = await request(fixture.baseUrl, '/api/analysis/proposals/proposal-legacy-design-current/accept', {
    method: 'POST',
    body: body({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      baseRevision: readable.payload.baseRevision,
      userConfirmed: true,
    }),
  });
  assert.equal(accepted.response.status, 422);
  assert.equal(accepted.payload.code, 'PROPOSAL_EVIDENCE_BASIS_FORBIDDEN');
});

test('agent submissions reject stale evidence before entering the review inbox', async (t) => {
  const fixture = await startFixture(t);
  const run = await createRun(fixture.baseUrl);
  const stale = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: changeProposal(),
      evidenceManifest: evidenceManifest(fixture.sourceContent, { contentHash: 'a'.repeat(64) }),
    }),
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.code, 'AGENT_EVIDENCE_STALE');
  const after = await request(fixture.baseUrl, '/api/analysis');
  assert.equal(after.payload.proposals.length, 0);
  assert.equal(after.payload.runs[0].status, 'active');
});

test('agent runs reject mismatched artifact types and incomplete evidence manifests', async (t) => {
  const fixture = await startFixture(t);
  const run = await createRun(fixture.baseUrl);
  const snapshot = {
    schemaVersion: '1.0.0',
    artifactType: 'architecture-snapshot',
    artifactId: 'snapshot-wrong-task',
    createdAt: NOW,
    project: { name: 'Fixture', revision: { kind: 'workspace', value: 'test-workspace' } },
    scope: { included: ['src/service.js'], excluded: [] },
    nodes: [{
      id: 'processing-module',
      name: '处理模块',
      purpose: 'Evaluates repository evidence.',
      technical: '已实现',
      product: '当前模块',
      authorization: '不越过已确认边界。',
      evidenceIds: ['evidence-service-behavior'],
    }],
    edges: [],
    assumptions: [],
    unknowns: [],
    evidenceManifest: 'evidence-manifest.json',
  };
  const mismatch = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: snapshot, evidenceManifest: evidenceManifest(fixture.sourceContent) }),
  });
  assert.equal(mismatch.response.status, 422);
  assert.equal(mismatch.payload.code, 'AGENT_ARTIFACT_TYPE_MISMATCH');

  const incompleteManifest = evidenceManifest(fixture.sourceContent, { evidenceId: 'evidence-other' });
  const incomplete = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: changeProposal(), evidenceManifest: incompleteManifest }),
  });
  assert.equal(incomplete.response.status, 422);
  assert.equal(incomplete.payload.code, 'AGENT_EVIDENCE_MANIFEST_INCOMPLETE');
});

test('an aligned implementation reaches human review but cannot complete itself', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const run = await createRun(fixture.baseUrl, {
    taskType: 'implementation-reconcile',
    view: 'current',
    summary: 'Reconcile implemented code with the published formal target.',
  });
  assert.equal(run.approvedTarget.status, 'formal-baseline');
  assert.equal(run.approvedTarget.diagramId, run.diagramId);
  assert.equal(run.approvedTarget.revision, 1);
  assert.equal(run.approvedTarget.revisionId, 'target-r1');
  assert.match(run.approvedTarget.semanticHash, /^[a-f0-9]{64}$/);

  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.deepEqual(run.approvedTarget, approved.payload.formalBaseline);
  const snapshot = implementationSnapshot(approved.payload.architecture);
  const snapshotSubmitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: snapshot,
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent),
    }),
  });
  assert.equal(snapshotSubmitted.response.status, 201, JSON.stringify(snapshotSubmitted.payload));

  const reportArtifact = implementationReportV12(run, snapshot, { status: 'complete' });
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: reportArtifact,
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, {
        artifactId: 'evidence-implementation-report-v12',
      }),
    }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
  assert.equal(submitted.payload.submission.requiresHumanReview, true);
  assert.equal(submitted.payload.submission.reviewType, 'implementation-result');
  assert.equal(submitted.payload.proposals.length, 0);
  const report = submitted.payload.artifacts.find((artifact) => artifact.artifactType === 'implementation-report');
  assert.deepEqual(report.summary, {
    status: 'complete',
    changedFileCount: 1,
    passedCheckCount: 1,
    failedCheckCount: 0,
    acceptedCriterionCount: 1,
    criterionCount: 1,
    driftCount: 0,
    unresolvedCount: 0,
  });
  assert.deepEqual(submitted.payload.run.agentClaim, {
    status: 'complete',
    reportArtifactId: reportArtifact.artifactId,
    claimedAt: submitted.payload.run.agentClaim.claimedAt,
  });
  assert.equal(submitted.payload.run.architectureGate.status, 'aligned');
  assert.equal(submitted.payload.run.architectureGate.readyForHumanReview, true);
  assert.equal(submitted.payload.run.humanReview, null);
  assert.equal(submitted.payload.run.status, 'submitted');
  assert.equal(submitted.payload.permissions.requiresHumanReview, true);
  assert.equal(submitted.payload.permissions.agentCanReview, false);
  assert.equal('drift' in submitted.payload.run.architectureGate, false, 'default review response stays compact');

  const detailed = await request(fixture.baseUrl, `/api/agent/runs/${run.id}?details=architecture-gate`);
  assert.equal(detailed.payload.run.architectureGate.status, 'aligned');
  assert.deepEqual(detailed.payload.run.architectureGate.drift, []);
  assert.equal(detailed.payload.run.architectureGate.crossCheck.matches, true);

  const analysisBeforeReview = await request(fixture.baseUrl, '/api/analysis');
  const unconfirmed = await request(fixture.baseUrl, `/api/analysis/runs/${run.id}/review`, {
    method: 'POST',
    body: body({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      baseRevision: analysisBeforeReview.payload.baseRevision,
      userConfirmed: false,
      decision: 'accepted',
      note: 'This must not be accepted without an explicit local-user confirmation.',
    }),
  });
  assert.equal(unconfirmed.response.status, 403);
  assert.equal(unconfirmed.payload.code, 'USER_CONFIRMATION_REQUIRED');

  const reviewed = await reviewImplementation(
    fixture.baseUrl,
    run.id,
    'accepted',
    'The user reviewed the architecture gate and accepts this implementation result.',
  );
  assert.equal(reviewed.response.status, 200, JSON.stringify(reviewed.payload));
  const reviewedRun = reviewed.payload.runs.find((item) => item.id === run.id);
  assert.equal(reviewedRun.status, 'reviewed');
  assert.equal(reviewedRun.humanReview.decision, 'accepted');
  assert.equal(reviewedRun.humanReview.reviewer, 'local-user');
  assert.match(reviewedRun.humanReview.reviewedAt, /^\d{4}-\d{2}-\d{2}T/);

  const reviewStatus = await request(fixture.baseUrl, `/api/agent/runs/${run.id}`);
  assert.equal(reviewStatus.payload.run.agentClaim.status, 'complete');
  assert.equal(reviewStatus.payload.run.architectureGate.status, 'aligned');
  assert.equal('drift' in reviewStatus.payload.run.architectureGate, false);
  assert.equal(reviewStatus.payload.run.humanReview.decision, 'accepted');
});

test('the architecture gate saves missing, extra, semantic, boundary, and unverified drift with agent explanations pending human judgment', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const run = await createRun(fixture.baseUrl, {
    taskType: 'implementation-reconcile',
    view: 'current',
  });
  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  const snapshot = implementationSnapshot(approved.payload.architecture, { artifactId: 'snapshot-drift-v12' });
  snapshot.edges = snapshot.edges.filter((edge) => edge.id !== 'edge-input-processing');
  snapshot.nodes.find((node) => node.id === 'processing-module').authorization = 'Implementation bypasses the confirmed boundary.';
  snapshot.edges.find((edge) => edge.id === 'edge-processing-output').controlledBoundaryPosture = 'controlled';
  snapshot.nodes.push({
    id: 'extra-module',
    name: 'Extra module',
    purpose: 'An implementation responsibility outside the formal target.',
    technical: 'Observed module',
    product: 'Unplanned behavior',
    authorization: 'Not yet approved',
    evidenceIds: ['evidence-service-behavior'],
  });
  const snapshotSubmitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: snapshot,
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, { artifactId: 'evidence-drift-snapshot' }),
    }),
  });
  assert.equal(snapshotSubmitted.response.status, 201, JSON.stringify(snapshotSubmitted.payload));

  const report = implementationReportV12(run, snapshot, {
    artifactId: 'report-drift-v12',
    drift: [
      { kind: 'missing', targetId: 'edge-input-processing', summary: 'The implementation omitted this relationship.', evidenceIds: ['evidence-service-behavior'] },
      { kind: 'extra', targetId: 'extra-module', summary: 'The implementation added an unplanned module.', evidenceIds: ['evidence-service-behavior'] },
      { kind: 'changed', targetId: 'processing-module', summary: 'The implemented authority boundary differs.', evidenceIds: ['evidence-service-behavior'] },
      { kind: 'changed', targetId: 'edge-processing-output', summary: 'The controlled boundary was weakened.', evidenceIds: ['evidence-service-behavior'] },
      { kind: 'unverified', targetId: 'output-module', summary: 'The output behavior needs additional human verification.', evidenceIds: [] },
    ],
    unresolved: ['The unverified output behavior remains open.'],
  });
  const reportSubmitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: report,
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, { artifactId: 'evidence-drift-report' }),
    }),
  });
  assert.equal(reportSubmitted.response.status, 201, JSON.stringify(reportSubmitted.payload));
  assert.equal(reportSubmitted.payload.submission.requiresHumanReview, true);
  assert.equal(reportSubmitted.payload.run.humanReview, null);

  const detailed = await request(fixture.baseUrl, `/api/agent/runs/${run.id}?details=architecture-gate`);
  const architectureGate = detailed.payload.run.architectureGate;
  assert.equal(architectureGate.status, 'unresolved-drift');
  assert.deepEqual(architectureGate.counts, {
    missing: 1,
    extra: 1,
    changed: 2,
    unverified: 1,
    unexplained: 0,
    unreported: 0,
    unsupported: 0,
  });
  assert.equal(architectureGate.crossCheck.matches, true);
  assert.equal(architectureGate.readyForHumanReview, false);
  assert.equal(architectureGate.drift.every((item) => item.id.startsWith('drift-')), true);
  assert.equal(architectureGate.drift.every((item) => item.explanation.status === 'agent-provided'), true);
  const boundaryDrift = architectureGate.drift.find((item) => item.targetId === 'edge-processing-output');
  assert.equal(boundaryDrift.targetType, 'edge');
  assert.deepEqual(boundaryDrift.changedFields, ['controlledBoundaryPosture']);
  assert.equal(boundaryDrift.target.controlledBoundaryPosture, 'blocked');
  assert.equal(boundaryDrift.actual.controlledBoundaryPosture, 'controlled');
  assert.ok(boundaryDrift.evidenceIds.includes('evidence-service-behavior'));

  const analysis = await request(fixture.baseUrl, '/api/analysis');
  const stored = analysis.payload.runs.find((item) => item.id === run.id).architectureGate;
  assert.equal(stored.drift.length, 5, 'the local human workspace receives full drift detail');
});

test('an agent complete claim cannot bypass an unresolved architecture gate or human acceptance', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const run = await createRun(fixture.baseUrl, { taskType: 'implementation-reconcile', view: 'current' });
  const approvedBefore = await request(fixture.baseUrl, '/api/agent/approved-target');
  const snapshot = implementationSnapshot(approvedBefore.payload.architecture, { artifactId: 'snapshot-unreported-v12' });
  snapshot.nodes.find((node) => node.id === 'processing-module').purpose = 'An implementation purpose that differs from the formal target.';
  const snapshotSubmitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: snapshot,
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, { artifactId: 'evidence-unreported-snapshot' }),
    }),
  });
  assert.equal(snapshotSubmitted.response.status, 201);

  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: implementationReportV12(run, snapshot, { status: 'complete' }),
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, { artifactId: 'evidence-unreported-report' }),
    }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
  assert.equal(submitted.payload.run.agentClaim.status, 'complete');
  assert.equal(submitted.payload.run.architectureGate.status, 'unresolved-drift');
  assert.equal(submitted.payload.run.architectureGate.readyForHumanReview, false);
  assert.equal(submitted.payload.run.architectureGate.counts.changed, 1);
  assert.equal(submitted.payload.run.architectureGate.counts.unreported, 1);
  assert.equal(submitted.payload.run.humanReview, null);

  const cannotAccept = await reviewImplementation(
    fixture.baseUrl,
    run.id,
    'accepted',
    'The user must not be able to accept an unresolved automatic architecture gate.',
  );
  assert.equal(cannotAccept.response.status, 409);
  assert.equal(cannotAccept.payload.code, 'IMPLEMENTATION_GATE_NOT_READY');

  const revisionRequested = await reviewImplementation(
    fixture.baseUrl,
    run.id,
    'revision-requested',
    'Explain and reconcile the server-computed responsibility drift before acceptance.',
  );
  assert.equal(revisionRequested.response.status, 200, JSON.stringify(revisionRequested.payload));
  const reviewedRun = revisionRequested.payload.runs.find((item) => item.id === run.id);
  assert.equal(reviewedRun.humanReview.decision, 'revision-requested');
  assert.equal(reviewedRun.status, 'reviewed');

  const approvedAfter = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.deepEqual(approvedAfter.payload.formalBaseline, approvedBefore.payload.formalBaseline);
});

test('fully agent-described drift only becomes ready until a user explicitly accepts it', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const run = await createRun(fixture.baseUrl, { taskType: 'implementation-reconcile', view: 'current' });
  const approvedBefore = await request(fixture.baseUrl, '/api/agent/approved-target');
  const snapshot = implementationSnapshot(approvedBefore.payload.architecture, { artifactId: 'snapshot-explained-v12' });
  snapshot.nodes.find((node) => node.id === 'processing-module').purpose = 'A deliberately deviating implementation responsibility.';
  const snapshotSubmitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: snapshot,
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, { artifactId: 'evidence-explained-snapshot' }),
    }),
  });
  assert.equal(snapshotSubmitted.response.status, 201);

  const report = implementationReportV12(run, snapshot, {
    status: 'complete',
    artifactId: 'report-explained-v12',
    drift: [{
      kind: 'changed',
      targetId: 'processing-module',
      summary: 'The implementation intentionally uses a different responsibility and requires a future target proposal.',
      evidenceIds: ['evidence-service-behavior'],
    }],
  });
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: report,
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, { artifactId: 'evidence-explained-report' }),
    }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
  assert.equal(submitted.payload.submission.requiresHumanReview, true);
  assert.equal(submitted.payload.run.agentClaim.status, 'complete');
  assert.equal(submitted.payload.run.architectureGate.status, 'explained-drift');
  assert.equal(submitted.payload.run.architectureGate.readyForHumanReview, true);
  assert.equal(submitted.payload.run.humanReview, null);
  assert.equal(submitted.payload.run.status, 'submitted');

  const detailedBeforeReview = await request(fixture.baseUrl, `/api/agent/runs/${run.id}?details=architecture-gate`);
  assert.equal(
    detailedBeforeReview.payload.run.architectureGate.drift[0].explanation.status,
    'agent-provided',
  );

  const humanAccepted = await reviewImplementation(
    fixture.baseUrl,
    run.id,
    'accepted',
    'The user knowingly accepts this implementation deviation for this run only.',
  );
  assert.equal(humanAccepted.response.status, 200, JSON.stringify(humanAccepted.payload));
  const reviewedRun = humanAccepted.payload.runs.find((item) => item.id === run.id);
  assert.equal(reviewedRun.humanReview.decision, 'accepted');
  assert.equal(reviewedRun.humanReview.note, 'The user knowingly accepts this implementation deviation for this run only.');
  assert.equal(reviewedRun.status, 'reviewed');

  const approvedAfter = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.deepEqual(approvedAfter.payload.formalBaseline, approvedBefore.payload.formalBaseline);
  assert.equal(
    approvedAfter.payload.architecture.graph.nodes.find((node) => node.id === 'processing-module').data.purpose,
    approvedBefore.payload.architecture.graph.nodes.find((node) => node.id === 'processing-module').data.purpose,
    'an explained implementation deviation must not rewrite the formal target',
  );
});

test('a local human rejection is traceable and never changes the formal target', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const run = await createRun(fixture.baseUrl, { taskType: 'implementation-reconcile', view: 'current' });
  const approvedBefore = await request(fixture.baseUrl, '/api/agent/approved-target');
  const snapshot = implementationSnapshot(approvedBefore.payload.architecture, { artifactId: 'snapshot-human-reject-v12' });
  const snapshotSubmitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: snapshot,
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, { artifactId: 'evidence-human-reject-snapshot' }),
    }),
  });
  assert.equal(snapshotSubmitted.response.status, 201);
  const reportSubmitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: implementationReportV12(run, snapshot, { artifactId: 'report-human-reject-v12', status: 'complete' }),
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, { artifactId: 'evidence-human-reject-report' }),
    }),
  });
  assert.equal(reportSubmitted.response.status, 201, JSON.stringify(reportSubmitted.payload));
  assert.equal(reportSubmitted.payload.run.architectureGate.status, 'aligned');
  assert.equal(reportSubmitted.payload.run.humanReview, null);

  const rejected = await reviewImplementation(
    fixture.baseUrl,
    run.id,
    'rejected',
    'The architecture graph aligns, but the user rejects the actual product experience.',
  );
  assert.equal(rejected.response.status, 200, JSON.stringify(rejected.payload));
  const reviewedRun = rejected.payload.runs.find((item) => item.id === run.id);
  assert.equal(reviewedRun.humanReview.decision, 'rejected');
  assert.equal(reviewedRun.humanReview.reviewer, 'local-user');
  assert.equal(reviewedRun.status, 'reviewed');

  const approvedAfter = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.deepEqual(approvedAfter.payload.formalBaseline, approvedBefore.payload.formalBaseline);
  assert.deepEqual(approvedAfter.payload.architecture, approvedBefore.payload.architecture);
});

test('implementation reports require a snapshot first and stale formal target locks cannot submit', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  const snapshot = implementationSnapshot(approved.payload.architecture, { artifactId: 'snapshot-order-v12' });
  const run = await createRun(fixture.baseUrl, { taskType: 'implementation-reconcile', view: 'current' });
  const legacyBypass = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: implementationReport(),
      evidenceManifest: evidenceManifest(fixture.sourceContent, { artifactId: 'evidence-legacy-bypass' }),
    }),
  });
  assert.equal(legacyBypass.response.status, 422);
  assert.equal(legacyBypass.payload.code, 'AGENT_PROTOCOL_UPGRADE_REQUIRED');

  const reportFirst = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: implementationReportV12(run, snapshot),
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, { artifactId: 'evidence-report-first' }),
    }),
  });
  assert.equal(reportFirst.response.status, 422);
  assert.equal(reportFirst.payload.code, 'AGENT_RESULTING_SNAPSHOT_REQUIRED');

  advanceFormalTarget(fixture.stateFile);
  const stale = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: snapshot,
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, { artifactId: 'evidence-stale-target' }),
    }),
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.code, 'AGENT_APPROVED_TARGET_STALE');
  assert.equal(stale.payload.details.expected.revisionId, 'target-r1');
  assert.equal(stale.payload.details.actual.revisionId, 'target-r2');
});

test('architecture snapshots become additive semantic diffs and never remove omitted nodes', async (t) => {
  const fixture = await startFixture(t);
  const run = await createRun(fixture.baseUrl, {
    taskType: 'architecture-discovery',
    view: 'current',
    summary: 'Refresh the current architecture from repository evidence.',
  });
  const snapshot = {
    schemaVersion: '1.0.0',
    artifactType: 'architecture-snapshot',
    artifactId: 'snapshot-agent-understanding',
    createdAt: NOW,
    project: { name: 'Fixture', revision: { kind: 'workspace', value: 'test-workspace' } },
    scope: { included: ['src/service.js'], excluded: [] },
    nodes: [{
      id: 'processing-module',
      name: '处理模块',
      purpose: 'Evaluates repository evidence.',
      technical: '已实现',
      product: '当前模块',
      authorization: '不越过已确认边界。',
      evidenceIds: ['evidence-service-behavior'],
    }],
    edges: [],
    assumptions: [],
    unknowns: ['The omitted nodes were outside this inspection scope.'],
    evidenceManifest: 'evidence-manifest.json',
  };
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: snapshot,
      evidenceManifest: evidenceManifest(fixture.sourceContent, { artifactId: 'evidence-snapshot-run' }),
    }),
  });
  assert.equal(submitted.response.status, 201);
  const analysis = await request(fixture.baseUrl, '/api/analysis');
  const proposal = analysis.payload.proposals[0];
  assert.equal(proposal.origin.artifactType, 'architecture-snapshot');
  assert.equal(proposal.changes.some((change) => change.kind === 'remove'), false);
  assert.equal(proposal.changes[0].targetId, 'processing-module');
});

test('approved target always exposes only the published formal baseline', async (t) => {
  const fixture = await startFixture(t);
  const target = await request(fixture.baseUrl, '/api/state?view=target');
  assert.equal(target.response.status, 200);
  assert.ok(target.payload.draft, 'fixture should contain an ordinary target draft');

  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.equal(approved.response.status, 200);
  assert.equal(approved.payload.approvalStatus, 'published-target');
  assert.equal(approved.payload.baselineStatus, 'formal-baseline');
  assert.equal(approved.payload.formalBaseline.revisionId, target.payload.published.revisionId);
  assert.match(approved.payload.formalBaseline.semanticHash, /^[a-f0-9]{64}$/);
  assert.equal(approved.payload.architecture.revisionId, target.payload.published.revisionId);
  assert.deepEqual(
    approved.payload.architecture.graph.nodes.map((node) => node.id),
    target.payload.published.graph.nodes.map((node) => node.id),
  );
  assert.equal(approved.payload.architecture.representation, 'semantic-graph-v1');
  assert.equal(JSON.stringify(approved.payload.architecture).includes('position'), false);
});

test('agent evidence paths stay inside the repository and avoid sensitive directories', async (t) => {
  const fixture = await startFixture(t);
  const run = await createRun(fixture.baseUrl);
  const unsafe = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: changeProposal(),
      evidenceManifest: evidenceManifest(fixture.sourceContent, { path: 'credentials/token.js' }),
    }),
  });
  assert.equal(unsafe.response.status, 422);
  assert.equal(unsafe.payload.code, 'ANALYSIS_SOURCE_NOT_ALLOWED');
});

test('skill catalog API exposes the three bundled workflows without absolute paths', async (t) => {
  const fixture = await startFixture(t);
  const result = await request(fixture.baseUrl, '/api/skills');
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.protocolVersion, '1.2.0');
  assert.deepEqual(result.payload.skills.map((skill) => skill.id), [
    'architecture-discovery',
    'architecture-change-plan',
    'implementation-reconcile',
  ]);
  assert.equal(result.payload.skills.some((skill) => path.isAbsolute(skill.skillPath)), false);
  assert.equal(JSON.stringify(result.payload).includes(fixture.projectRoot), false);
});
