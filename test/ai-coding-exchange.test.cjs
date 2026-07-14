'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { validateExchangeArtifact } = require('../schema/ai-coding-exchange-contract.cjs');
const { readSkillCatalog } = require('../skill-catalog.cjs');

const ROOT = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

test('bundled AI coding skills have a safe public catalog and existing instructions', () => {
  const catalog = readSkillCatalog(path.join(ROOT, 'skills'));
  assert.equal(catalog.schemaVersion, '1.0.0');
  assert.equal(catalog.protocolVersion, '1.0.0');
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
  assert.equal(manifest.schemaVersion, '1.0.0');
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

test('complete implementation reports require observed passing checks and satisfied criteria', () => {
  const report = readJson('skills/implementation-reconcile/assets/implementation-report.template.json');
  report.status = 'complete';
  report.unresolved = [];
  assert.throws(() => validateExchangeArtifact(report), /passing checks/);

  report.tests[0] = { command: 'npm test', outcome: 'passed', summary: 'All tests passed.' };
  assert.throws(() => validateExchangeArtifact(report), /acceptance criterion/);

  report.acceptanceResults[0] = {
    criterion: 'The approved behavior is implemented.',
    status: 'satisfied',
    evidenceIds: ['evidence-replace-me'],
  };
  assert.doesNotThrow(() => validateExchangeArtifact(report));
});
