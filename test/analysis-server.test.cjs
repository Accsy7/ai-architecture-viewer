'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServer } = require('../server.js');
const { ANALYSIS_SCHEMA_VERSION } = require('../schema/analysis-contract.cjs');
const {
  DEVELOPMENT_CONTRACT_SCHEMA_VERSION,
  migrateLegacyState,
} = require('../schema/state-contract.cjs');

const ROOT = path.resolve(__dirname, '..');
const V2_STATE = path.join(__dirname, 'fixtures', 'generic-state-v2.json');
const DEMO_CONFIG = path.join(ROOT, 'projects', 'demo', 'viewer.config.json');
const DEMO_DOCUMENTS = path.join(ROOT, 'projects', 'demo', 'document-registry.json');
const NOW = '2020-01-01T00:00:00.000Z';

function hash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function hashJson(value) {
  return hash(JSON.stringify(canonicalize(value)));
}

function contractDocumentBindingForTest(document) {
  return {
    id: document.id,
    status: document.status,
    authority: document.authority,
    path: document.path,
    contentHash: document.contentHash,
  };
}

function semanticGraphHash(revision) {
  const nodeFields = [
    'name', 'group', 'purpose', 'technical', 'product', 'authorization', 'horizon',
    'focus', 'buildStrategy', 'aiCollaboration', 'relatedDiagramId', 'relatedNodeId',
    'documentRefs', 'interactionModes', 'architectureLayer',
  ];
  const edgeFields = ['label', 'relationType', 'controlledBoundaryPosture'];
  const pick = (value, fields) => Object.fromEntries(fields
    .filter((field) => value[field] !== undefined)
    .map((field) => [field, value[field]]));
  return hashJson({
    nodes: revision.graph.nodes.map((node) => ({
      id: node.id,
      ...(node.type ? { type: node.type } : {}),
      data: pick(node.data, nodeFields),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    edges: revision.graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: pick(edge.data, edgeFields),
    })).sort((left, right) => left.id.localeCompare(right.id)),
  });
}

function executableContract(revision) {
  const targetRefs = [
    ...revision.graph.nodes.map((node) => ({ targetType: 'node', targetId: node.id })),
    ...revision.graph.edges.map((edge) => ({ targetType: 'edge', targetId: edge.id })),
  ].sort((left, right) => `${left.targetType}:${left.targetId}`.localeCompare(`${right.targetType}:${right.targetId}`));
  const boundaryRefs = [
    ...revision.graph.nodes.map((node) => ({
      targetType: 'node', targetId: node.id, field: 'authorization', value: node.data.authorization,
    })),
    ...revision.graph.edges.map((edge) => ({
      targetType: 'edge', targetId: edge.id, field: 'controlledBoundaryPosture', value: edge.data.controlledBoundaryPosture,
    })),
  ].sort((left, right) => `${left.targetType}:${left.targetId}:${left.field}`.localeCompare(`${right.targetType}:${right.targetId}:${right.field}`));
  const contract = {
    schemaVersion: DEVELOPMENT_CONTRACT_SCHEMA_VERSION,
    status: 'executable',
    contractId: `contract-${revision.revisionId}`,
    target: {
      revision: revision.revision,
      revisionId: revision.revisionId,
      semanticHash: semanticGraphHash(revision),
    },
    source: { proposalId: 'proposal-approved-target', requestId: 'request-approved-target', artifactId: null, runId: null },
    acceptanceCriteria: [
      {
        id: 'criterion-formal-target-aligned',
        statement: 'The implementation is reconciled with the published formal target.',
        targetRefs,
      },
      {
        id: 'criterion-boundaries-preserved',
        statement: 'The implementation preserves the published permission and controlled-boundary semantics.',
        targetRefs,
      },
    ],
    targetRefs,
    boundaryRefs,
    documents: [],
    frozenAt: '2026-07-14T00:00:00.000Z',
    frozenBy: 'user',
    contractHash: null,
    documentSetHash: hashJson([]),
    executionReason: null,
  };
  const { contractHash: ignored, ...content } = contract;
  contract.contractHash = hashJson(content);
  return contract;
}

