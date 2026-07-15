'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ContractError } = require('../schema/state-contract.cjs');
const {
  ANALYSIS_SCHEMA_VERSION,
  MAX_CHANGES_PER_PROPOSAL,
  createEmptyAnalysis,
  migrateAnalysis,
  validateAnalysis,
  validateSourcePath,
} = require('../schema/analysis-contract.cjs');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = '2026-07-14T08:00:00.000Z';

function contractError(fn, code) {
  assert.throws(fn, (error) => error instanceof ContractError && (!code || error.code === code));
}

function validAnalysis() {
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    baseRevision: 3,
    lastUpdated: NOW,
    sources: [{
      id: 'readme',
      sourceKind: 'workspace-file',
      path: 'docs/architecture.md',
      label: 'Architecture notes',
      type: 'markdown',
      selected: true,
      lastScannedAt: NOW,
      contentHash: HASH_A,
      sizeBytes: 640,
    }],
    evidence: [{
      id: 'evidence-readme-1',
      sourceId: 'readme',
      sourceKind: 'workspace-file',
      basis: 'design-document',
      path: 'docs/architecture.md',
      lineStart: 12,
      lineEnd: 16,
      excerpt: 'The gateway forwards requests to the catalog service.',
      contentHash: HASH_B,
      collectedAt: NOW,
    }],
    proposals: [{
      id: 'proposal-add-catalog',
      status: 'pending',
      view: 'current',
      diagramId: 'overview',
      baseRevision: 3,
      baseRevisionId: 'current-r3',
      title: 'Add the catalog service',
      summary: 'The selected design notes describe a service absent from the current diagram.',
      confidence: 'high',
      createdAt: NOW,
      reviewedAt: null,
      evidenceIds: ['evidence-readme-1'],
      changes: [{
        id: 'change-add-catalog',
        kind: 'add',
        targetType: 'node',
        targetId: 'catalog-service',
        summary: 'Add the service as a semantic architecture node.',
        evidenceIds: ['evidence-readme-1'],
        patch: {
          data: {
            name: 'Catalog Service',
            purpose: 'Provides the catalog domain API.',
            technical: 'Node.js HTTP service',
            product: 'Catalog experience',
            authorization: 'Service-to-service access',
          },
        },
      }],
      application: null,
      origin: null,
    }],
    agentRuns: [],
    artifacts: [],
  };
}

test('analysis contract creates and validates an evidence-backed pending proposal', () => {
  const empty = createEmptyAnalysis(NOW);
  assert.deepEqual(empty, {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    baseRevision: 0,
    lastUpdated: NOW,
    sources: [],
    evidence: [],
    proposals: [],
    agentRuns: [],
    artifacts: [],
  });
  assert.equal(validateAnalysis(validAnalysis()).proposals[0].changes[0].targetId, 'catalog-service');
});

test('analysis contract migrates v1 workbench data without inventing agent provenance', () => {
  const legacy = validAnalysis();
  legacy.schemaVersion = '1.0.0';
  delete legacy.agentRuns;
  delete legacy.artifacts;
  delete legacy.sources[0].sourceKind;
  delete legacy.evidence[0].sourceKind;
  delete legacy.evidence[0].basis;
  delete legacy.proposals[0].origin;
  const migrated = migrateAnalysis(legacy);
  assert.equal(migrated.schemaVersion, ANALYSIS_SCHEMA_VERSION);
  assert.deepEqual(migrated.agentRuns, []);
  assert.deepEqual(migrated.artifacts, []);
  assert.equal(migrated.proposals[0].origin, null);
  assert.equal(migrated.sources[0].sourceKind, 'workspace-file');
  assert.equal(migrated.evidence[0].basis, 'design-document');
});

