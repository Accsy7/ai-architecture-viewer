'use strict';

const path = require('path');

const AI_CODING_PROTOCOL_VERSION = '1.1.0';
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['1.0.0', AI_CODING_PROTOCOL_VERSION]);
const ARTIFACT_TYPES = new Set([
  'task-request',
  'evidence-manifest',
  'architecture-snapshot',
  'architecture-proposal',
  'implementation-report',
]);
const RELATION_TYPES = new Set(['flow', 'support', 'reference', 'governance', 'handoff']);
const REVISION_KINDS = new Set(['git-commit', 'workspace', 'release']);
const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const EVIDENCE_SOURCE_KINDS = new Set(['workspace-file', 'discussion']);
const EVIDENCE_BASES = new Set([
  'user-confirmed',
  'design-document',
  'code-fact',
  'agent-inference',
]);

class AiCodingExchangeError extends Error {
  constructor(message, code = 'AI_CODING_ARTIFACT_INVALID', details) {
    super(message);
    this.name = 'AiCodingExchangeError';
    this.code = code;
    this.status = 422;
    this.details = details;
  }
}

function fail(message, details) {
  throw new AiCodingExchangeError(message, 'AI_CODING_ARTIFACT_INVALID', details);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(value, valuePath) {
  if (!isObject(value)) fail(`${valuePath} must be an object`);
  return value;
}

function keys(value, allowed, valuePath) {
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) fail(`${valuePath}.${key} is not supported`);
  });
}

function text(value, valuePath, { max = 4000 } = {}) {
  if (typeof value !== 'string' || !value.trim()) fail(`${valuePath} must be non-empty text`);
  if (value.length > max) fail(`${valuePath} exceeds ${max} characters`);
  return value;
}

function stableId(value, valuePath) {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) fail(`${valuePath} must be a stable ID`);
  return value;
}

function timestamp(value, valuePath) {
  text(value, valuePath, { max: 80 });
  if (Number.isNaN(Date.parse(value))) fail(`${valuePath} must be an ISO timestamp`);
  return value;
}

function list(value, valuePath, { min = 0, max = 500 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(`${valuePath} must contain ${min} to ${max} items`);
  }
  return value;
}

function textList(value, valuePath, options = {}) {
  list(value, valuePath, options).forEach((item, index) => text(item, `${valuePath}[${index}]`, { max: 1000 }));
  return value;
}

function relativePath(value, valuePath) {
  text(value, valuePath, { max: 500 });
  if (
    value !== value.trim()
    || value.includes('\\')
    || value.includes('\0')
    || path.posix.isAbsolute(value)
    || /^[a-zA-Z]:/.test(value)
    || value.startsWith('//')
    || path.posix.normalize(value) !== value
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) fail(`${valuePath} must be a normalized repository-relative path`);
  return value;
}

function revision(value, valuePath) {
  object(value, valuePath);
  keys(value, new Set(['kind', 'value']), valuePath);
  if (!REVISION_KINDS.has(value.kind)) fail(`${valuePath}.kind is not supported`);
  text(value.value, `${valuePath}.value`, { max: 160 });
}

function evidenceIds(value, valuePath, { min = 1 } = {}) {
  const seen = new Set();
  list(value, valuePath, { min, max: 64 }).forEach((id, index) => {
    stableId(id, `${valuePath}[${index}]`);
    if (seen.has(id)) fail(`${valuePath} contains duplicate evidence ID ${id}`);
    seen.add(id);
  });
}

function common(value, type) {
  object(value, 'artifact');
  if (!SUPPORTED_PROTOCOL_VERSIONS.has(value.schemaVersion)) {
    fail(`artifact.schemaVersion must be one of ${[...SUPPORTED_PROTOCOL_VERSIONS].join(', ')}`);
  }
  if (value.artifactType !== type) fail(`artifact.artifactType must be ${type}`);
  stableId(value.artifactId, 'artifact.artifactId');
  timestamp(value.createdAt, 'artifact.createdAt');
}

function validateTaskRequest(value) {
  common(value, 'task-request');
  keys(value, new Set([
    'schemaVersion', 'artifactType', 'artifactId', 'createdAt', 'goal', 'constraints',
    'nonGoals', 'acceptanceCriteria', 'decisionsRequired',
  ]), 'artifact');
  text(value.goal, 'artifact.goal');
  textList(value.constraints, 'artifact.constraints');
  textList(value.nonGoals, 'artifact.nonGoals');
  textList(value.acceptanceCriteria, 'artifact.acceptanceCriteria', { min: 1, max: 100 });
  textList(value.decisionsRequired, 'artifact.decisionsRequired');
}