function createFixture({
  separateWorkspace = false,
  withoutCodeRepository = false,
  clearTargetDraft = false,
  targetFromCurrent = false,
  configuredGroups = false,
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
  const registeredDocumentFile = path.join(projectRoot, 'documents', 'registered-target.md');
  const sourceContent = [
    'export function evaluateEvidence(candidate) {',
    '  return candidate.citations.length > 0;',
    '}',
  ].join('\n');
  if (!withoutCodeRepository) fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.mkdirSync(path.dirname(designFile), { recursive: true });
  fs.mkdirSync(staticRoot, { recursive: true });
  fs.copyFileSync(V2_STATE, stateFile);
  if (clearTargetDraft || targetFromCurrent || configuredGroups) {
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
    if (configuredGroups) {
      state.meta.groups = ['输入', '处理', '输出'].map((group, index) => ({
        id: `configured-group-${index + 1}`,
        level: 'L1',
        group,
        label: group,
        description: `${group} architecture group`,
        color: '#edf4ff',
        accent: '#5d7ea9',
        position: { x: index * 400, y: 0 },
        width: 340,
        height: 420,
      }));
    }
    const canonical = migrateLegacyState(state);
    if (targetFromCurrent) canonical.target.published.developmentContract = executableContract(canonical.target.published);
    fs.writeFileSync(stateFile, `${JSON.stringify(canonical, null, 2)}\n`, 'utf8');
  }
  fs.copyFileSync(DEMO_CONFIG, configFile);
  fs.copyFileSync(DEMO_DOCUMENTS, documentsFile);
  if (!withoutCodeRepository) fs.writeFileSync(sourceFile, sourceContent, 'utf8');
  const designContent = '# Target design\n\nThe target needs a human-governed architecture decision boundary.\n';
  fs.writeFileSync(designFile, designContent, 'utf8');
  const registeredDocumentContent = [
    '# Registered target design',
    '',
    '## Human boundary',
    '',
    'The user directly controls approval and publication of the target architecture.',
  ].join('\n');
  fs.mkdirSync(path.dirname(registeredDocumentFile), { recursive: true });
  fs.writeFileSync(registeredDocumentFile, registeredDocumentContent, 'utf8');
  const registry = JSON.parse(fs.readFileSync(documentsFile, 'utf8'));
  registry.documents.push({
    id: 'registered-target-design',
    title: 'Registered target design',
    type: 'target_design',
    status: 'active',
    authority: 'source_of_truth',
    path: 'documents/registered-target.md',
    summary: 'The registered target design used by contract and evidence tests.',
    supersedes: null,
    lastVerifiedAt: '2026-07-15T00:00:00.000Z',
  });
  fs.writeFileSync(documentsFile, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><div id="root"></div>', 'utf8');
  return {
    projectRoot, workspaceRoot, stateFile, analysisFile, configFile, documentsFile, staticRoot,
    sourceFile: withoutCodeRepository ? null : sourceFile,
    sourceContent,
    designFile,
    designContent,
    registeredDocumentFile,
    registeredDocumentContent,
  };
}

async function startFixture(t, options = {}) {
  const { serverOptions = {}, ...fixtureOptions } = options;
  const fixture = createFixture(fixtureOptions);
  const server = createServer({ ...fixture, ...serverOptions });
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

function semanticPatchProposal({ artifactId, evidenceId, changes }) {
  return {
    schemaVersion: '1.4.0',
    artifactType: 'architecture-proposal',
    artifactId,
    createdAt: NOW,
    requestId: `request-${artifactId}`,
    baseSnapshotId: 'current-active-draft',
    title: `Semantic patch ${artifactId}`,
    summary: 'Apply a strictly bounded semantic architecture patch.',
    options: [{
      id: `option-${artifactId}`,
      title: 'Apply semantic patch',
      summary: 'Update only allowed architecture semantics.',
      advantages: ['Preserves stable IDs and local layout.'],
      disadvantages: ['Still requires local publication.'],
    }],
    recommendedOptionId: `option-${artifactId}`,
    changes: changes.map((change) => ({ ...change, evidenceIds: [evidenceId] })),
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

function contractDiscussionManifest(artifactId, evidenceId, summary) {
  return {
    schemaVersion: '1.4.0',
    artifactType: 'evidence-manifest',
    artifactId,
    createdAt: NOW,
    projectRevision: { kind: 'workspace', value: artifactId },
    entries: [{
      id: evidenceId,
      sourceKind: 'discussion',
      basis: 'user-confirmed',
      sourceLabel: `Contract discussion ${artifactId}`,
      recordedAt: NOW,
      summary,
      excerpt: summary,
    }],
  };
}

function contractPatchProposal({
  artifactId,
  evidenceId,
  upsert = [],
  remove = [],
  changes = [],
  summary = 'Update the target draft development contract.',
} = {}) {
  return {
    schemaVersion: '1.4.0',
    artifactType: 'architecture-proposal',
    artifactId,
    createdAt: NOW,
    requestId: `request-${artifactId}`,
    baseSnapshotId: 'target-active-draft',
    title: 'Update target contract criteria',
    summary,
    options: [{
      id: `option-${artifactId}`,
      title: 'Apply explicit contract patch',
      summary,
      advantages: ['Keeps stable criterion IDs editable before publication.'],
      disadvantages: ['Still requires local publication.'],
    }],
    recommendedOptionId: `option-${artifactId}`,
    changes,
    contractPatch: {
      upsert: upsert.map((criterion) => ({ ...criterion, evidenceIds: [evidenceId] })),
      delete: remove.map((id) => ({ id, evidenceIds: [evidenceId] })),
    },
    risks: [],
    decisionsRequired: [],
    evidenceManifest: 'evidence-manifest.json',
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

function registeredDocumentEvidenceManifest(contentHash) {
  return {
    schemaVersion: '1.3.0',
    artifactType: 'evidence-manifest',
    artifactId: 'evidence-registered-design-manifest',
    createdAt: NOW,
    projectRevision: { kind: 'workspace', value: 'concept-registered-document' },
    entries: [{
      id: 'evidence-registered-target-boundary',
      sourceKind: 'project-document',
      basis: 'design-document',
      documentId: 'registered-target-design',
      section: 'Human boundary',
      summary: 'The registered design assigns approval and publication to the user.',
      contentHash,
    }],
  };
}

function registeredDocumentProposal() {
  const proposal = conceptProposal({
    artifactId: 'proposal-registered-document-target',
    evidenceId: 'evidence-registered-target-boundary',
  });
  proposal.schemaVersion = '1.3.0';
  proposal.requestId = 'request-registered-document-target';
  proposal.changes[0].patch.data.documentRefs = ['registered-target-design'];
  proposal.changes[0].patch.data.interactionModes = ['human-ui', 'system-service'];
  proposal.changes[0].patch.data.architectureLayer = 'application-layer';
  proposal.acceptanceCriteria = [{
    id: 'criterion-human-boundary-visible',
    statement: 'The published target exposes a user-controlled decision boundary.',
    targetRefs: [{ targetType: 'node', targetId: 'human-decision-boundary' }],
  }];
  return proposal;
}

function registeredDocumentBindingProposal({
  artifactId = 'proposal-bind-registered-document',
  targetId = 'processing-module',
} = {}) {
  return {
    schemaVersion: '1.3.0',
    artifactType: 'architecture-proposal',
    artifactId,
    createdAt: NOW,
    requestId: 'request-bind-registered-document',
    baseSnapshotId: 'target-active-draft',
    title: 'Bind the registered design to an existing target responsibility',
    summary: 'Add a stable document reference without replacing the existing target draft.',
    options: [{
      id: 'option-bind-registered-document',
      title: 'Bind registered design',
      summary: 'Keep the target semantics and attach its governing design document.',
      advantages: ['Lets coding agents read the relevant design on demand.'],
      disadvantages: ['Still requires human review and publication.'],
    }],
    recommendedOptionId: 'option-bind-registered-document',
    changes: [{
      id: `change-bind-document-${targetId}`,
      kind: 'update',
      targetType: 'node',
      targetId,
      summary: 'Bind the registered target design to this responsibility.',
      evidenceIds: ['evidence-registered-target-boundary'],
      patch: { data: { documentRefs: ['registered-target-design'] } },
    }],
    acceptanceCriteria: [{
      id: 'criterion-registered-design-bound',
      statement: 'The target responsibility is bound to its registered governing design.',
      targetRefs: [{ targetType: 'node', targetId }],
    }],
    risks: [],
    decisionsRequired: [],
    evidenceManifest: 'evidence-manifest.json',
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
    schemaVersion: '1.3.0',
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
    schemaVersion: '1.3.0',
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
    schemaVersion: '1.3.0',
    artifactType: 'implementation-report',
    artifactId: overrides.artifactId || 'report-implementation-v12',
    createdAt: NOW,
    requestId: 'request-implementation-v12',
    approvedTarget: structuredClone(run.approvedTarget),
    status: overrides.status || 'partial',
    resultingRevision: structuredClone(snapshot.project.revision),
    changedFiles: ['src/service.js'],
    tests: overrides.tests || [{ command: 'npm test', outcome: 'passed', summary: 'All observed checks passed.' }],
    acceptanceResults: overrides.acceptanceResults || [
      {
        criterionId: 'criterion-formal-target-aligned',
        status: 'satisfied',
        evidenceIds: ['evidence-service-behavior'],
      },
      {
        criterionId: 'criterion-boundaries-preserved',
        status: 'satisfied',
        evidenceIds: ['evidence-service-behavior'],
      },
    ],
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
  state.target.published.developmentContract = executableContract(state.target.published);
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function advanceFormalTargetWithDifferentCriteria(stateFile) {
  advanceFormalTarget(stateFile);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const contract = state.target.published.developmentContract;
  contract.acceptanceCriteria = [{
    id: 'criterion-replacement-baseline',
    statement: 'The replacement formal target satisfies its newly published observable outcome.',
    targetRefs: structuredClone(contract.targetRefs),
  }];
  const { contractHash: ignored, ...content } = contract;
  contract.contractHash = hashJson(content);
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

function draftRequest(lane, graph) {
  return {
    schemaVersion: lane.schemaVersion,
    expectedHeadRevision: lane.published.revision,
    expectedHeadRevisionId: lane.published.revisionId,
    expectedDraftId: lane.draft?.draftId || null,
    expectedDraftRevision: lane.draft?.draftRevision || 0,
    graph,
  };
}

function laneLockRequest(lane) {
  const { graph: ignored, ...locks } = draftRequest(lane, lane.draft?.graph || lane.published.graph);
  return locks;
}

function publishRequest(lane, message) {
  return {
    schemaVersion: lane.schemaVersion,
    expectedHeadRevision: lane.published.revision,
    expectedHeadRevisionId: lane.published.revisionId,
    expectedDraftId: lane.draft?.draftId || null,
    expectedDraftRevision: lane.draft?.draftRevision || 0,
    message,
    userConfirmed: true,
  };
}

test('agent APIs expose local context without a model provider or approval capability', async (t) => {
  const fixture = await startFixture(t);
  const context = await request(fixture.baseUrl, '/api/agent/context?view=current');
  assert.equal(context.response.status, 200, JSON.stringify(context.payload));
  assert.equal(context.payload.workflow.createRunFirst, true);
  assert.equal(context.payload.workflow.implementationHumanReviewRequired, true);
  assert.equal(context.payload.workflow.serverComputedContractGate, true);
  assert.equal(context.payload.workflow.agentCanReview, false);
  assert.equal(context.payload.workflow.agentCanApprove, false);
  assert.equal(context.payload.workflow.agentCanPublish, false);
  assert.equal(context.payload.selected.published.revision, 1);
  assert.equal(context.payload.selected.published.representation, 'semantic-graph-v1');
  assert.equal(context.payload.selected.published.graph.nodes[0].position, undefined);
  assert.equal(context.payload.selected.published.graph.nodes[0].width, undefined);
  assert.equal(Object.hasOwn(context.payload.selected, 'baselineStatus'), false);
  assert.deepEqual(context.payload.workflow.supportedEvidenceBases, [
    'user-confirmed', 'design-document', 'code-fact', 'agent-inference',
  ]);

  const analysis = await request(fixture.baseUrl, '/api/analysis');
  assert.equal(analysis.payload.schemaVersion, ANALYSIS_SCHEMA_VERSION);
  assert.equal(analysis.payload.integration.mode, 'external-agent');
  assert.equal(analysis.payload.integration.modelProviderRequired, false);
  assert.equal(analysis.payload.integration.implementationHumanReviewRequired, true);
  assert.equal(analysis.payload.integration.serverComputedContractGate, true);
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

test('an external proposal is evidence-verified and applied directly to the locked draft without publication', async (t) => {
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
  assert.equal(submitted.payload.permissions.canPublish, false);
  assert.equal(submitted.payload.submission.proposalId, 'proposal-evaluation-purpose');
  assert.equal(submitted.payload.submission.requiresHumanReview, false);
  assert.equal(submitted.payload.submission.requiresPublication, true);
  assert.equal(submitted.payload.submission.reviewType, 'draft-publication');
  assert.equal(submitted.payload.proposals[0].status, 'draft-applied');
  assert.equal(submitted.payload.proposals[0].draftWrite.humanApproved, false);

  const analysis = await request(fixture.baseUrl, '/api/analysis');
  const proposal = analysis.payload.proposals.find((item) => item.id === 'proposal-evaluation-purpose');
  assert.equal(proposal.origin.agentName, 'Codex');
  assert.equal(proposal.evidence.length, 1);
  assert.equal(proposal.changes[0].patch.position, undefined);
  assert.deepEqual(run.laneLock, {
    publishedRevision: 1,
    publishedRevisionId: 'current-r1',
    draftId: null,
    draftRevision: 0,
  });
  assert.deepEqual(proposal.laneLock, run.laneLock);
  assert.equal(proposal.status, 'draft-applied');
  assert.equal(proposal.reviewedAt, null);

  const lane = await request(fixture.baseUrl, '/api/state?view=current');
  assert.equal(lane.payload.draft.graph.nodes.find((node) => node.id === 'processing-module').data.purpose,
    'Evaluates cited evidence before producing a controlled output.');
  assert.equal(lane.payload.published.graph.nodes.find((node) => node.id === 'processing-module').data.purpose,
    '执行通用处理。');

  const status = await request(fixture.baseUrl, `/api/agent/runs/${run.id}`);
  assert.equal(status.payload.run.status, 'submitted');
  assert.equal(status.payload.proposals[0].publication.status, 'awaiting-publication');
  assert.equal(status.payload.permissions.canPublish, false);
});

test('HTTP direct-draft patches preserve explicit groups, update edge endpoints, and reject non-semantic or invalid writes atomically', async (t) => {
  const fixture = await startFixture(t, { configuredGroups: true });
  const submitPatch = async (artifactId, changes) => {
    const evidenceId = `evidence-${artifactId}`;
    const run = await createRun(fixture.baseUrl);
    return request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
      method: 'POST',
      body: body({
        artifact: semanticPatchProposal({ artifactId, evidenceId, changes }),
        evidenceManifest: evidenceManifest(fixture.sourceContent, {
          artifactId: `manifest-${artifactId}`,
          evidenceId,
        }),
      }),
    });
  };

  const grouped = await submitPatch('proposal-explicit-group', [{
    id: 'change-explicit-group', kind: 'update', targetType: 'node', targetId: 'processing-module',
    summary: 'Move the module into an explicitly selected configured group.',
    patch: { data: { group: '  输出  ' } },
  }]);
  assert.equal(grouped.response.status, 201, JSON.stringify(grouped.payload));
  let lane = await request(fixture.baseUrl, '/api/state?view=current');
  assert.equal(lane.payload.draft.graph.nodes.find((node) => node.id === 'processing-module').data.group, '输出');
  let analysis = await request(fixture.baseUrl, '/api/analysis');
  assert.equal(analysis.payload.proposals.find((proposal) => proposal.id === 'proposal-explicit-group').changes[0].patch.data.group, '输出');

  const rewired = await submitPatch('proposal-rewire-edge', [{
    id: 'change-rewire-edge', kind: 'update', targetType: 'edge', targetId: 'edge-input-processing',
    summary: 'Reconnect the stable relationship to the output module.',
    patch: { target: 'output-module' },
  }]);
  assert.equal(rewired.response.status, 201, JSON.stringify(rewired.payload));
  lane = await request(fixture.baseUrl, '/api/state?view=current');
  const rewiredEdge = lane.payload.draft.graph.edges.find((edge) => edge.id === 'edge-input-processing');
  assert.equal(rewiredEdge.source, 'input-module');
  assert.equal(rewiredEdge.target, 'output-module');

  const related = await submitPatch('proposal-valid-related-target', [{
    id: 'change-valid-related-target', kind: 'update', targetType: 'node', targetId: 'output-module',
    summary: 'Connect the module to an existing architecture node in the project catalog.',
    patch: { data: { relatedDiagramId: 'default', relatedNodeId: 'input-module' } },
  }]);
  assert.equal(related.response.status, 201, JSON.stringify(related.payload));
  lane = await request(fixture.baseUrl, '/api/state?view=current');
  const relatedNode = lane.payload.draft.graph.nodes.find((node) => node.id === 'output-module');
  assert.equal(relatedNode.data.relatedDiagramId, 'default');
  assert.equal(relatedNode.data.relatedNodeId, 'input-module');

  const clearedRelated = await submitPatch('proposal-clear-related-target', [{
    id: 'change-clear-related-target', kind: 'update', targetType: 'node', targetId: 'output-module',
    summary: 'Remove the optional drill-down target as a paired explicit clear.',
    patch: { data: { relatedDiagramId: null, relatedNodeId: null } },
  }]);
  assert.equal(clearedRelated.response.status, 201, JSON.stringify(clearedRelated.payload));
  lane = await request(fixture.baseUrl, '/api/state?view=current');
  const clearedRelatedNode = lane.payload.draft.graph.nodes.find((node) => node.id === 'output-module');
  assert.equal('relatedDiagramId' in clearedRelatedNode.data, false);
  assert.equal('relatedNodeId' in clearedRelatedNode.data, false);

  const invalidCases = [
    {
      artifactId: 'proposal-forge-human-confirmation',
      change: {
        id: 'change-forge-human-confirmation', kind: 'update', targetType: 'node', targetId: 'processing-module',
        summary: 'Attempt to forge a local correction marker.', patch: { data: { humanConfirmed: true } },
      },
    },
    {
      artifactId: 'proposal-overwrite-routing',
      change: {
        id: 'change-overwrite-routing', kind: 'update', targetType: 'edge', targetId: 'edge-input-processing',
        summary: 'Attempt to overwrite a user-maintained route.', patch: { data: { routingMode: 'manual' } },
      },
    },
    {
      artifactId: 'proposal-clear-required-purpose',
      change: {
        id: 'change-clear-required-purpose', kind: 'update', targetType: 'node', targetId: 'processing-module',
        summary: 'Attempt to clear a required responsibility.', patch: { data: { purpose: null } },
      },
    },
    {
      artifactId: 'proposal-clear-half-related-reference',
      change: {
        id: 'change-clear-half-related-reference', kind: 'update', targetType: 'node', targetId: 'processing-module',
        summary: 'Attempt to clear only half of a drill-down pair.', patch: { data: { relatedDiagramId: null } },
      },
    },
    {
      artifactId: 'proposal-unknown-group',
      change: {
        id: 'change-unknown-group', kind: 'update', targetType: 'node', targetId: 'processing-module',
        summary: 'Attempt to use an unconfigured architecture group.', patch: { data: { group: 'Unknown group' } },
      },
    },
    {
      artifactId: 'proposal-unknown-edge-node',
      change: {
        id: 'change-unknown-edge-node', kind: 'update', targetType: 'edge', targetId: 'edge-input-processing',
        summary: 'Attempt to reconnect to a missing node.', patch: { target: 'missing-module' },
      },
    },
    {
      artifactId: 'proposal-self-loop',
      change: {
        id: 'change-self-loop', kind: 'update', targetType: 'edge', targetId: 'edge-input-processing',
        summary: 'Attempt to create a self-loop.', patch: { source: 'input-module', target: 'input-module' },
      },
    },
    {
      artifactId: 'proposal-unknown-related-diagram',
      change: {
        id: 'change-unknown-related-diagram', kind: 'update', targetType: 'node', targetId: 'processing-module',
        summary: 'Attempt to link to a diagram outside the project catalog.',
        patch: { data: { relatedDiagramId: 'missing-diagram' } },
      },
    },
    {
      artifactId: 'proposal-unknown-related-node',
      change: {
        id: 'change-unknown-related-node', kind: 'update', targetType: 'node', targetId: 'processing-module',
        summary: 'Attempt to link to a missing node in an existing diagram.',
        patch: { data: { relatedDiagramId: 'default', relatedNodeId: 'missing-related-node' } },
      },
    },
  ];
  for (const item of invalidCases) {
    const beforeState = await request(fixture.baseUrl, '/api/state?view=current');
    const beforeAnalysis = await request(fixture.baseUrl, '/api/analysis');
    const rejected = await submitPatch(item.artifactId, [item.change]);
    assert.equal(rejected.response.status, 422, `${item.artifactId}: ${JSON.stringify(rejected.payload)}`);
    const afterState = await request(fixture.baseUrl, '/api/state?view=current');
    const afterAnalysis = await request(fixture.baseUrl, '/api/analysis');
    assert.deepEqual(afterState.payload.published, beforeState.payload.published, `${item.artifactId} changed published state`);
    assert.deepEqual(afterState.payload.draft, beforeState.payload.draft, `${item.artifactId} changed draft state`);
    assert.equal(afterAnalysis.payload.baseRevision, beforeAnalysis.payload.baseRevision + 1, 'only create_agent_run may advance analysis before the rejected artifact');
    assert.equal(afterAnalysis.payload.proposals.length, beforeAnalysis.payload.proposals.length, `${item.artifactId} saved a rejected proposal`);
    assert.equal(afterAnalysis.payload.artifacts.length, beforeAnalysis.payload.artifacts.length, `${item.artifactId} saved a rejected artifact`);
  }
});

test('target horizon cannot be cleared and a rejected clear is atomic', async (t) => {
  const fixture = await startFixture(t);
  const run = await createRun(fixture.baseUrl, {
    view: 'target',
    summary: 'Attempt an invalid removal of a required target horizon.',
  });
  const beforeState = fs.readFileSync(fixture.stateFile, 'utf8');
  const beforeAnalysis = JSON.parse(fs.readFileSync(fixture.analysisFile, 'utf8'));
  const evidenceId = 'evidence-clear-target-horizon';
  const rejected = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: semanticPatchProposal({
        artifactId: 'proposal-clear-target-horizon',
        evidenceId,
        changes: [{
          id: 'change-clear-target-horizon', kind: 'update', targetType: 'node', targetId: 'processing-module',
          summary: 'Attempt to remove the target horizon.', patch: { data: { horizon: null } },
        }],
      }),
      evidenceManifest: evidenceManifest(fixture.sourceContent, {
        artifactId: 'manifest-clear-target-horizon',
        evidenceId,
      }),
    }),
  });
  assert.equal(rejected.response.status, 422, JSON.stringify(rejected.payload));
  assert.equal(rejected.payload.code, 'AGENT_PATCH_CLEAR_INVALID');
  assert.equal(fs.readFileSync(fixture.stateFile, 'utf8'), beforeState);
  const afterAnalysis = JSON.parse(fs.readFileSync(fixture.analysisFile, 'utf8'));
  assert.equal(afterAnalysis.baseRevision, beforeAnalysis.baseRevision);
  assert.deepEqual(afterAnalysis.artifacts, beforeAnalysis.artifacts);
  assert.deepEqual(afterAnalysis.proposals, beforeAnalysis.proposals);
});

test('graph and contract no-op patches are rejected without creating an empty draft or provenance record', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const current = await request(fixture.baseUrl, '/api/state?view=current');
  const currentPurpose = current.payload.published.graph.nodes.find((node) => node.id === 'processing-module').data.purpose;
  const graphRun = await createRun(fixture.baseUrl);
  let analysisBefore = JSON.parse(fs.readFileSync(fixture.analysisFile, 'utf8'));
  let stateBefore = fs.readFileSync(fixture.stateFile, 'utf8');
  const graphEvidenceId = 'evidence-noop-graph';
  const graphNoop = await request(fixture.baseUrl, `/api/agent/runs/${graphRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: semanticPatchProposal({
        artifactId: 'proposal-noop-graph',
        evidenceId: graphEvidenceId,
        changes: [{
          id: 'change-noop-graph', kind: 'update', targetType: 'node', targetId: 'processing-module',
          summary: 'Repeat the exact current purpose.', patch: { data: { purpose: currentPurpose } },
        }],
      }),
      evidenceManifest: evidenceManifest(fixture.sourceContent, {
        artifactId: 'manifest-noop-graph', evidenceId: graphEvidenceId,
      }),
    }),
  });
  assert.equal(graphNoop.response.status, 422, JSON.stringify(graphNoop.payload));
  assert.equal(graphNoop.payload.code, 'AGENT_PATCH_NO_EFFECT');
  assert.equal(fs.readFileSync(fixture.stateFile, 'utf8'), stateBefore);
  let analysisAfter = JSON.parse(fs.readFileSync(fixture.analysisFile, 'utf8'));
  assert.equal(analysisAfter.baseRevision, analysisBefore.baseRevision);
  assert.equal(analysisAfter.proposals.length, analysisBefore.proposals.length);
  assert.equal(analysisAfter.artifacts.length, analysisBefore.artifacts.length);

  const target = await request(fixture.baseUrl, '/api/state?view=target');
  const criterion = target.payload.published.developmentContract.acceptanceCriteria[0];
  const contractRun = await createRun(fixture.baseUrl, { view: 'target' });
  analysisBefore = JSON.parse(fs.readFileSync(fixture.analysisFile, 'utf8'));
  stateBefore = fs.readFileSync(fixture.stateFile, 'utf8');
  const contractEvidenceId = 'evidence-noop-contract';
  const contractArtifact = semanticPatchProposal({
    artifactId: 'proposal-noop-contract', evidenceId: contractEvidenceId, changes: [],
  });
  contractArtifact.contractPatch = {
    upsert: [{ ...structuredClone(criterion), evidenceIds: [contractEvidenceId] }],
    delete: [],
  };
  const contractNoop = await request(fixture.baseUrl, `/api/agent/runs/${contractRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: contractArtifact,
      evidenceManifest: evidenceManifest(fixture.sourceContent, {
        artifactId: 'manifest-noop-contract', evidenceId: contractEvidenceId,
      }),
    }),
  });
  assert.equal(contractNoop.response.status, 422, JSON.stringify(contractNoop.payload));
  assert.equal(contractNoop.payload.code, 'AGENT_PATCH_NO_EFFECT');
  assert.equal(fs.readFileSync(fixture.stateFile, 'utf8'), stateBefore);
  analysisAfter = JSON.parse(fs.readFileSync(fixture.analysisFile, 'utf8'));
  assert.equal(analysisAfter.baseRevision, analysisBefore.baseRevision);
  assert.equal(analysisAfter.proposals.length, analysisBefore.proposals.length);
  assert.equal(analysisAfter.artifacts.length, analysisBefore.artifacts.length);
});

test('an agent can retract the final draft change back to the formal baseline without losing provenance', async (t) => {
  const fixture = await startFixture(t);
  const publishedBefore = (await request(fixture.baseUrl, '/api/state?view=current')).payload.published;
  const addRun = await createRun(fixture.baseUrl);
  const addEvidenceId = 'evidence-add-retractable-module';
  const added = await request(fixture.baseUrl, `/api/agent/runs/${addRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: semanticPatchProposal({
        artifactId: 'proposal-add-retractable-module', evidenceId: addEvidenceId,
        changes: [{
          id: 'change-add-retractable-module', kind: 'add', targetType: 'node', targetId: 'retractable-module',
          summary: 'Add a temporary architecture responsibility.',
          patch: { data: {
            name: 'Retractable module', group: 'Processing', purpose: 'Temporary responsibility.',
            technical: 'Temporary service', product: 'Temporary feature', authorization: 'No elevated access.',
          } },
        }],
      }),
      evidenceManifest: evidenceManifest(fixture.sourceContent, {
        artifactId: 'manifest-add-retractable-module', evidenceId: addEvidenceId,
      }),
    }),
  });
  assert.equal(added.response.status, 201, JSON.stringify(added.payload));
  assert.equal(added.payload.submission.requiresPublication, true);

  const removeRun = await createRun(fixture.baseUrl);
  const removeEvidenceId = 'evidence-remove-retractable-module';
  const removed = await request(fixture.baseUrl, `/api/agent/runs/${removeRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: semanticPatchProposal({
        artifactId: 'proposal-remove-retractable-module', evidenceId: removeEvidenceId,
        changes: [{
          id: 'change-remove-retractable-module', kind: 'remove', targetType: 'node', targetId: 'retractable-module',
          summary: 'Withdraw the temporary responsibility.', patch: null,
        }],
      }),
      evidenceManifest: evidenceManifest(fixture.sourceContent, {
        artifactId: 'manifest-remove-retractable-module', evidenceId: removeEvidenceId,
      }),
    }),
  });
  assert.equal(removed.response.status, 201, JSON.stringify(removed.payload));
  assert.equal(removed.payload.submission.draftApplication.outcome, 'reverted-to-published');
  assert.equal(removed.payload.submission.requiresPublication, false);
  assert.equal(removed.payload.submission.reviewType, null);
  assert.equal(removed.payload.proposals[0].draftWrite.status, 'reverted-to-published');
  assert.equal(removed.payload.proposals[0].publication, null);
  const laneAfter = await request(fixture.baseUrl, '/api/state?view=current');
  assert.equal(laneAfter.payload.draft, null);
  assert.deepEqual(laneAfter.payload.published, publishedBefore);
  const analysisAfter = await request(fixture.baseUrl, '/api/analysis');
  const retraction = analysisAfter.payload.proposals.find((proposal) => proposal.id === 'proposal-remove-retractable-module');
  assert.equal(retraction.status, 'draft-applied');
  assert.equal(retraction.reviewedAt, null);
  assert.equal(retraction.application.outcome, 'reverted-to-published');
  assert.equal(retraction.origin.runId, removeRun.id);
});

test('reverting graph semantics does not clear a target draft when its bound document lock changed', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const state = JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8'));
  const registry = JSON.parse(fs.readFileSync(fixture.documentsFile, 'utf8'));
  const document = registry.documents.find((entry) => entry.id === 'registered-target-design');
  const published = state.target.published;
  published.graph.nodes.find((node) => node.id === 'processing-module').data.documentRefs = [document.id];
  published.developmentContract = executableContract(published);
  published.developmentContract.documents = [{
    id: document.id,
    title: document.title,
    path: document.path,
    summary: document.summary,
    status: document.status,
    authority: document.authority,
    lastVerifiedAt: document.lastVerifiedAt,
    contentHash: hash(fixture.registeredDocumentContent),
    sizeBytes: Buffer.byteLength(fixture.registeredDocumentContent),
  }];
  published.developmentContract.documentSetHash = hashJson(
    published.developmentContract.documents.map(contractDocumentBindingForTest),
  );
  const { contractHash: ignored, ...contractContent } = published.developmentContract;
  published.developmentContract.contractHash = hashJson(contractContent);
  fs.writeFileSync(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const originalProduct = published.graph.nodes.find((node) => node.id === 'processing-module').data.product;
  const firstRun = await createRun(fixture.baseUrl, { view: 'target' });
  const firstEvidenceId = 'evidence-temporary-target-product';
  const first = await request(fixture.baseUrl, `/api/agent/runs/${firstRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: semanticPatchProposal({
        artifactId: 'proposal-temporary-target-product', evidenceId: firstEvidenceId,
        changes: [{
          id: 'change-temporary-target-product', kind: 'update', targetType: 'node', targetId: 'processing-module',
          summary: 'Temporarily revise a target product responsibility.', patch: { data: { product: 'Temporary target product' } },
        }],
      }),
      evidenceManifest: evidenceManifest(fixture.sourceContent, {
        artifactId: 'manifest-temporary-target-product', evidenceId: firstEvidenceId,
      }),
    }),
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.payload));

  fs.appendFileSync(fixture.registeredDocumentFile, '\nA deliberate new document revision.\n', 'utf8');
  const secondRun = await createRun(fixture.baseUrl, { view: 'target' });
  const secondEvidenceId = 'evidence-revert-target-product';
  const second = await request(fixture.baseUrl, `/api/agent/runs/${secondRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: semanticPatchProposal({
        artifactId: 'proposal-revert-target-product', evidenceId: secondEvidenceId,
        changes: [{
          id: 'change-revert-target-product', kind: 'update', targetType: 'node', targetId: 'processing-module',
          summary: 'Return the graph semantics to the formal target.', patch: { data: { product: originalProduct } },
        }],
      }),
      evidenceManifest: evidenceManifest(fixture.sourceContent, {
        artifactId: 'manifest-revert-target-product', evidenceId: secondEvidenceId,
      }),
    }),
  });
  assert.equal(second.response.status, 201, JSON.stringify(second.payload));
  assert.equal(second.payload.submission.draftApplication.outcome, 'draft-updated');
  assert.equal(second.payload.submission.requiresPublication, true);
  const after = await request(fixture.baseUrl, '/api/state?view=target');
  assert.ok(after.payload.draft, 'the changed bound-document lock remains an unpublished contract change');
  assert.equal(
    semanticGraphHash({ graph: after.payload.draft.graph }),
    semanticGraphHash({ graph: after.payload.published.graph }),
  );
  assert.notEqual(
    after.payload.draft.developmentContract.documents[0].contentHash,
    after.payload.published.developmentContract.documents[0].contentHash,
  );
});

