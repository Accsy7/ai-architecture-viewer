'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { validateExchangeArtifact } = require('../schema/ai-coding-exchange-contract.cjs');
const { readSkillCatalog } = require('../skill-catalog.cjs');

const ROOT = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function jsonSchemaValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(readJson('protocol/ai-coding-exchange.schema.json'));
}

test('bundled AI coding skills have a safe public catalog and existing instructions', () => {
  const catalog = readSkillCatalog(path.join(ROOT, 'skills'));
  assert.equal(catalog.schemaVersion, '1.0.0');
  assert.equal(catalog.protocolVersion, '1.4.0');
  assert.deepEqual(catalog.skills.map((skill) => skill.id), [
    'architecture-discovery',
    'architecture-change-plan',
    'implementation-reconcile',
  ]);
  catalog.skills.forEach((skill) => {
    assert.equal(path.isAbsolute(skill.skillPath), false);
    assert.equal(fs.existsSync(path.join(ROOT, 'skills', skill.skillPath)), true);
    assert.ok(skill.outputs.length > 0);
  });
});

test('canonical exchange manifest and JSON Schema are parseable and cover all artifact types', () => {
  const manifest = readJson('protocol/manifest.json');
  const schema = readJson('protocol/ai-coding-exchange.schema.json');
  assert.equal(manifest.schemaVersion, '1.4.0');
  assert.equal(manifest.protocolVersion, '1.4.0');
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(manifest.artifacts.map((artifact) => artifact.type).sort(), [
    'architecture-proposal',
    'architecture-snapshot',
    'evidence-manifest',
    'implementation-report',
    'task-request',
  ]);
  assert.equal(schema.oneOf.length, 5);
});

test('bundled artifact templates satisfy the canonical exchange contract', () => {
  const templates = [
    'skills/architecture-discovery/assets/architecture-snapshot.template.json',
    'skills/architecture-discovery/assets/evidence-manifest.template.json',
    'skills/architecture-change-plan/assets/task-request.template.json',
    'skills/architecture-change-plan/assets/architecture-proposal.template.json',
    'skills/architecture-change-plan/assets/evidence-manifest.template.json',
    'skills/implementation-reconcile/assets/implementation-report.template.json',
    'skills/implementation-reconcile/assets/architecture-snapshot.template.json',
    'skills/implementation-reconcile/assets/evidence-manifest.template.json',
  ];
  templates.forEach((template) => {
    const artifact = readJson(template);
    assert.deepEqual(validateExchangeArtifact(artifact), artifact, template);
  });
});

test('exchange contract rejects absolute evidence paths and unsupported artifact types', () => {
  const evidence = readJson('skills/architecture-discovery/assets/evidence-manifest.template.json');
  evidence.entries[0].path = 'C:\\private\\source.js';
  assert.throws(() => validateExchangeArtifact(evidence), /repository-relative path/);
  assert.throws(() => validateExchangeArtifact({ artifactType: 'automatic-publish' }), /not supported/);
});

test('exchange protocol distinguishes discussion decisions from file facts and remains v1 compatible', () => {
  const discussion = readJson('skills/architecture-change-plan/assets/evidence-manifest.template.json');
  assert.equal(validateExchangeArtifact(discussion).entries[0].basis, 'user-confirmed');

  const falseCodeFact = structuredClone(discussion);
  falseCodeFact.entries[0].basis = 'code-fact';
  assert.throws(() => validateExchangeArtifact(falseCodeFact), /user-confirmed or agent-inference/);

  const legacy = {
    schemaVersion: '1.0.0',
    artifactType: 'evidence-manifest',
    artifactId: 'legacy-evidence',
    createdAt: '2026-07-14T00:00:00.000Z',
    projectRevision: { kind: 'workspace', value: 'legacy' },
    entries: [{
      id: 'legacy-readme',
      path: 'README.md',
      lineStart: 1,
      lineEnd: 1,
      summary: 'Legacy evidence stays valid.',
      contentHash: 'a'.repeat(64),
      basis: 'fact',
    }],
  };
  assert.deepEqual(validateExchangeArtifact(legacy), legacy);
});

test('protocol 1.4 and real 1.3 artifacts share formal-contract semantics while older reports stay readable', () => {
  const report = readJson('skills/implementation-reconcile/assets/implementation-report.template.json');
  assert.equal(report.schemaVersion, '1.4.0');
  assert.equal(report.approvedTarget.status, 'executable-formal-baseline');
  assert.match(report.approvedTarget.contractHash, /^[a-f0-9]{64}$/);
  assert.equal(report.resultingSnapshotArtifactId, 'snapshot-after-implementation');
  assert.equal('approvedProposalId' in report, false);
  assert.equal('resultingSnapshot' in report, false);
  assert.doesNotThrow(() => validateExchangeArtifact(report));

  const v13Report = structuredClone(report);
  v13Report.schemaVersion = '1.3.0';
  assert.doesNotThrow(() => validateExchangeArtifact(v13Report));
  const v13Proposal = readJson('skills/architecture-change-plan/assets/architecture-proposal.template.json');
  v13Proposal.schemaVersion = '1.3.0';
  assert.doesNotThrow(() => validateExchangeArtifact(v13Proposal));

  const legacy = structuredClone(report);
  legacy.schemaVersion = '1.1.0';
  delete legacy.approvedTarget;
  delete legacy.resultingSnapshotArtifactId;
  legacy.approvedProposalId = 'proposal-legacy';
  legacy.resultingSnapshot = 'architecture-snapshot.json';
  legacy.acceptanceResults[0] = {
    criterion: 'The legacy approved behavior is implemented.',
    status: 'unverified',
    evidenceIds: [],
  };
  assert.doesNotThrow(() => validateExchangeArtifact(legacy));
});