function validateEvidenceManifest(value) {
  common(value, 'evidence-manifest');
  keys(value, new Set([
    'schemaVersion', 'artifactType', 'artifactId', 'createdAt', 'projectRevision', 'entries',
  ]), 'artifact');
  revision(value.projectRevision, 'artifact.projectRevision');
  const ids = new Set();
  list(value.entries, 'artifact.entries', { min: 1, max: 5000 }).forEach((entry, index) => {
    const entryPath = `artifact.entries[${index}]`;
    object(entry, entryPath);
    stableId(entry.id, `${entryPath}.id`);
    if (ids.has(entry.id)) fail(`artifact.entries contains duplicate ID ${entry.id}`);
    ids.add(entry.id);
    if (value.schemaVersion === '1.0.0') {
      keys(entry, new Set(['id', 'path', 'lineStart', 'lineEnd', 'summary', 'excerpt', 'contentHash', 'basis']), entryPath);
      validateFileEvidenceFields(entry, entryPath);
      if (!['fact', 'inference'].includes(entry.basis)) fail(`${entryPath}.basis must be fact or inference`);
      return;
    }

    keys(entry, new Set([
      'id', 'sourceKind', 'basis', 'path', 'lineStart', 'lineEnd', 'sourceLabel',
      'recordedAt', 'summary', 'excerpt', 'contentHash',
    ]), entryPath);
    if (!EVIDENCE_SOURCE_KINDS.has(entry.sourceKind)) fail(`${entryPath}.sourceKind is not supported`);
    if (!EVIDENCE_BASES.has(entry.basis)) fail(`${entryPath}.basis is not supported`);
    text(entry.summary, `${entryPath}.summary`, { max: 1000 });
    validateOptionalExcerpt(entry.excerpt, `${entryPath}.excerpt`);

    if (entry.sourceKind === 'workspace-file') {
      validateFileEvidenceFields(entry, entryPath);
      return;
    }

    if (!['user-confirmed', 'agent-inference'].includes(entry.basis)) {
      fail(`${entryPath}.basis must be user-confirmed or agent-inference for discussion evidence`);
    }
    if (entry.path !== undefined || entry.lineStart !== undefined || entry.lineEnd !== undefined || entry.contentHash !== undefined) {
      fail(`${entryPath} discussion evidence must not claim a workspace file location or submitted hash`);
    }
    text(entry.sourceLabel, `${entryPath}.sourceLabel`, { max: 200 });
    timestamp(entry.recordedAt, `${entryPath}.recordedAt`);
    if (entry.excerpt === undefined || !entry.excerpt.trim()) fail(`${entryPath}.excerpt must capture the reviewed discussion text`);
  });
}

function validateOptionalExcerpt(value, valuePath) {
  if (value !== undefined && (typeof value !== 'string' || value.length > 4000)) {
    fail(`${valuePath} must be at most 4000 characters`);
  }
}

function validateFileEvidenceFields(entry, entryPath) {
  relativePath(entry.path, `${entryPath}.path`);
  if (!Number.isSafeInteger(entry.lineStart) || entry.lineStart < 1) fail(`${entryPath}.lineStart must be at least 1`);
  if (!Number.isSafeInteger(entry.lineEnd) || entry.lineEnd < entry.lineStart) fail(`${entryPath}.lineEnd must not precede lineStart`);
  text(entry.summary, `${entryPath}.summary`, { max: 1000 });
  validateOptionalExcerpt(entry.excerpt, `${entryPath}.excerpt`);
  if (typeof entry.contentHash !== 'string' || !SHA256.test(entry.contentHash)) fail(`${entryPath}.contentHash must be SHA-256`);
}