test('the current lane safely merges a proposal into the exact active draft while preserving layout', async (t) => {
  const fixture = await startFixture(t);
  const current = await request(fixture.baseUrl, '/api/state?view=current');
  const draftGraph = structuredClone(current.payload.published.graph);
  draftGraph.nodes.find((node) => node.id === 'processing-module').position.x += 37;
  const saved = await request(fixture.baseUrl, '/api/draft?view=current', {
    method: 'PUT',
    body: body(draftRequest(current.payload, draftGraph)),
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.payload));

  const run = await createRun(fixture.baseUrl, {
    view: 'current',
    summary: 'Update one code-backed responsibility in the exact current draft.',
  });
  assert.equal(run.laneLock.draftId, saved.payload.draft.draftId);
  assert.equal(run.laneLock.draftRevision, saved.payload.draft.draftRevision);
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: changeProposal(),
      evidenceManifest: evidenceManifest(fixture.sourceContent),
    }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
  assert.equal(submitted.payload.submission.draftApplication.draftId, saved.payload.draft.draftId);
  assert.equal(submitted.payload.submission.draftApplication.draftRevision, saved.payload.draft.draftRevision + 1);
  const after = await request(fixture.baseUrl, '/api/state?view=current');
  assert.equal(after.payload.draft.draftId, saved.payload.draft.draftId);
  assert.equal(after.payload.draft.draftRevision, saved.payload.draft.draftRevision + 1);
  assert.equal(
    after.payload.draft.graph.nodes.find((node) => node.id === 'processing-module').position.x,
    draftGraph.nodes.find((node) => node.id === 'processing-module').position.x,
  );
  assert.equal(
    after.payload.draft.graph.nodes.find((node) => node.id === 'processing-module').data.purpose,
    'Evaluates cited evidence before producing a controlled output.',
  );
  assert.equal(
    after.payload.published.graph.nodes.find((node) => node.id === 'processing-module').data.purpose,
    '执行通用处理。',
  );
});