test('JSON Schema and runtime agree on proposal criteria versions and the 1.4 contract patch boundary', () => {
  const validateSchema = jsonSchemaValidator();
  const template = readJson('skills/architecture-change-plan/assets/architecture-proposal.template.json');
  const validForBoth = (artifact) => {
    assert.equal(validateSchema(artifact), true, JSON.stringify(validateSchema.errors));
    assert.doesNotThrow(() => validateExchangeArtifact(artifact));
  };
  const invalidForBoth = (artifact) => {
    assert.equal(validateSchema(artifact), false, 'JSON Schema unexpectedly accepted artifact');
    assert.throws(() => validateExchangeArtifact(artifact));
  };

  const v12 = structuredClone(template);
  v12.schemaVersion = '1.2.0';
  v12.acceptanceCriteria = ['The observable target behavior is preserved.'];
  validForBoth(v12);
  const v12Object = structuredClone(v12);
  v12Object.acceptanceCriteria = structuredClone(template.acceptanceCriteria);
  invalidForBoth(v12Object);

  const v13 = structuredClone(template);
  v13.schemaVersion = '1.3.0';
  validForBoth(v13);
  const v13String = structuredClone(v13);
  v13String.acceptanceCriteria = ['A string is not valid in protocol 1.3.'];
  invalidForBoth(v13String);

  const v14Patch = structuredClone(template);
  delete v14Patch.acceptanceCriteria;
  v14Patch.changes = [];
  v14Patch.contractPatch = {
    upsert: [{
      id: 'criterion-replace-me',
      statement: 'The revised target condition is observable.',
      targetRefs: [{ targetType: 'node', targetId: 'module-replace-me' }],
      evidenceIds: ['evidence-replace-me'],
    }],
    delete: [],
  };
  validForBoth(v14Patch);
  const v13Patch = structuredClone(v14Patch);
  v13Patch.schemaVersion = '1.3.0';
  invalidForBoth(v13Patch);

  const forgedHumanApproval = structuredClone(template);
  forgedHumanApproval.changes[0].patch.data = { humanConfirmed: true };
  invalidForBoth(forgedHumanApproval);

  const manualEdgeRoute = structuredClone(template);
  manualEdgeRoute.changes[0] = {
    id: 'change-route-layout', kind: 'update', targetType: 'edge', targetId: 'edge-replace-me',
    summary: 'Attempt to change a local route.', evidenceIds: ['evidence-replace-me'],
    patch: { data: { routingMode: 'manual' } },
  };
  invalidForBoth(manualEdgeRoute);

  const endpointUpdate = structuredClone(template);
  endpointUpdate.changes[0] = {
    id: 'change-edge-endpoint', kind: 'update', targetType: 'edge', targetId: 'edge-replace-me',
    summary: 'Reconnect a stable relationship.', evidenceIds: ['evidence-replace-me'],
    patch: { target: 'replacement-module' },
  };
  validForBoth(endpointUpdate);

  const clearOptionalReferences = structuredClone(template);
  clearOptionalReferences.changes[0] = {
    id: 'change-clear-drilldown', kind: 'update', targetType: 'node', targetId: 'module-replace-me',
    summary: 'Remove an optional drill-down target.', evidenceIds: ['evidence-replace-me'],
    patch: { data: { relatedDiagramId: null, relatedNodeId: null } },
  };
  validForBoth(clearOptionalReferences);

  const mislabeledV13Clear = structuredClone(clearOptionalReferences);
  mislabeledV13Clear.schemaVersion = '1.3.0';
  invalidForBoth(mislabeledV13Clear);

  const clearRequiredPurpose = structuredClone(template);
  clearRequiredPurpose.changes[0].patch.data = { purpose: null };
  invalidForBoth(clearRequiredPurpose);

  const clearOnlyOneReference = structuredClone(clearOptionalReferences);
  delete clearOnlyOneReference.changes[0].patch.data.relatedNodeId;
  invalidForBoth(clearOnlyOneReference);
});

test('only protocol 1.4 accepts explicit stable-ID contract patches', () => {
  const proposal = readJson('skills/architecture-change-plan/assets/architecture-proposal.template.json');
  delete proposal.acceptanceCriteria;
  proposal.changes = [];
  proposal.contractPatch = {
    upsert: [{
      id: 'criterion-replace-me',
      statement: 'The revised target condition is observable.',
      targetRefs: [{ targetType: 'node', targetId: 'module-id' }],
      evidenceIds: ['evidence-replace-me'],
    }],
    delete: [],
  };
  assert.doesNotThrow(() => validateExchangeArtifact(proposal));
  const mislabeled = structuredClone(proposal);
  mislabeled.schemaVersion = '1.3.0';
  assert.throws(() => validateExchangeArtifact(mislabeled), /contractPatch requires protocol 1\.4\.0/);
});

test('complete implementation reports require observed passing checks and satisfied criteria', () => {
  const report = readJson('skills/implementation-reconcile/assets/implementation-report.template.json');
  report.status = 'complete';
  report.unresolved = [];
  assert.throws(() => validateExchangeArtifact(report), /passing checks/);

  report.tests[0] = { command: 'npm test', outcome: 'passed', summary: 'All tests passed.' };
  assert.throws(() => validateExchangeArtifact(report), /acceptance criterion/);

  report.acceptanceResults[0] = {
    criterionId: 'criterion-replace-me',
    status: 'satisfied',
    evidenceIds: ['evidence-replace-me'],
  };
  assert.doesNotThrow(() => validateExchangeArtifact(report));
});