function validateArchitectureSnapshot(value) {
  common(value, 'architecture-snapshot');
  keys(value, new Set([
    'schemaVersion', 'artifactType', 'artifactId', 'createdAt', 'project', 'scope',
    'nodes', 'edges', 'assumptions', 'unknowns', 'evidenceManifest',
  ]), 'artifact');
  object(value.project, 'artifact.project');
  keys(value.project, new Set(['name', 'revision']), 'artifact.project');
  text(value.project.name, 'artifact.project.name', { max: 200 });
  revision(value.project.revision, 'artifact.project.revision');
  object(value.scope, 'artifact.scope');
  keys(value.scope, new Set(['included', 'excluded']), 'artifact.scope');
  list(value.scope.included, 'artifact.scope.included').forEach((item, index) => relativePath(item, `artifact.scope.included[${index}]`));
  list(value.scope.excluded, 'artifact.scope.excluded').forEach((item, index) => relativePath(item, `artifact.scope.excluded[${index}]`));

  const nodeIds = new Set();
  list(value.nodes, 'artifact.nodes', { min: 1, max: 500 }).forEach((node, index) => {
    const nodePath = `artifact.nodes[${index}]`;
    object(node, nodePath);
    keys(node, new Set(['id', 'name', 'purpose', 'technical', 'product', 'authorization', 'evidenceIds']), nodePath);
    stableId(node.id, `${nodePath}.id`);
    if (nodeIds.has(node.id)) fail(`artifact.nodes contains duplicate ID ${node.id}`);
    nodeIds.add(node.id);
    text(node.name, `${nodePath}.name`, { max: 120 });
    text(node.purpose, `${nodePath}.purpose`, { max: 2000 });
    text(node.technical, `${nodePath}.technical`, { max: 500 });
    text(node.product, `${nodePath}.product`, { max: 500 });
    text(node.authorization, `${nodePath}.authorization`, { max: 500 });
    evidenceIds(node.evidenceIds, `${nodePath}.evidenceIds`);
  });

  const edgeIds = new Set();
  list(value.edges, 'artifact.edges', { max: 1000 }).forEach((edge, index) => {
    const edgePath = `artifact.edges[${index}]`;
    object(edge, edgePath);
    keys(edge, new Set(['id', 'source', 'target', 'label', 'relationType', 'evidenceIds']), edgePath);
    stableId(edge.id, `${edgePath}.id`);
    if (edgeIds.has(edge.id)) fail(`artifact.edges contains duplicate ID ${edge.id}`);
    edgeIds.add(edge.id);
    stableId(edge.source, `${edgePath}.source`);
    stableId(edge.target, `${edgePath}.target`);
    if (edge.source === edge.target) fail(`${edgePath} must not connect a node to itself`);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) fail(`${edgePath} references an unknown node`);
    text(edge.label, `${edgePath}.label`, { max: 240 });
    if (!RELATION_TYPES.has(edge.relationType)) fail(`${edgePath}.relationType is not supported`);
    evidenceIds(edge.evidenceIds, `${edgePath}.evidenceIds`);
  });
  textList(value.assumptions, 'artifact.assumptions');
  textList(value.unknowns, 'artifact.unknowns');
  relativePath(value.evidenceManifest, 'artifact.evidenceManifest');
}

function validateArchitectureProposal(value) {
  common(value, 'architecture-proposal');
  keys(value, new Set([
    'schemaVersion', 'artifactType', 'artifactId', 'createdAt', 'requestId', 'baseSnapshotId',
    'title', 'summary', 'options', 'recommendedOptionId', 'changes', 'acceptanceCriteria',
    'risks', 'decisionsRequired', 'evidenceManifest',
  ]), 'artifact');
  stableId(value.requestId, 'artifact.requestId');
  stableId(value.baseSnapshotId, 'artifact.baseSnapshotId');
  text(value.title, 'artifact.title', { max: 160 });
  text(value.summary, 'artifact.summary', { max: 2000 });
  const optionIds = new Set();
  list(value.options, 'artifact.options', { min: 1, max: 3 }).forEach((option, index) => {
    const optionPath = `artifact.options[${index}]`;
    object(option, optionPath);
    keys(option, new Set(['id', 'title', 'summary', 'advantages', 'disadvantages']), optionPath);
    stableId(option.id, `${optionPath}.id`);
    if (optionIds.has(option.id)) fail(`artifact.options contains duplicate ID ${option.id}`);
    optionIds.add(option.id);
    text(option.title, `${optionPath}.title`, { max: 160 });
    text(option.summary, `${optionPath}.summary`, { max: 2000 });
    textList(option.advantages, `${optionPath}.advantages`);
    textList(option.disadvantages, `${optionPath}.disadvantages`);
  });
  stableId(value.recommendedOptionId, 'artifact.recommendedOptionId');
  if (!optionIds.has(value.recommendedOptionId)) fail('artifact.recommendedOptionId must reference an option');

  const changeIds = new Set();
  list(value.changes, 'artifact.changes', { min: 1, max: 50 }).forEach((change, index) => {
    const changePath = `artifact.changes[${index}]`;
    object(change, changePath);
    keys(change, new Set(['id', 'kind', 'targetType', 'targetId', 'summary', 'evidenceIds', 'patch']), changePath);
    stableId(change.id, `${changePath}.id`);
    if (changeIds.has(change.id)) fail(`artifact.changes contains duplicate ID ${change.id}`);
    changeIds.add(change.id);
    if (!['add', 'update', 'remove'].includes(change.kind)) fail(`${changePath}.kind is not supported`);
    if (!['node', 'edge'].includes(change.targetType)) fail(`${changePath}.targetType is not supported`);
    stableId(change.targetId, `${changePath}.targetId`);
    text(change.summary, `${changePath}.summary`, { max: 1000 });
    evidenceIds(change.evidenceIds, `${changePath}.evidenceIds`);
    if (change.kind === 'remove' ? change.patch !== null : !isObject(change.patch)) {
      fail(`${changePath}.patch does not match the change kind`);
    }
  });
  textList(value.acceptanceCriteria, 'artifact.acceptanceCriteria', { min: 1, max: 100 });
  textList(value.risks, 'artifact.risks');
  textList(value.decisionsRequired, 'artifact.decisionsRequired');
  relativePath(value.evidenceManifest, 'artifact.evidenceManifest');
}