test('a concept project can write a target draft from user-confirmed discussion without code and publish only locally', async (t) => {
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
  assert.equal(submitted.payload.submission.requiresPublication, true);

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
  assert.equal(proposal.status, 'draft-applied');
  assert.equal(proposal.reviewedAt, null);
  const target = await request(fixture.baseUrl, '/api/state?view=target');
  assert.equal(target.payload.published.graph.nodes.length, 0, 'draft application must not alter the published target');
  assert.equal(target.payload.draft.graph.nodes[0].id, 'human-decision-boundary');
  assert.equal(target.payload.draft.graph.nodes[0].data.group, '待确认归属', 'group inference is used only when the patch omits group');

  const formalTargetBeforePublish = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.equal(formalTargetBeforePublish.payload.approvalStatus, 'published-target');
  assert.equal(formalTargetBeforePublish.payload.baselineStatus, 'legacy-unbound');
  assert.equal(formalTargetBeforePublish.payload.formalBaseline, null);
  assert.equal(formalTargetBeforePublish.payload.architecture.revisionId, target.payload.published.revisionId);
  assert.equal(formalTargetBeforePublish.payload.architecture.graph.nodes.length, 0);
  assert.equal('approvedProposalIds' in formalTargetBeforePublish.payload, false);

  const reviewBeforePublish = await request(fixture.baseUrl, `/api/agent/runs/${run.id}`);
  const appliedProposal = reviewBeforePublish.payload.proposals.find((item) => item.id === proposal.id);
  assert.equal(appliedProposal.publication.status, 'awaiting-publication');
  assert.equal(appliedProposal.publication.summary, proposal.summary);
  assert.equal(appliedProposal.draftWrite.humanApproved, false);

  const lane = target.payload;
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
  assert.equal(approvedTarget.payload.baselineStatus, 'executable-formal-baseline');
  assert.equal(approvedTarget.payload.formalBaseline.status, 'executable-formal-baseline');
  assert.equal(approvedTarget.payload.developmentContract.acceptanceCriteria[0].statement, 'The target shows a human-controlled decision boundary.');
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

test('a locked target draft can explicitly add, revise, preserve, and delete stable acceptance criteria', async (t) => {
  const fixture = await startFixture(t, { withoutCodeRepository: true, clearTargetDraft: true });
  const publishedBefore = (await request(fixture.baseUrl, '/api/state?view=target')).payload.published;
  const criterionId = 'criterion-human-boundary-visible';

  const firstEvidenceId = 'evidence-contract-add';
  const firstArtifact = contractPatchProposal({
    artifactId: 'proposal-contract-add',
    evidenceId: firstEvidenceId,
    changes: [{
      id: 'change-add-contract-boundary',
      kind: 'add',
      targetType: 'node',
      targetId: 'human-decision-boundary',
      summary: 'Add the target boundary referenced by the contract.',
      evidenceIds: [firstEvidenceId],
      patch: { data: {
        name: 'Human decision boundary',
        purpose: 'Keeps publication under local user control.',
        technical: 'Design target',
        product: 'Governance boundary',
        authorization: 'Only the user publishes.',
        horizon: '近期',
      } },
    }],
    upsert: [{
      id: criterionId,
      statement: 'The target visibly keeps publication under user control.',
      targetRefs: [{ targetType: 'node', targetId: 'human-decision-boundary' }],
    }],
  });
  const firstRun = await createRun(fixture.baseUrl, { view: 'target' });
  const first = await request(fixture.baseUrl, `/api/agent/runs/${firstRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: firstArtifact,
      evidenceManifest: contractDiscussionManifest('evidence-contract-add-manifest', firstEvidenceId, 'The user confirmed the initial observable target criterion.'),
    }),
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.payload));
  let target = await request(fixture.baseUrl, '/api/state?view=target');
  assert.equal(target.payload.draft.developmentContract.acceptanceCriteria[0].statement, firstArtifact.contractPatch.upsert[0].statement);
  assert.deepEqual(target.payload.published, publishedBefore);
  let compactContext = await request(fixture.baseUrl, '/api/agent/context?view=target');
  assert.equal(compactContext.payload.selected.draft.developmentContract.unpublished, true);
  assert.equal(compactContext.payload.selected.draft.developmentContract.status, 'draft');
  assert.equal(compactContext.payload.selected.draft.developmentContract.acceptanceCriteria[0].id, criterionId);
  assert.equal(JSON.stringify(compactContext.payload.selected.draft).includes('position'), false);

  const updateEvidenceId = 'evidence-contract-update';
  const updateArtifact = contractPatchProposal({
    artifactId: 'proposal-contract-update',
    evidenceId: updateEvidenceId,
    upsert: [{
      id: criterionId,
      statement: 'The published target visibly keeps architecture publication under explicit local-user control.',
      targetRefs: [{ targetType: 'node', targetId: 'human-decision-boundary' }],
    }],
  });
  const updateRun = await createRun(fixture.baseUrl, { view: 'target' });
  const updated = await request(fixture.baseUrl, `/api/agent/runs/${updateRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: updateArtifact,
      evidenceManifest: contractDiscussionManifest('evidence-contract-update-manifest', updateEvidenceId, 'The user clarified the exact observable publication boundary.'),
    }),
  });
  assert.equal(updated.response.status, 201, JSON.stringify(updated.payload));
  target = await request(fixture.baseUrl, '/api/state?view=target');
  assert.equal(target.payload.draft.developmentContract.acceptanceCriteria[0].statement, updateArtifact.contractPatch.upsert[0].statement);
  compactContext = await request(fixture.baseUrl, '/api/agent/context?view=target');
  assert.equal(
    compactContext.payload.selected.draft.developmentContract.acceptanceCriteria[0].statement,
    updateArtifact.contractPatch.upsert[0].statement,
  );

  const unrelatedEvidenceId = 'evidence-unrelated-target-change';
  const unrelated = contractPatchProposal({
    artifactId: 'proposal-unrelated-target-change',
    evidenceId: unrelatedEvidenceId,
    changes: [{
      id: 'change-target-product-label', kind: 'update', targetType: 'node', targetId: 'human-decision-boundary',
      summary: 'Clarify the target product label.', evidenceIds: [unrelatedEvidenceId],
      patch: { data: { product: 'Explicit publication gate' } },
    }],
    upsert: [{
      id: 'temporary-placeholder', statement: 'This operation is removed before submission.', targetRefs: [],
    }],
  });
  delete unrelated.contractPatch;
  const unrelatedRun = await createRun(fixture.baseUrl, { view: 'target' });
  const unrelatedResult = await request(fixture.baseUrl, `/api/agent/runs/${unrelatedRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: unrelated,
      evidenceManifest: contractDiscussionManifest('evidence-unrelated-target-manifest', unrelatedEvidenceId, 'The user clarified an unrelated target label.'),
    }),
  });
  assert.equal(unrelatedResult.response.status, 201, JSON.stringify(unrelatedResult.payload));
  target = await request(fixture.baseUrl, '/api/state?view=target');
  assert.equal(target.payload.draft.developmentContract.acceptanceCriteria[0].statement, updateArtifact.contractPatch.upsert[0].statement);

  const deleteEvidenceId = 'evidence-contract-delete';
  const deleteArtifact = contractPatchProposal({
    artifactId: 'proposal-contract-delete',
    evidenceId: deleteEvidenceId,
    remove: [criterionId],
  });
  const deleteRun = await createRun(fixture.baseUrl, { view: 'target' });
  const deleted = await request(fixture.baseUrl, `/api/agent/runs/${deleteRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: deleteArtifact,
      evidenceManifest: contractDiscussionManifest('evidence-contract-delete-manifest', deleteEvidenceId, 'The user withdrew the obsolete acceptance condition before publication.'),
    }),
  });
  assert.equal(deleted.response.status, 201, JSON.stringify(deleted.payload));
  target = await request(fixture.baseUrl, '/api/state?view=target');
  assert.deepEqual(target.payload.draft.developmentContract.acceptanceCriteria, []);
  assert.deepEqual(target.payload.published, publishedBefore);
  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.equal(approved.payload.architecture.revisionId, publishedBefore.revisionId);
  assert.equal(approved.payload.developmentContract.status, 'legacy-unbound');
  const currentContext = await request(fixture.baseUrl, '/api/agent/context?view=current');
  assert.equal(currentContext.payload.selected.draft?.developmentContract || null, null);

  const analysis = await request(fixture.baseUrl, '/api/analysis');
  const contractWrites = analysis.payload.proposals.filter((proposal) => proposal.contractPatch);
  assert.equal(contractWrites.length, 3);
  assert.equal(contractWrites.every((proposal) => proposal.status === 'draft-applied' && proposal.reviewedAt === null), true);
  assert.equal(contractWrites.every((proposal) => proposal.evidence.length === 1), true);
});

test('contract patches reject stale locks and cannot be attached to the current architecture lane', async (t) => {
  const fixture = await startFixture(t);
  const evidenceId = 'evidence-contract-stale';
  const staleRun = await createRun(fixture.baseUrl, { view: 'target' });
  const target = await request(fixture.baseUrl, '/api/state?view=target');
  const changedGraph = structuredClone(target.payload.draft.graph);
  changedGraph.nodes[0].position.x += 12;
  const concurrent = await request(fixture.baseUrl, '/api/draft?view=target', {
    method: 'PUT',
    body: body(draftRequest(target.payload, changedGraph)),
  });
  assert.equal(concurrent.response.status, 200, JSON.stringify(concurrent.payload));
  const stale = await request(fixture.baseUrl, `/api/agent/runs/${staleRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: contractPatchProposal({
        artifactId: 'proposal-contract-stale', evidenceId,
        upsert: [{ id: 'criterion-stale', statement: 'Must never apply through a stale run.', targetRefs: [] }],
      }),
      evidenceManifest: contractDiscussionManifest('evidence-contract-stale-manifest', evidenceId, 'This evidence belongs to a now-stale run.'),
    }),
  });
  assert.equal(stale.response.status, 409, JSON.stringify(stale.payload));
  assert.equal(stale.payload.code, 'AGENT_RUN_STALE');

  const currentRun = await createRun(fixture.baseUrl, { view: 'current' });
  const currentEvidenceId = 'evidence-current-contract-forbidden';
  const currentArtifact = contractPatchProposal({
    artifactId: 'proposal-current-contract-forbidden', currentEvidenceId,
    evidenceId: currentEvidenceId,
    upsert: [{ id: 'criterion-current-forbidden', statement: 'Current architecture cannot carry target criteria.', targetRefs: [] }],
  });
  const currentManifest = evidenceManifest(fixture.sourceContent, {
    artifactId: 'evidence-current-contract-manifest',
    evidenceId: currentEvidenceId,
  });
  const forbidden = await request(fixture.baseUrl, `/api/agent/runs/${currentRun.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: currentArtifact, evidenceManifest: currentManifest }),
  });
  assert.equal(forbidden.response.status, 422, JSON.stringify(forbidden.payload));
  assert.equal(forbidden.payload.code, 'AGENT_CURRENT_CONTRACT_PATCH_FORBIDDEN');
});