test('analysis contract migrates v0.2 and v0.3 runs without losing proposal provenance', () => {
  const legacy = validAnalysis();
  legacy.schemaVersion = '2.0.0';
  delete legacy.sources[0].sourceKind;
  delete legacy.evidence[0].sourceKind;
  delete legacy.evidence[0].basis;
  legacy.proposals[0].origin = {
    runId: 'run-one',
    artifactId: 'proposal-artifact',
    artifactType: 'architecture-proposal',
    agentName: 'Codex',
    agentClient: 'codex',
  };
  legacy.agentRuns = [{
    id: 'run-one',
    agentName: 'Codex',
    agentClient: 'codex',
    taskType: 'architecture-change-plan',
    status: 'submitted',
    diagramId: 'overview',
    view: 'current',
    baseRevision: 3,
    baseRevisionId: 'current-r3',
    createdAt: NOW,
    updatedAt: NOW,
    submittedAt: NOW,
    summary: null,
    artifactIds: ['proposal-artifact'],
  }];
  legacy.artifacts = [{
    id: 'proposal-artifact',
    runId: 'run-one',
    artifactType: 'architecture-proposal',
    submittedAt: NOW,
    artifact: {
      schemaVersion: '1.0.0',
      artifactType: 'architecture-proposal',
      artifactId: 'proposal-artifact',
      createdAt: NOW,
      requestId: 'request-one',
      baseSnapshotId: 'snapshot-one',
      title: 'Legacy proposal',
      summary: 'A v0.2 proposal remains readable.',
      options: [{ id: 'option-one', title: 'One', summary: 'Keep it.', advantages: [], disadvantages: [] }],
      recommendedOptionId: 'option-one',
      changes: legacy.proposals[0].changes,
      acceptanceCriteria: ['It remains readable.'],
      risks: [],
      decisionsRequired: [],
      evidenceManifest: 'evidence-manifest.json',
    },
  }];
  const migrated = migrateAnalysis(legacy);
  assert.equal(migrated.schemaVersion, ANALYSIS_SCHEMA_VERSION);
  assert.equal(migrated.proposals[0].origin.runId, 'run-one');
  assert.equal(migrated.agentRuns.length, 1);
  assert.equal(migrated.agentRuns[0].approvedTarget, null);
  assert.equal(migrated.agentRuns[0].reconciliation, null);
  assert.equal(migrated.artifacts.length, 1);
  assert.equal(migrated.evidence[0].basis, 'design-document');

  const v03 = structuredClone(legacy);
  v03.schemaVersion = '2.1.0';
  const migratedV03 = migrateAnalysis(v03);
  assert.equal(migratedV03.schemaVersion, ANALYSIS_SCHEMA_VERSION);
  assert.equal(migratedV03.agentRuns[0].approvedTarget, null);
  assert.equal(migratedV03.agentRuns[0].reconciliation, null);
  assert.equal(migratedV03.proposals[0].origin.runId, 'run-one');
});

test('analysis contract stores discussion evidence without pretending it has a file location', () => {
  const discussion = validAnalysis();
  discussion.sources = [{
    id: 'discussion-one',
    sourceKind: 'discussion',
    path: null,
    label: 'Product direction discussion',
    type: 'discussion',
    selected: false,
    lastScannedAt: NOW,
    contentHash: HASH_A,
    sizeBytes: 80,
  }];
  discussion.evidence = [{
    id: 'evidence-user-confirmed',
    sourceId: 'discussion-one',
    sourceKind: 'discussion',
    basis: 'user-confirmed',
    path: null,
    lineStart: null,
    lineEnd: null,
    excerpt: 'The user confirmed this target responsibility.',
    contentHash: HASH_A,
    collectedAt: NOW,
  }];
  discussion.proposals[0].view = 'target';
  discussion.proposals[0].changes[0].patch.data.horizon = '近期';
  discussion.proposals[0].evidenceIds = ['evidence-user-confirmed'];
  discussion.proposals[0].changes[0].evidenceIds = ['evidence-user-confirmed'];
  assert.doesNotThrow(() => validateAnalysis(discussion));

  discussion.evidence[0].basis = 'code-fact';
  contractError(() => validateAnalysis(discussion));
});