function validateImplementationReport(value) {
  common(value, 'implementation-report');
  keys(value, new Set([
    'schemaVersion', 'artifactType', 'artifactId', 'createdAt', 'requestId', 'approvedProposalId',
    'status', 'resultingRevision', 'changedFiles', 'tests', 'acceptanceResults', 'drift',
    'unresolved', 'evidenceManifest', 'resultingSnapshot',
  ]), 'artifact');
  stableId(value.requestId, 'artifact.requestId');
  stableId(value.approvedProposalId, 'artifact.approvedProposalId');
  if (!['complete', 'partial', 'blocked'].includes(value.status)) fail('artifact.status is not supported');
  revision(value.resultingRevision, 'artifact.resultingRevision');
  list(value.changedFiles, 'artifact.changedFiles').forEach((item, index) => relativePath(item, `artifact.changedFiles[${index}]`));

  list(value.tests, 'artifact.tests', { max: 100 }).forEach((test, index) => {
    const testPath = `artifact.tests[${index}]`;
    object(test, testPath);
    keys(test, new Set(['command', 'outcome', 'summary']), testPath);
    text(test.command, `${testPath}.command`, { max: 500 });
    if (!['passed', 'failed', 'not-run'].includes(test.outcome)) fail(`${testPath}.outcome is not supported`);
    text(test.summary, `${testPath}.summary`, { max: 1000 });
  });

  list(value.acceptanceResults, 'artifact.acceptanceResults', { min: 1, max: 100 }).forEach((result, index) => {
    const resultPath = `artifact.acceptanceResults[${index}]`;
    object(result, resultPath);
    keys(result, new Set(['criterion', 'status', 'evidenceIds']), resultPath);
    text(result.criterion, `${resultPath}.criterion`, { max: 1000 });
    if (!['satisfied', 'unsatisfied', 'unverified'].includes(result.status)) fail(`${resultPath}.status is not supported`);
    evidenceIds(result.evidenceIds, `${resultPath}.evidenceIds`, { min: result.status === 'satisfied' ? 1 : 0 });
  });

  list(value.drift, 'artifact.drift', { max: 100 }).forEach((item, index) => {
    const driftPath = `artifact.drift[${index}]`;
    object(item, driftPath);
    keys(item, new Set(['kind', 'targetId', 'summary', 'evidenceIds']), driftPath);
    if (!['missing', 'extra', 'changed', 'unverified'].includes(item.kind)) fail(`${driftPath}.kind is not supported`);
    stableId(item.targetId, `${driftPath}.targetId`);
    text(item.summary, `${driftPath}.summary`, { max: 1000 });
    evidenceIds(item.evidenceIds, `${driftPath}.evidenceIds`, { min: item.kind === 'unverified' ? 0 : 1 });
  });
  textList(value.unresolved, 'artifact.unresolved');
  relativePath(value.evidenceManifest, 'artifact.evidenceManifest');
  relativePath(value.resultingSnapshot, 'artifact.resultingSnapshot');

  if (value.status === 'complete') {
    if (!value.tests.length || value.tests.some((test) => test.outcome !== 'passed')) {
      fail('a complete implementation report requires observed passing checks');
    }
    if (value.acceptanceResults.some((result) => result.status !== 'satisfied')) {
      fail('a complete implementation report requires every acceptance criterion to be satisfied');
    }
    if (value.unresolved.length) fail('a complete implementation report cannot contain unresolved items');
  }
}

function validateExchangeArtifact(value) {
  object(value, 'artifact');
  if (!ARTIFACT_TYPES.has(value.artifactType)) fail('artifact.artifactType is not supported');
  if (value.artifactType === 'task-request') validateTaskRequest(value);
  if (value.artifactType === 'evidence-manifest') validateEvidenceManifest(value);
  if (value.artifactType === 'architecture-snapshot') validateArchitectureSnapshot(value);
  if (value.artifactType === 'architecture-proposal') validateArchitectureProposal(value);
  if (value.artifactType === 'implementation-report') validateImplementationReport(value);
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  AI_CODING_PROTOCOL_VERSION,
  ARTIFACT_TYPES,
  EVIDENCE_BASES,
  EVIDENCE_SOURCE_KINDS,
  SUPPORTED_PROTOCOL_VERSIONS,
  AiCodingExchangeError,
  validateExchangeArtifact,
};