test('a first target draft inherits the published editable criteria until an explicit patch changes them', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const approvedBefore = await request(fixture.baseUrl, '/api/agent/approved-target');
  const criterionId = approvedBefore.payload.developmentContract.acceptanceCriteria[0].id;
  const originalStatement = approvedBefore.payload.developmentContract.acceptanceCriteria[0].statement;

  const graphEvidenceId = 'evidence-new-target-draft';
  const graphOnly = contractPatchProposal({
    artifactId: 'proposal-new-target-draft',
    evidenceId: graphEvidenceId,
    changes: [{
      id: 'change-target-purpose-next', kind: 'update', targetType: 'node', targetId: 'processing-module',
      summary: 'Clarify the next target responsibility.', evidenceIds: [graphEvidenceId],
      patch: { data: { purpose: 'Next target responsibility while preserving the published contract.' } },
    }],
    upsert: [{ id: 'temporary-placeholder', statement: 'Removed before submission.', targetRefs: [] }],
  });
  delete graphOnly.contractPatch;
  const graphRun = await createRun(fixture.baseUrl, { view: 'target' });
  const graphResult = await request(fixture.baseUrl, `/api/agent/runs/${graphRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: graphOnly,
      evidenceManifest: contractDiscussionManifest('evidence-new-target-draft-manifest', graphEvidenceId, 'The user confirmed an unrelated target responsibility clarification.'),
    }),
  });
  assert.equal(graphResult.response.status, 201, JSON.stringify(graphResult.payload));
  let target = await request(fixture.baseUrl, '/api/state?view=target');
  assert.equal(target.payload.draft.developmentContract.acceptanceCriteria[0].statement, originalStatement);
  assert.notEqual(target.payload.draft.developmentContract.contractId, approvedBefore.payload.developmentContract.contractId);

  const updateEvidenceId = 'evidence-inherited-contract-update';
  const updateRun = await createRun(fixture.baseUrl, { view: 'target' });
  const updatedStatement = 'The next target remains reconciled with the formal architecture contract.';
  const update = await request(fixture.baseUrl, `/api/agent/runs/${updateRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: contractPatchProposal({
        artifactId: 'proposal-inherited-contract-update', evidenceId: updateEvidenceId,
        upsert: [{
          id: criterionId,
          statement: updatedStatement,
          targetRefs: approvedBefore.payload.developmentContract.acceptanceCriteria[0].targetRefs,
        }],
      }),
      evidenceManifest: contractDiscussionManifest('evidence-inherited-contract-update-manifest', updateEvidenceId, 'The user clarified the inherited criterion for the next target.'),
    }),
  });
  assert.equal(update.response.status, 201, JSON.stringify(update.payload));
  target = await request(fixture.baseUrl, '/api/state?view=target');
  assert.equal(target.payload.draft.developmentContract.acceptanceCriteria.find((criterion) => criterion.id === criterionId).statement, updatedStatement);

  const deleteEvidenceId = 'evidence-inherited-contract-delete';
  const deleteRun = await createRun(fixture.baseUrl, { view: 'target' });
  const deleted = await request(fixture.baseUrl, `/api/agent/runs/${deleteRun.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: contractPatchProposal({
        artifactId: 'proposal-inherited-contract-delete', evidenceId: deleteEvidenceId, remove: [criterionId],
      }),
      evidenceManifest: contractDiscussionManifest('evidence-inherited-contract-delete-manifest', deleteEvidenceId, 'The user withdrew one inherited criterion from the next unpublished target.'),
    }),
  });
  assert.equal(deleted.response.status, 201, JSON.stringify(deleted.payload));
  target = await request(fixture.baseUrl, '/api/state?view=target');
  assert.equal(target.payload.draft.developmentContract.acceptanceCriteria.some((criterion) => criterion.id === criterionId), false);

  const approvedAfter = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.deepEqual(approvedAfter.payload.formalBaseline, approvedBefore.payload.formalBaseline);
  assert.deepEqual(approvedAfter.payload.developmentContract, approvedBefore.payload.developmentContract);
  assert.deepEqual(approvedAfter.payload.architecture, approvedBefore.payload.architecture);
});

test('a local PUT that creates the first target draft also inherits the published criteria without frozen identity', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const target = await request(fixture.baseUrl, '/api/state?view=target');
  const graph = structuredClone(target.payload.published.graph);
  graph.nodes[0].position.x += 20;
  const saved = await request(fixture.baseUrl, '/api/draft?view=target', {
    method: 'PUT',
    body: body(draftRequest(target.payload, graph)),
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.payload));
  assert.deepEqual(
    saved.payload.draft.developmentContract.acceptanceCriteria,
    target.payload.published.developmentContract.acceptanceCriteria,
  );
  assert.notEqual(saved.payload.draft.developmentContract.contractId, target.payload.published.developmentContract.contractId);
  assert.equal(saved.payload.draft.developmentContract.status, 'draft');
  assert.equal(saved.payload.draft.developmentContract.target.revisionId, null);
  assert.equal(saved.payload.draft.developmentContract.contractHash, null);
});

test('registered project documents bind a published contract by ID and hash without becoming code facts', async (t) => {
  const fixture = await startFixture(t, { separateWorkspace: true, clearTargetDraft: true });
  const preview = await request(
    fixture.baseUrl,
    '/api/documents/registered-target-design/preview?section=Human%20boundary',
  );
  assert.equal(preview.response.status, 200, JSON.stringify(preview.payload));
  assert.equal(preview.payload.documentId, 'registered-target-design');
  assert.match(preview.payload.contentHash, /^[a-f0-9]{64}$/);
  assert.match(preview.payload.content, /user directly controls approval/i);

  const targetRun = await createRun(fixture.baseUrl, {
    view: 'target',
    summary: 'Create a target from a registered project document.',
  });
  const manifest = registeredDocumentEvidenceManifest(preview.payload.contentHash);
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${targetRun.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: registeredDocumentProposal(), evidenceManifest: manifest }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));

  const analysis = await request(fixture.baseUrl, '/api/analysis');
  const evidence = analysis.payload.evidence.find((item) => item.id === 'evidence-registered-target-boundary');
  assert.equal(evidence.sourceKind, 'project-document');
  assert.equal(evidence.documentId, 'registered-target-design');
  assert.equal(evidence.section, 'Human boundary');
  assert.equal(evidence.path, null);
  const target = await request(fixture.baseUrl, '/api/state?view=target');
  assert.equal(target.payload.draft.developmentContract.status, 'draft');
  assert.equal(target.payload.draft.developmentContract.documents[0].id, 'registered-target-design');
  assert.equal(target.payload.draft.developmentContract.acceptanceCriteria[0].id, 'criterion-human-boundary-visible');

  const lane = target.payload;
  const published = await request(fixture.baseUrl, '/api/publish?view=target', {
    method: 'POST',
    body: body({
      schemaVersion: lane.schemaVersion,
      expectedHeadRevision: lane.published.revision,
      expectedHeadRevisionId: lane.published.revisionId,
      expectedDraftId: lane.draft.draftId,
      expectedDraftRevision: lane.draft.draftRevision,
      message: 'Freeze registered target contract',
      userConfirmed: true,
    }),
  });
  assert.equal(published.response.status, 200, JSON.stringify(published.payload));
  assert.equal(published.payload.published.developmentContract.status, 'executable');

  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.equal(approved.payload.baselineStatus, 'executable-formal-baseline');
  assert.equal(approved.payload.developmentContract.documents[0].contentHash, preview.payload.fullContentHash);
  const compactNode = approved.payload.architecture.graph.nodes.find((node) => node.id === 'human-decision-boundary');
  assert.deepEqual(compactNode.data.documentRefs, ['registered-target-design']);
  assert.deepEqual(compactNode.data.interactionModes, ['human-ui', 'system-service']);
  assert.equal(compactNode.data.architectureLayer, 'application-layer');

  const implementationRun = await createRun(fixture.baseUrl, {
    taskType: 'implementation-reconcile',
    view: 'current',
    summary: 'Lock the published contract and its registered document.',
  });
  assert.equal(implementationRun.approvedTarget.contractHash, approved.payload.formalBaseline.contractHash);
  fs.appendFileSync(fixture.registeredDocumentFile, '\nThe contract text changed after the run lock.\n', 'utf8');
  const staleSnapshot = implementationSnapshot(approved.payload.architecture, { artifactId: 'snapshot-stale-document' });
  const stale = await request(fixture.baseUrl, `/api/agent/runs/${implementationRun.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: staleSnapshot, evidenceManifest: implementationEvidenceManifest(fixture.sourceContent) }),
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.code, 'AGENT_BOUND_DOCUMENT_STALE');

  fs.writeFileSync(fixture.registeredDocumentFile, fixture.registeredDocumentContent, 'utf8');
  const currentRun = await createRun(fixture.baseUrl, {
    taskType: 'architecture-change-plan',
    view: 'current',
    summary: 'A registered design must not prove current implementation.',
  });
  const forbiddenProposal = registeredDocumentProposal();
  forbiddenProposal.artifactId = 'proposal-registered-document-as-current';
  const forbiddenManifest = structuredClone(manifest);
  forbiddenManifest.artifactId = 'evidence-registered-design-current-attempt';
  const forbidden = await request(fixture.baseUrl, `/api/agent/runs/${currentRun.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: forbiddenProposal, evidenceManifest: forbiddenManifest }),
  });
  assert.equal(forbidden.response.status, 422);
  assert.equal(forbidden.payload.code, 'AGENT_EVIDENCE_BASIS_FORBIDDEN');

  const originalRegistry = JSON.parse(fs.readFileSync(fixture.documentsFile, 'utf8'));
  const registeredIndex = originalRegistry.documents.findIndex((item) => item.id === 'registered-target-design');
  const verificationOnlyRegistry = structuredClone(originalRegistry);
  verificationOnlyRegistry.documents[registeredIndex].lastVerifiedAt = '2030-01-01T00:00:00.000Z';
  fs.writeFileSync(fixture.documentsFile, `${JSON.stringify(verificationOnlyRegistry, null, 2)}\n`, 'utf8');
  const stillExecutable = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.equal(stillExecutable.payload.baselineStatus, 'executable-formal-baseline');

  const copiedDocumentPath = path.join(fixture.projectRoot, 'documents', 'registered-target-copy.md');
  fs.copyFileSync(fixture.registeredDocumentFile, copiedDocumentPath);
  const bindingMutations = [
    ['archived', (document) => { document.status = 'archived'; }],
    ['superseded', (document) => { document.status = 'superseded'; }],
    ['authority', (document) => { document.authority = 'supporting'; }],
    ['path', (document) => { document.path = 'documents/registered-target-copy.md'; }],
  ];
  for (const [label, mutate] of bindingMutations) {
    const changedRegistry = structuredClone(originalRegistry);
    mutate(changedRegistry.documents[registeredIndex]);
    fs.writeFileSync(fixture.documentsFile, `${JSON.stringify(changedRegistry, null, 2)}\n`, 'utf8');
    const staleTarget = await request(fixture.baseUrl, '/api/agent/approved-target');
    assert.equal(staleTarget.payload.baselineStatus, 'stale-formal-contract', label);
    assert.equal(staleTarget.payload.executionIssue.code, 'AGENT_BOUND_DOCUMENT_STALE', label);

    const metadataStale = await request(fixture.baseUrl, `/api/agent/runs/${implementationRun.id}/artifacts`, {
      method: 'POST',
      body: body({
        artifact: implementationSnapshot(approved.payload.architecture, { artifactId: `snapshot-stale-${label}` }),
        evidenceManifest: implementationEvidenceManifest(fixture.sourceContent),
      }),
    });
    assert.equal(metadataStale.response.status, 409, label);
    assert.equal(metadataStale.payload.code, 'AGENT_BOUND_DOCUMENT_STALE', label);
  }
  fs.writeFileSync(fixture.documentsFile, `${JSON.stringify(originalRegistry, null, 2)}\n`, 'utf8');
});

test('target publication freezes exactly the bound documents reviewed in the draft contract', async (t) => {
  const fixture = await startFixture(t, { separateWorkspace: true, clearTargetDraft: true });
  const preview = await request(fixture.baseUrl, '/api/documents/registered-target-design/preview?section=Human%20boundary');
  const run = await createRun(fixture.baseUrl, { view: 'target', summary: 'Prepare a document-bound target draft.' });
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: registeredDocumentProposal(),
      evidenceManifest: registeredDocumentEvidenceManifest(preview.payload.contentHash),
    }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
  const reviewedLane = (await request(fixture.baseUrl, '/api/state?view=target')).payload;
  const publishBody = publishRequest(reviewedLane, 'Publish the reviewed document-bound target');
  const originalRegistry = JSON.parse(fs.readFileSync(fixture.documentsFile, 'utf8'));
  const boundIndex = originalRegistry.documents.findIndex((document) => document.id === 'registered-target-design');
  const copiedPath = path.join(fixture.projectRoot, 'documents', 'registered-target-copy.md');
  fs.copyFileSync(fixture.registeredDocumentFile, copiedPath);

  const assertStalePublish = async (label) => {
    const before = (await request(fixture.baseUrl, '/api/state?view=target')).payload;
    const rejected = await request(fixture.baseUrl, '/api/publish?view=target', { method: 'POST', body: body(publishBody) });
    assert.equal(rejected.response.status, 409, `${label}: ${JSON.stringify(rejected.payload)}`);
    assert.equal(rejected.payload.code, 'DRAFT_BOUND_DOCUMENT_STALE', label);
    const after = (await request(fixture.baseUrl, '/api/state?view=target')).payload;
    assert.deepEqual(after.published, before.published, `${label} changed published`);
    assert.deepEqual(after.draft, before.draft, `${label} changed draft`);
    assert.equal(after.historyCount, before.historyCount, `${label} changed history`);
  };

  fs.appendFileSync(fixture.registeredDocumentFile, '\nChanged after the publication preview.\n', 'utf8');
  await assertStalePublish('content');
  fs.writeFileSync(fixture.registeredDocumentFile, fixture.registeredDocumentContent, 'utf8');

  for (const [label, mutate] of [
    ['path', (document) => { document.path = 'documents/registered-target-copy.md'; }],
    ['status', (document) => { document.status = 'archived'; }],
    ['authority', (document) => { document.authority = 'supporting'; }],
  ]) {
    const changed = structuredClone(originalRegistry);
    mutate(changed.documents[boundIndex]);
    fs.writeFileSync(fixture.documentsFile, `${JSON.stringify(changed, null, 2)}\n`, 'utf8');
    await assertStalePublish(label);
    fs.writeFileSync(fixture.documentsFile, `${JSON.stringify(originalRegistry, null, 2)}\n`, 'utf8');
  }

  const harmless = structuredClone(originalRegistry);
  harmless.documents[boundIndex].lastVerifiedAt = '2031-01-01T00:00:00.000Z';
  const unrelatedIndex = harmless.documents.findIndex((document) => document.id !== 'registered-target-design');
  harmless.documents[unrelatedIndex].summary = 'Unbound registry metadata changed after draft review.';
  fs.writeFileSync(fixture.documentsFile, `${JSON.stringify(harmless, null, 2)}\n`, 'utf8');
  const published = await request(fixture.baseUrl, '/api/publish?view=target', { method: 'POST', body: body(publishBody) });
  assert.equal(published.response.status, 200, JSON.stringify(published.payload));
  assert.deepEqual(
    published.payload.published.developmentContract.documents.map(contractDocumentBindingForTest),
    reviewedLane.draft.developmentContract.documents.map(contractDocumentBindingForTest),
  );
});

test('a local user can refresh a stale target document lock before explicitly publishing again', async (t) => {
  const fixture = await startFixture(t, { separateWorkspace: true, clearTargetDraft: true });
  const preview = await request(fixture.baseUrl, '/api/documents/registered-target-design/preview?section=Human%20boundary');
  const run = await createRun(fixture.baseUrl, { view: 'target', summary: 'Prepare a refreshable document-bound target draft.' });
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: registeredDocumentProposal({ artifactId: 'proposal-refresh-document-lock' }),
      evidenceManifest: registeredDocumentEvidenceManifest(preview.payload.contentHash),
    }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
  const reviewed = (await request(fixture.baseUrl, '/api/state?view=target')).payload;
  const oldHash = reviewed.draft.developmentContract.documents[0].contentHash;
  fs.appendFileSync(fixture.registeredDocumentFile, '\nAn intentional new design revision.\n', 'utf8');

  const stale = await request(fixture.baseUrl, '/api/publish?view=target', {
    method: 'POST',
    body: body(publishRequest(reviewed, 'Attempt to publish the stale preview')),
  });
  assert.equal(stale.response.status, 409, JSON.stringify(stale.payload));
  assert.equal(stale.payload.code, 'DRAFT_BOUND_DOCUMENT_STALE');

  const refreshed = await request(fixture.baseUrl, '/api/draft/refresh-documents?view=target', {
    method: 'POST',
    body: body(laneLockRequest(reviewed)),
  });
  assert.equal(refreshed.response.status, 200, JSON.stringify(refreshed.payload));
  assert.equal(refreshed.payload.draft.draftId, reviewed.draft.draftId);
  assert.equal(refreshed.payload.draft.draftRevision, reviewed.draft.draftRevision + 1);
  assert.notEqual(refreshed.payload.draft.developmentContract.documents[0].contentHash, oldHash);
  assert.deepEqual(refreshed.payload.draft.graph, reviewed.draft.graph);
  assert.deepEqual(refreshed.payload.draft.developmentContract.acceptanceCriteria, reviewed.draft.developmentContract.acceptanceCriteria);
  assert.deepEqual(refreshed.payload.published, reviewed.published);
  assert.equal(refreshed.payload.historyCount, reviewed.historyCount);

  const stillDraft = (await request(fixture.baseUrl, '/api/state?view=target')).payload;
  assert.ok(stillDraft.draft, 'refresh must not publish the draft');
  assert.deepEqual(stillDraft.published, reviewed.published);
  const published = await request(fixture.baseUrl, '/api/publish?view=target', {
    method: 'POST',
    body: body(publishRequest(stillDraft, 'Explicitly publish after reviewing the refreshed lock')),
  });
  assert.equal(published.response.status, 200, JSON.stringify(published.payload));
  assert.equal(published.payload.draft, null);
  assert.equal(
    published.payload.published.developmentContract.documents[0].contentHash,
    refreshed.payload.draft.developmentContract.documents[0].contentHash,
  );

  const currentLane = (await request(fixture.baseUrl, '/api/state?view=current')).payload;
  const wrongLane = await request(fixture.baseUrl, '/api/draft/refresh-documents?view=current', {
    method: 'POST',
    body: body(laneLockRequest(currentLane)),
  });
  assert.equal(wrongLane.response.status, 422);
  assert.equal(wrongLane.payload.code, 'DRAFT_DOCUMENT_REFRESH_TARGET_ONLY');
});

test('an agent can merge a document binding into the exact active target draft without touching published', async (t) => {
  const fixture = await startFixture(t, { separateWorkspace: true });
  const before = await request(fixture.baseUrl, '/api/state?view=target');
  assert.ok(before.payload.draft);
  const processingBefore = structuredClone(
    before.payload.draft.graph.nodes.find((node) => node.id === 'processing-module'),
  );
  const edgesBefore = structuredClone(before.payload.draft.graph.edges);
  const contractBefore = structuredClone(before.payload.draft.developmentContract);

  const preview = await request(
    fixture.baseUrl,
    '/api/documents/registered-target-design/preview?section=Human%20boundary',
  );
  const run = await createRun(fixture.baseUrl, {
    view: 'target',
    summary: 'Bind one registered document to the unchanged active target draft.',
  });
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: registeredDocumentBindingProposal(),
      evidenceManifest: registeredDocumentEvidenceManifest(preview.payload.contentHash),
    }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
  assert.equal(submitted.payload.submission.requiresHumanReview, false);
  assert.equal(submitted.payload.submission.requiresPublication, true);
  const after = await request(fixture.baseUrl, '/api/state?view=target');
  assert.equal(after.payload.draft.draftId, before.payload.draft.draftId);
  assert.equal(after.payload.draft.draftRevision, before.payload.draft.draftRevision + 1);
  assert.deepEqual(after.payload.draft.graph.edges, edgesBefore);
  const processingAfter = after.payload.draft.graph.nodes.find((node) => node.id === 'processing-module');
  assert.deepEqual(processingAfter.position, processingBefore.position);
  assert.equal(processingAfter.width, processingBefore.width);
  assert.deepEqual(processingAfter.data.documentRefs, ['registered-target-design']);
  assert.equal(after.payload.draft.developmentContract.contractId, contractBefore.contractId);
  assert.equal(after.payload.draft.developmentContract.documents[0].id, 'registered-target-design');
  assert.equal(
    after.payload.draft.developmentContract.acceptanceCriteria.some(
      (criterion) => criterion.id === 'criterion-registered-design-bound',
    ),
    true,
  );
  assert.deepEqual(after.payload.published, before.payload.published);
});

test('an agent draft write is rejected when the active draft changes after the run lock', async (t) => {
  const fixture = await startFixture(t, { separateWorkspace: true });
  const preview = await request(
    fixture.baseUrl,
    '/api/documents/registered-target-design/preview?section=Human%20boundary',
  );
  const run = await createRun(fixture.baseUrl, { view: 'target' });
  const target = await request(fixture.baseUrl, '/api/state?view=target');
  const concurrentGraph = structuredClone(target.payload.draft.graph);
  concurrentGraph.nodes.find((node) => node.id === 'processing-module').position.y += 11;
  const concurrent = await request(fixture.baseUrl, '/api/draft?view=target', {
    method: 'PUT',
    body: body(draftRequest(target.payload, concurrentGraph)),
  });
  assert.equal(concurrent.response.status, 200, JSON.stringify(concurrent.payload));

  const stale = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: registeredDocumentBindingProposal({ artifactId: 'proposal-stale-draft-binding' }),
      evidenceManifest: registeredDocumentEvidenceManifest(preview.payload.contentHash),
    }),
  });
  assert.equal(stale.response.status, 409, JSON.stringify(stale.payload));
  assert.equal(stale.payload.code, 'AGENT_RUN_STALE');
  assert.equal(stale.payload.details.expectedLaneLock.draftRevision, target.payload.draft.draftRevision);
  assert.equal(stale.payload.details.actualLaneLock.draftRevision, concurrent.payload.draft.draftRevision);

  const afterState = await request(fixture.baseUrl, '/api/state?view=target');
  assert.equal(afterState.payload.draft.draftRevision, concurrent.payload.draft.draftRevision);
  assert.equal(
    afterState.payload.draft.graph.nodes.find((node) => node.id === 'processing-module').data.documentRefs,
    undefined,
  );
  const afterAnalysis = await request(fixture.baseUrl, '/api/analysis');
  assert.equal(afterAnalysis.payload.proposals.some((proposal) => proposal.id === 'proposal-stale-draft-binding'), false);
});

test('an agent draft write is rejected when the published baseline changes after the run lock', async (t) => {
  const fixture = await startFixture(t, { separateWorkspace: true });
  const preview = await request(
    fixture.baseUrl,
    '/api/documents/registered-target-design/preview?section=Human%20boundary',
  );
  const run = await createRun(fixture.baseUrl, { view: 'target' });
  const target = await request(fixture.baseUrl, '/api/state?view=target');
  const published = await request(fixture.baseUrl, '/api/publish?view=target', {
    method: 'POST',
    body: body(publishRequest(target.payload, 'Publish the pre-existing target draft first')),
  });
  assert.equal(published.response.status, 200, JSON.stringify(published.payload));
  const publishedSnapshot = structuredClone(published.payload.published);

  const stale = await request(
    fixture.baseUrl,
    `/api/agent/runs/${run.id}/artifacts`,
    {
      method: 'POST',
      body: body({
        artifact: registeredDocumentBindingProposal({ artifactId: 'proposal-stale-published-binding' }),
        evidenceManifest: registeredDocumentEvidenceManifest(preview.payload.contentHash),
      }),
    },
  );
  assert.equal(stale.response.status, 409, JSON.stringify(stale.payload));
  assert.equal(stale.payload.code, 'AGENT_RUN_STALE');
  assert.equal(stale.payload.details.expectedLaneLock.publishedRevision, 0);
  assert.equal(stale.payload.details.actualLaneLock.publishedRevision, 1);
  const after = await request(fixture.baseUrl, '/api/state?view=target');
  assert.deepEqual(after.payload.published, publishedSnapshot);
  assert.equal(after.payload.draft, null);
});

test('directly tampering with a published target graph invalidates its frozen contract and old run', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.equal(approved.payload.baselineStatus, 'executable-formal-baseline');
  assert.equal(
    approved.payload.developmentContract.target.semanticHash,
    approved.payload.formalBaseline.semanticHash,
  );
  const run = await createRun(fixture.baseUrl, {
    taskType: 'implementation-reconcile',
    view: 'current',
    summary: 'Lock the published target before a direct-file tamper attempt.',
  });

  const state = JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8'));
  state.target.published.graph.nodes[0].data.purpose = 'This responsibility was changed outside the publication workflow.';
  fs.writeFileSync(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const invalidTarget = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.equal(invalidTarget.response.status, 200);
  assert.equal(invalidTarget.payload.baselineStatus, 'stale-formal-contract');
  assert.equal(invalidTarget.payload.formalBaseline, null);
  assert.equal(invalidTarget.payload.executionIssue.code, 'AGENT_TARGET_CONTRACT_INVALID');
  const invalidContext = await request(fixture.baseUrl, '/api/agent/context?view=target');
  assert.equal(invalidContext.response.status, 200);
  assert.equal(invalidContext.payload.selected.baselineStatus, invalidTarget.payload.baselineStatus);
  assert.equal(invalidContext.payload.selected.formalBaseline, null);
  assert.equal(
    invalidContext.payload.selected.executionIssue.code,
    invalidTarget.payload.executionIssue.code,
  );

  const staleSnapshot = implementationSnapshot(approved.payload.architecture, {
    artifactId: 'snapshot-after-target-graph-tamper',
  });
  const staleSubmission = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: staleSnapshot,
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent),
    }),
  });
  assert.equal(staleSubmission.response.status, 409);
  assert.equal(staleSubmission.payload.code, 'AGENT_TARGET_CONTRACT_INVALID');

  const rejectedRun = await request(fixture.baseUrl, '/api/agent/runs', {
    method: 'POST',
    body: body({
      agentName: 'Codex',
      agentClient: 'codex',
      taskType: 'implementation-reconcile',
      view: 'current',
      summary: 'A tampered target must not become a new implementation baseline.',
    }),
  });
  assert.equal(rejectedRun.response.status, 409);
  assert.equal(rejectedRun.payload.code, 'AGENT_TARGET_CONTRACT_INVALID');
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

test('a migrated pending proposal without a lane lock remains readable history without a fabricated decision', async (t) => {
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
  stored.proposals[0].status = 'pending';
  stored.proposals[0].application = null;
  stored.proposals[0].reviewedAt = null;
  delete stored.proposals[0].laneLock;
  delete stored.agentRuns[0].laneLock;
  fs.writeFileSync(fixture.analysisFile, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

  const readable = await request(fixture.baseUrl, '/api/analysis');
  assert.equal(readable.response.status, 200);
  assert.equal(readable.payload.proposals[0].evidence[0].basis, 'design-document');
  assert.equal(readable.payload.proposals[0].status, 'pending');
  assert.equal(readable.payload.proposals[0].reviewedAt, null);
  const accepted = await request(fixture.baseUrl, '/api/analysis/proposals/proposal-legacy-design-current/accept', {
    method: 'POST',
    body: body({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      baseRevision: readable.payload.baseRevision,
      userConfirmed: true,
    }),
  });
  assert.equal(accepted.response.status, 410);
  assert.equal(accepted.payload.code, 'PROPOSAL_REVIEW_RETIRED');
  const targetAfter = await request(fixture.baseUrl, '/api/state?view=current');
  assert.equal(targetAfter.payload.draft, null);
  const after = await request(fixture.baseUrl, '/api/analysis');
  assert.equal(after.payload.proposals[0].status, 'pending');
  assert.equal(after.payload.proposals[0].reviewedAt, null);
});

test('a legacy agent run without a lane lock remains readable but cannot create a new proposal', async (t) => {
  const fixture = await startFixture(t);
  const run = await createRun(fixture.baseUrl);
  const stored = JSON.parse(fs.readFileSync(fixture.analysisFile, 'utf8'));
  delete stored.agentRuns[0].laneLock;
  fs.writeFileSync(fixture.analysisFile, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

  const readable = await request(fixture.baseUrl, `/api/agent/runs/${run.id}`);
  assert.equal(readable.response.status, 200, JSON.stringify(readable.payload));
  assert.equal(readable.payload.run.laneLock, undefined);
  const rejected = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: changeProposal(),
      evidenceManifest: evidenceManifest(fixture.sourceContent),
    }),
  });
  assert.equal(rejected.response.status, 409, JSON.stringify(rejected.payload));
  assert.equal(rejected.payload.code, 'AGENT_LANE_LOCK_REQUIRED');
  const after = await request(fixture.baseUrl, '/api/analysis');
  assert.equal(after.payload.proposals.length, 0);
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
  assert.equal(run.approvedTarget.status, 'executable-formal-baseline');
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
    acceptedCriterionCount: 2,
    criterionCount: 2,
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
  assert.equal(submitted.payload.run.contractGate.status, 'satisfied');
  assert.deepEqual(submitted.payload.run.contractGate.counts, {
    satisfied: 2,
    unsatisfied: 0,
    unverified: 0,
  });
  assert.equal(submitted.payload.run.contractGate.readyForAcceptance, true);
  assert.equal(submitted.payload.run.humanReview, null);
  assert.equal(submitted.payload.run.status, 'submitted');
  assert.equal(submitted.payload.permissions.requiresHumanReview, true);
  assert.equal(submitted.payload.permissions.canAcceptImplementation, true);
  assert.equal(submitted.payload.permissions.agentCanReview, false);
  assert.equal('drift' in submitted.payload.run.architectureGate, false, 'default review response stays compact');
  assert.equal('criteria' in submitted.payload.run.contractGate, false, 'default contract response stays compact');

  const detailed = await request(fixture.baseUrl, `/api/agent/runs/${run.id}?details=review-gates`);
  assert.equal(detailed.payload.run.architectureGate.status, 'aligned');
  assert.deepEqual(detailed.payload.run.architectureGate.drift, []);
  assert.equal(detailed.payload.run.architectureGate.crossCheck.matches, true);
  assert.equal(detailed.payload.run.contractGate.status, 'satisfied');
  assert.equal(detailed.payload.run.contractGate.criteria.length, 2);
  assert.equal(
    detailed.payload.run.contractGate.criteria[0].statement,
    'The implementation is reconciled with the published formal target.',
  );
  assert.deepEqual(
    detailed.payload.run.contractGate.criteria[0].targetRefs,
    approved.payload.developmentContract.acceptanceCriteria[0].targetRefs,
  );

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
  assert.equal(reviewStatus.payload.run.contractGate.status, 'satisfied');
  assert.equal('drift' in reviewStatus.payload.run.architectureGate, false);
  assert.equal(reviewStatus.payload.run.humanReview.decision, 'accepted');
});

test('partial or contract-incomplete agent claims cannot be silently accepted as complete', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  const cases = [
    {
      label: 'partial',
      status: 'partial',
      acceptanceResults: [
        {
          criterionId: 'criterion-formal-target-aligned',
          status: 'satisfied',
          evidenceIds: ['evidence-service-behavior'],
        },
        {
          criterionId: 'criterion-boundaries-preserved',
          status: 'satisfied',
          evidenceIds: ['evidence-service-behavior'],
        },
      ],
      expectedGateStatus: 'claim-incomplete',
      expectedCounts: { satisfied: 2, unsatisfied: 0, unverified: 0 },
    },
    {
      label: 'blocked',
      status: 'blocked',
      acceptanceResults: [
        {
          criterionId: 'criterion-formal-target-aligned',
          status: 'unsatisfied',
          evidenceIds: [],
        },
        {
          criterionId: 'criterion-boundaries-preserved',
          status: 'unverified',
          evidenceIds: [],
        },
      ],
      expectedGateStatus: 'criteria-unmet',
      expectedCounts: { satisfied: 0, unsatisfied: 1, unverified: 1 },
    },
  ];

  for (const item of cases) {
    const run = await createRun(fixture.baseUrl, {
      taskType: 'implementation-reconcile',
      view: 'current',
      summary: `Verify the ${item.label} contract gate.`,
    });
    const snapshot = implementationSnapshot(approved.payload.architecture, {
      artifactId: `snapshot-contract-gate-${item.label}`,
    });
    const snapshotSubmitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
      method: 'POST',
      body: body({
        artifact: snapshot,
        evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, {
          artifactId: `evidence-contract-gate-snapshot-${item.label}`,
        }),
      }),
    });
    assert.equal(snapshotSubmitted.response.status, 201, JSON.stringify(snapshotSubmitted.payload));

    const report = implementationReportV12(run, snapshot, {
      artifactId: `report-contract-gate-${item.label}`,
      status: item.status,
      acceptanceResults: item.acceptanceResults,
      unresolved: item.status === 'blocked' ? ['The formal contract is not fulfilled.'] : [],
    });
    const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
      method: 'POST',
      body: body({
        artifact: report,
        evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, {
          artifactId: `evidence-contract-gate-report-${item.label}`,
        }),
      }),
    });
    assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
    assert.equal(submitted.payload.run.architectureGate.status, 'aligned');
    assert.equal(submitted.payload.run.contractGate.status, item.expectedGateStatus);
    assert.deepEqual(submitted.payload.run.contractGate.counts, item.expectedCounts);
    assert.equal(submitted.payload.run.contractGate.readyForAcceptance, false);
    assert.equal(submitted.payload.permissions.canAcceptImplementation, false);

    const detailed = await request(fixture.baseUrl, `/api/agent/runs/${run.id}?details=contract-gate`);
    assert.equal(detailed.payload.run.contractGate.criteria.length, 2);
    assert.equal(
      detailed.payload.run.contractGate.criteria[0].statement,
      approved.payload.developmentContract.acceptanceCriteria[0].statement,
    );
    assert.deepEqual(
      detailed.payload.run.contractGate.criteria.map((criterion) => criterion.status),
      item.acceptanceResults.map((criterion) => criterion.status),
    );

    const accepted = await reviewImplementation(
      fixture.baseUrl,
      run.id,
      'accepted',
      'An aligned graph must not hide an incomplete formal development contract.',
    );
    assert.equal(accepted.response.status, 409, item.label);
    assert.equal(accepted.payload.code, 'IMPLEMENTATION_CONTRACT_GATE_NOT_READY', item.label);
    const afterRejectedAcceptance = await request(fixture.baseUrl, '/api/analysis');
    assert.equal(
      afterRejectedAcceptance.payload.runs.find((candidate) => candidate.id === run.id).humanReview,
      null,
    );

    const revisionRequested = await reviewImplementation(
      fixture.baseUrl,
      run.id,
      'revision-requested',
      'Fulfil and verify every frozen acceptance criterion before acceptance.',
    );
    assert.equal(revisionRequested.response.status, 200, JSON.stringify(revisionRequested.payload));
    const reviewedRun = revisionRequested.payload.runs.find((candidate) => candidate.id === run.id);
    assert.equal(reviewedRun.humanReview.decision, 'revision-requested');
  }
});

test('a readable legacy implementation run without a contract gate cannot be accepted', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const run = await createRun(fixture.baseUrl, {
    taskType: 'implementation-reconcile',
    view: 'current',
  });
  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  const snapshot = implementationSnapshot(approved.payload.architecture, {
    artifactId: 'snapshot-legacy-contract-gate',
  });
  const snapshotSubmitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: snapshot, evidenceManifest: implementationEvidenceManifest(fixture.sourceContent) }),
  });
  assert.equal(snapshotSubmitted.response.status, 201, JSON.stringify(snapshotSubmitted.payload));
  const report = implementationReportV12(run, snapshot, {
    artifactId: 'report-legacy-contract-gate',
    status: 'complete',
  });
  const reportSubmitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: report,
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, {
        artifactId: 'evidence-report-legacy-contract-gate',
      }),
    }),
  });
  assert.equal(reportSubmitted.response.status, 201, JSON.stringify(reportSubmitted.payload));

  const stored = JSON.parse(fs.readFileSync(fixture.analysisFile, 'utf8'));
  stored.agentRuns.find((candidate) => candidate.id === run.id).contractGate = null;
  fs.writeFileSync(fixture.analysisFile, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  const readable = await request(fixture.baseUrl, `/api/agent/runs/${run.id}`);
  assert.equal(readable.response.status, 200, JSON.stringify(readable.payload));
  assert.equal(readable.payload.run.contractGate, null);
  assert.equal(readable.payload.permissions.canAcceptImplementation, false);

  const accepted = await reviewImplementation(
    fixture.baseUrl,
    run.id,
    'accepted',
    'A legacy run without a formal contract gate must not be accepted.',
  );
  assert.equal(accepted.response.status, 409);
  assert.equal(accepted.payload.code, 'IMPLEMENTATION_CONTRACT_GATE_REQUIRED');

  const revisionRequested = await reviewImplementation(
    fixture.baseUrl,
    run.id,
    'revision-requested',
    'Create a new implementation run bound to the current formal contract.',
  );
  assert.equal(revisionRequested.response.status, 200, JSON.stringify(revisionRequested.payload));
  const reviewedRun = revisionRequested.payload.runs.find((candidate) => candidate.id === run.id);
  assert.equal(reviewedRun.humanReview.decision, 'revision-requested');
});

test('implementation acceptance results must exactly reference the frozen contract criteria', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const run = await createRun(fixture.baseUrl, {
    taskType: 'implementation-reconcile',
    view: 'current',
  });
  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  const snapshot = implementationSnapshot(approved.payload.architecture, { artifactId: 'snapshot-contract-criteria' });
  const manifest = implementationEvidenceManifest(fixture.sourceContent, {
    artifactId: 'evidence-contract-criteria',
  });
  const submittedSnapshot = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: snapshot, evidenceManifest: manifest }),
  });
  assert.equal(submittedSnapshot.response.status, 201, JSON.stringify(submittedSnapshot.payload));

  const missingReport = implementationReportV12(run, snapshot, {
    artifactId: 'report-missing-contract-criterion',
    acceptanceResults: [{
      criterionId: 'criterion-formal-target-aligned',
      status: 'satisfied',
      evidenceIds: ['evidence-service-behavior'],
    }],
  });
  const missing = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: missingReport, evidenceManifest: manifest }),
  });
  assert.equal(missing.response.status, 422);
  assert.equal(missing.payload.code, 'AGENT_ACCEPTANCE_CONTRACT_MISMATCH');
  assert.deepEqual(missing.payload.details.missingCriterionIds, ['criterion-boundaries-preserved']);

  const extraReport = implementationReportV12(run, snapshot, {
    artifactId: 'report-extra-contract-criterion',
  });
  extraReport.acceptanceResults.push({
    criterionId: 'criterion-agent-invented',
    status: 'satisfied',
    evidenceIds: ['evidence-service-behavior'],
  });
  const extra = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: extraReport, evidenceManifest: manifest }),
  });
  assert.equal(extra.response.status, 422);
  assert.equal(extra.payload.code, 'AGENT_ACCEPTANCE_CONTRACT_MISMATCH');
  assert.deepEqual(extra.payload.details.extraCriterionIds, ['criterion-agent-invented']);

  const tamperedReport = implementationReportV12(run, snapshot, {
    artifactId: 'report-tampered-contract-criterion',
  });
  tamperedReport.acceptanceResults[0].criterion = 'The agent rewrote the published criterion.';
  const tampered = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: tamperedReport, evidenceManifest: manifest }),
  });
  assert.equal(tampered.response.status, 422);
  assert.equal(tampered.payload.code, 'AI_CODING_ARTIFACT_INVALID');

  const validReport = implementationReportV12(run, snapshot, { artifactId: 'report-exact-contract-criteria' });
  const valid = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: validReport, evidenceManifest: manifest }),
  });
  assert.equal(valid.response.status, 201, JSON.stringify(valid.payload));
  assert.equal(valid.payload.run.humanReview, null);
  assert.equal(valid.payload.run.architectureGate.readyForHumanReview, true);
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

test('human acceptance rejects an old implementation run after a different formal contract is published', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const run = await createRun(fixture.baseUrl, { taskType: 'implementation-reconcile', view: 'current' });
  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  const snapshot = implementationSnapshot(approved.payload.architecture, {
    artifactId: 'snapshot-stale-human-review-v12',
  });
  const snapshotSubmitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: snapshot,
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, {
        artifactId: 'evidence-stale-human-review-snapshot',
      }),
    }),
  });
  assert.equal(snapshotSubmitted.response.status, 201, JSON.stringify(snapshotSubmitted.payload));

  const reportSubmitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: implementationReportV12(run, snapshot, {
        artifactId: 'report-stale-human-review-v12',
        status: 'complete',
      }),
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, {
        artifactId: 'evidence-stale-human-review-report',
      }),
    }),
  });
  assert.equal(reportSubmitted.response.status, 201, JSON.stringify(reportSubmitted.payload));
  assert.equal(reportSubmitted.payload.run.contractGate.readyForAcceptance, true);
  assert.equal(reportSubmitted.payload.run.humanReview, null);

  advanceFormalTargetWithDifferentCriteria(fixture.stateFile);
  const accepted = await reviewImplementation(
    fixture.baseUrl,
    run.id,
    'accepted',
    'An old implementation run cannot be accepted against a newly published formal contract.',
  );
  assert.equal(accepted.response.status, 409, JSON.stringify(accepted.payload));
  assert.equal(accepted.payload.code, 'AGENT_APPROVED_TARGET_STALE');
  assert.equal(accepted.payload.details.expected.revisionId, 'target-r1');
  assert.equal(accepted.payload.details.actual.revisionId, 'target-r2');

  const analysis = await request(fixture.baseUrl, '/api/analysis');
  const storedRun = analysis.payload.runs.find((item) => item.id === run.id);
  assert.equal(storedRun.humanReview, null);
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
  assert.equal(submitted.payload.submission.requiresHumanReview, false);
  assert.equal(submitted.payload.submission.requiresPublication, true);
  assert.equal(submitted.payload.proposals[0].draftWrite.humanApproved, false);
  const analysis = await request(fixture.baseUrl, '/api/analysis');
  const proposal = analysis.payload.proposals[0];
  assert.equal(proposal.origin.artifactType, 'architecture-snapshot');
  assert.equal(proposal.status, 'draft-applied');
  assert.equal(proposal.changes.some((change) => change.kind === 'remove'), false);
  assert.equal(proposal.changes[0].targetId, 'processing-module');
  const current = await request(fixture.baseUrl, '/api/state?view=current');
  assert.equal(
    current.payload.draft.graph.nodes.find((node) => node.id === 'processing-module').data.purpose,
    'Evaluates repository evidence.',
  );
  assert.equal(
    current.payload.published.graph.nodes.find((node) => node.id === 'processing-module').data.purpose,
    '执行通用处理。',
  );
});

test('implementation reconciliation snapshots remain evidence-only and never write the current draft', async (t) => {
  const fixture = await startFixture(t, { targetFromCurrent: true });
  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  const before = await request(fixture.baseUrl, '/api/state?view=current');
  const run = await createRun(fixture.baseUrl, {
    taskType: 'implementation-reconcile',
    view: 'current',
    summary: 'Reconcile implementation without changing architecture state.',
  });
  const submitted = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body({
      artifact: implementationSnapshot(approved.payload.architecture, { artifactId: 'snapshot-reconcile-evidence-only' }),
      evidenceManifest: implementationEvidenceManifest(fixture.sourceContent, { artifactId: 'evidence-reconcile-evidence-only' }),
    }),
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
  assert.equal(submitted.payload.submission.proposalId, null);
  assert.equal(submitted.payload.submission.draftApplication, null);
  assert.equal(submitted.payload.submission.requiresPublication, false);
  const after = await request(fixture.baseUrl, '/api/state?view=current');
  assert.deepEqual(after.payload.published, before.payload.published);
  assert.deepEqual(after.payload.draft, before.payload.draft);
});

test('idempotent artifact replay does not write state or analysis and preserves the real draft publication status', async (t) => {
  const fixture = await startFixture(t);
  const run = await createRun(fixture.baseUrl);
  const submission = {
    artifact: changeProposal(),
    evidenceManifest: evidenceManifest(fixture.sourceContent),
  };
  const first = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body(submission),
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.payload));
  assert.equal(first.payload.submission.replayed, false);
  assert.equal(first.payload.proposals[0].publication.status, 'awaiting-publication');
  const stateBeforeReplay = fs.readFileSync(fixture.stateFile, 'utf8');
  const analysisBeforeReplay = fs.readFileSync(fixture.analysisFile, 'utf8');

  const replay = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body(submission),
  });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
  assert.equal(replay.payload.submission.replayed, true);
  assert.deepEqual(replay.payload.submission.draftApplication, first.payload.submission.draftApplication);
  assert.equal(replay.payload.submission.requiresPublication, true);
  assert.equal(replay.payload.proposals[0].publication.status, 'awaiting-publication');
  assert.equal(fs.readFileSync(fixture.stateFile, 'utf8'), stateBeforeReplay);
  assert.equal(fs.readFileSync(fixture.analysisFile, 'utf8'), analysisBeforeReplay);
});

test('a failed analysis write rolls back the agent draft without losing provenance consistency', async (t) => {
  let injectFailure = true;
  const fixture = await startFixture(t, {
    serverOptions: {
      afterAgentDraftStateWrite() {
        if (injectFailure) {
          injectFailure = false;
          throw new Error('injected analysis write failure');
        }
      },
    },
  });
  const run = await createRun(fixture.baseUrl);
  const stateBefore = JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8'));
  const analysisBefore = JSON.parse(fs.readFileSync(fixture.analysisFile, 'utf8'));
  const submission = {
    artifact: changeProposal(),
    evidenceManifest: evidenceManifest(fixture.sourceContent),
  };

  const failed = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body(submission),
  });
  assert.equal(failed.response.status, 500, JSON.stringify(failed.payload));
  const stateAfterFailure = JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8'));
  const analysisAfterFailure = JSON.parse(fs.readFileSync(fixture.analysisFile, 'utf8'));
  assert.deepEqual(stateAfterFailure.current.published.graph, stateBefore.current.published.graph);
  assert.deepEqual(stateAfterFailure.current.draft, stateBefore.current.draft);
  assert.equal(analysisAfterFailure.baseRevision, analysisBefore.baseRevision);
  assert.deepEqual(analysisAfterFailure.evidence, analysisBefore.evidence);
  assert.deepEqual(analysisAfterFailure.artifacts, analysisBefore.artifacts);
  assert.deepEqual(analysisAfterFailure.proposals, analysisBefore.proposals);
  assert.deepEqual(analysisAfterFailure.agentRuns, analysisBefore.agentRuns);

  const retried = await request(fixture.baseUrl, `/api/agent/runs/${run.id}/artifacts`, {
    method: 'POST',
    body: body(submission),
  });
  assert.equal(retried.response.status, 201, JSON.stringify(retried.payload));
  assert.equal(retried.payload.submission.requiresPublication, true);
});

test('one run accepts one architecture patch while a new run safely advances the draft lock', async (t) => {
  const fixture = await startFixture(t);
  const firstRun = await createRun(fixture.baseUrl);
  const first = await request(fixture.baseUrl, `/api/agent/runs/${firstRun.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: changeProposal(), evidenceManifest: evidenceManifest(fixture.sourceContent) }),
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.payload));

  const secondProposal = changeProposal();
  secondProposal.artifactId = 'proposal-processing-product';
  secondProposal.requestId = 'request-processing-product';
  secondProposal.changes[0].id = 'change-processing-product';
  secondProposal.changes[0].patch = { data: { product: 'Repository evidence gate' } };
  const secondManifest = evidenceManifest(fixture.sourceContent, { artifactId: 'evidence-second-patch' });
  const sameRun = await request(fixture.baseUrl, `/api/agent/runs/${firstRun.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: secondProposal, evidenceManifest: secondManifest }),
  });
  assert.equal(sameRun.response.status, 409, JSON.stringify(sameRun.payload));
  assert.equal(sameRun.payload.code, 'AGENT_RUN_STALE');

  const nextRun = await createRun(fixture.baseUrl);
  assert.equal(nextRun.laneLock.draftRevision, first.payload.submission.draftApplication.draftRevision);
  const next = await request(fixture.baseUrl, `/api/agent/runs/${nextRun.id}/artifacts`, {
    method: 'POST',
    body: body({ artifact: secondProposal, evidenceManifest: secondManifest }),
  });
  assert.equal(next.response.status, 201, JSON.stringify(next.payload));
  assert.equal(next.payload.submission.draftApplication.draftId, first.payload.submission.draftApplication.draftId);
  assert.equal(
    next.payload.submission.draftApplication.draftRevision,
    first.payload.submission.draftApplication.draftRevision + 1,
  );
});

test('approved target excludes an ordinary draft and marks a legacy published target non-executable', async (t) => {
  const fixture = await startFixture(t);
  const target = await request(fixture.baseUrl, '/api/state?view=target');
  assert.equal(target.response.status, 200);
  assert.ok(target.payload.draft, 'fixture should contain an ordinary target draft');

  const approved = await request(fixture.baseUrl, '/api/agent/approved-target');
  assert.equal(approved.response.status, 200);
  assert.equal(approved.payload.approvalStatus, 'published-target');
  assert.equal(approved.payload.baselineStatus, 'legacy-unbound');
  assert.equal(approved.payload.formalBaseline, null);
  assert.equal(approved.payload.developmentContract.status, 'legacy-unbound');
  assert.equal(approved.payload.architecture.revisionId, target.payload.published.revisionId);
  assert.deepEqual(
    approved.payload.architecture.graph.nodes.map((node) => node.id),
    target.payload.published.graph.nodes.map((node) => node.id),
  );
  assert.equal(approved.payload.architecture.representation, 'semantic-graph-v1');
  assert.equal(JSON.stringify(approved.payload.architecture).includes('position'), false);

  const blockedRun = await request(fixture.baseUrl, '/api/agent/runs', {
    method: 'POST',
    body: body({
      agentName: 'Codex',
      agentClient: 'codex',
      taskType: 'implementation-reconcile',
      summary: 'Must not run against an unbound legacy target.',
    }),
  });
  assert.equal(blockedRun.response.status, 409);
  assert.equal(blockedRun.payload.code, 'AGENT_TARGET_NOT_EXECUTABLE');
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
  assert.equal(result.payload.protocolVersion, '1.4.0');
  assert.deepEqual(result.payload.skills.map((skill) => skill.id), [
    'architecture-discovery',
    'architecture-change-plan',
    'implementation-reconcile',
  ]);
  assert.equal(result.payload.skills.some((skill) => path.isAbsolute(skill.skillPath)), false);
  assert.equal(JSON.stringify(result.payload).includes(fixture.projectRoot), false);
});