test('analysis contract rejects unsafe project-relative source paths', () => {
  assert.equal(validateSourcePath('documents/overview.md'), 'documents/overview.md');
  for (const unsafe of [
    '../secret.md',
    '/etc/passwd',
    'C:/secret.md',
    '//server/share/file.md',
    'docs\\notes.md',
    'docs//notes.md',
    'docs/../secret.md',
  ]) {
    contractError(() => validateSourcePath(unsafe), 'ANALYSIS_PATH_INVALID');
  }
});

test('analysis contract only permits semantic node and edge patches', () => {
  const positionedNode = validAnalysis();
  positionedNode.proposals[0].changes[0].patch.position = { x: 10, y: 20 };
  contractError(() => validateAnalysis(positionedNode), 'ANALYSIS_PATCH_FIELD_FORBIDDEN');

  const documentBoundNode = validAnalysis();
  documentBoundNode.proposals[0].changes[0].patch.data.documentRefs = ['architecture-doc'];
  contractError(() => validateAnalysis(documentBoundNode), 'ANALYSIS_PATCH_FIELD_FORBIDDEN');

  const groupedNode = validAnalysis();
  groupedNode.proposals[0].changes[0].patch.data.group = 'Core services';
  contractError(() => validateAnalysis(groupedNode), 'ANALYSIS_PATCH_FIELD_FORBIDDEN');

  const edgeRouting = validAnalysis();
  edgeRouting.proposals[0].changes = [{
    id: 'change-add-link',
    kind: 'add',
    targetType: 'edge',
    targetId: 'gateway-to-catalog',
    summary: 'Connect the gateway to the catalog service.',
    evidenceIds: ['evidence-readme-1'],
    patch: {
      source: 'api-gateway',
      target: 'catalog-service',
      data: {
        label: 'forwards requests',
        relationType: 'flow',
        controlledBoundaryPosture: 'none',
      },
    },
  }];
  assert.doesNotThrow(() => validateAnalysis(edgeRouting));
  edgeRouting.proposals[0].changes[0].patch.data.controlledBoundaryPosture = 'open';
  contractError(() => validateAnalysis(edgeRouting));

  const reroutedEdge = validAnalysis();
  reroutedEdge.proposals[0].changes = [{
    id: 'change-reroute-link',
    kind: 'update',
    targetType: 'edge',
    targetId: 'gateway-to-catalog',
    summary: 'Attempts to change the relationship endpoints.',
    evidenceIds: ['evidence-readme-1'],
    patch: {
      source: 'replacement-gateway',
      data: { label: 'updated label' },
    },
  }];
  contractError(() => validateAnalysis(reroutedEdge), 'ANALYSIS_PATCH_FIELD_FORBIDDEN');
});

test('analysis contract requires evidence, bounded batches and a valid review lifecycle', () => {
  const missingEvidence = validAnalysis();
  missingEvidence.proposals[0].changes[0].evidenceIds = ['missing-evidence'];
  contractError(() => validateAnalysis(missingEvidence), 'ANALYSIS_EVIDENCE_REFERENCE_UNKNOWN');

  const oversized = validAnalysis();
  oversized.proposals[0].changes = Array.from({ length: MAX_CHANGES_PER_PROPOSAL + 1 }, (_, index) => ({
    ...validAnalysis().proposals[0].changes[0],
    id: `change-${index}`,
    targetId: `catalog-service-${index}`,
  }));
  contractError(() => validateAnalysis(oversized));

  const acceptedWithoutDraft = validAnalysis();
  acceptedWithoutDraft.proposals[0].status = 'accepted';
  acceptedWithoutDraft.proposals[0].reviewedAt = NOW;
  contractError(() => validateAnalysis(acceptedWithoutDraft));
});
