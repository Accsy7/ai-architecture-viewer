'use strict';

const path = require('path');
const {
  BUILD_STRATEGIES,
  ContractError,
  RELATION_TYPES,
  clone,
} = require('./state-contract.cjs');
const { validateExchangeArtifact } = require('./ai-coding-exchange-contract.cjs');

const ANALYSIS_SCHEMA_VERSION = '2.1.0';
const MAX_SOURCE_COUNT = 500;
const MAX_EVIDENCE_COUNT = 5000;
const MAX_PROPOSAL_COUNT = 500;
const MAX_AGENT_RUN_COUNT = 500;
const MAX_ARTIFACT_COUNT = 1000;
const MAX_ARTIFACTS_PER_RUN = 50;
const MAX_CHANGES_PER_PROPOSAL = 100;
const MAX_EVIDENCE_REFS_PER_PROPOSAL = 64;
const MAX_EVIDENCE_REFS_PER_CHANGE = 16;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_EVIDENCE_LINE_SPAN = 2000;
const MAX_EVIDENCE_EXCERPT_CHARS = 12000;
const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SHA256_HASH = /^[a-f0-9]{64}$/;

const SOURCE_TYPES = new Set([
  'markdown',
  'json',
  'yaml',
  'toml',
  'text',
  'manifest',
  'configuration',
  'source-code',
  'discussion',
]);
const SOURCE_KINDS = new Set(['workspace-file', 'discussion']);
const EVIDENCE_BASES = new Set([
  'user-confirmed',
  'design-document',
  'code-fact',
  'agent-inference',
]);
const PROPOSAL_STATUSES = new Set(['pending', 'accepted', 'rejected']);
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const AGENT_TASK_TYPES = new Set([
  'architecture-discovery',
  'architecture-change-plan',
  'implementation-reconcile',
]);
const AGENT_RUN_STATUSES = new Set(['active', 'submitted', 'reviewed', 'failed']);
const CHANGE_KINDS = new Set(['add', 'update', 'remove']);
const CHANGE_TARGET_TYPES = new Set(['node', 'edge']);
const TARGET_HORIZONS = new Set(['近期', '后续', '远期']);

const NODE_SEMANTIC_FIELDS = new Set([
  'name',
  'purpose',
  'technical',
  'product',
  'authorization',
  'horizon',
  'focus',
  'buildStrategy',
  'aiCollaboration',
  'relatedDiagramId',
  'relatedNodeId',
]);
const REQUIRED_NODE_SEMANTIC_FIELDS = [
  'name',
  'purpose',
  'technical',
  'product',
  'authorization',
];
const EDGE_SEMANTIC_FIELDS = new Set(['label', 'relationType']);

function fail(message, code = 'ANALYSIS_VALIDATION_ERROR', status = 422, details) {
  throw new ContractError(message, code, status, details);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, valuePath) {
  if (!isObject(value)) fail(`${valuePath} 必须是对象`);
}

function assertKeys(value, allowed, valuePath, { patch = false } = {}) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(
        `${valuePath}.${key} ${patch ? '不是允许的 AI 语义补丁字段' : '不是 analysis schema 字段'}`,
        patch ? 'ANALYSIS_PATCH_FIELD_FORBIDDEN' : 'ANALYSIS_VALIDATION_ERROR',
      );
    }
  }
}

function assertText(value, valuePath, { max = 2000 } = {}) {
  if (typeof value !== 'string' || !value.trim()) fail(`${valuePath} 必须是非空文本`);
  if (value.length > max) fail(`${valuePath} 超过 ${max} 字符`);
}

function assertStableId(value, valuePath) {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) {
    fail(`${valuePath} 必须是稳定 ID`, 'ANALYSIS_VALIDATION_ERROR');
  }
}

function assertTimestamp(value, valuePath, { nullable = false } = {}) {
  if (nullable && value === null) return;
  assertText(value, valuePath, { max: 80 });
  if (Number.isNaN(Date.parse(value))) fail(`${valuePath} 必须是有效时间戳`);
}

function assertBaseRevision(value, valuePath) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${valuePath} 必须是非负安全整数`);
  }
}

function assertPositiveRevision(value, valuePath) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${valuePath} 必须是正安全整数`);
  }
}

function assertBaseRevisionId(value, valuePath, baseRevision) {
  if (baseRevision === 0 && value === null) return;
  assertStableId(value, valuePath);
}

function assertHash(value, valuePath, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !SHA256_HASH.test(value)) {
    fail(`${valuePath} 必须是小写 SHA-256 哈希`);
  }
}

function assertArray(value, valuePath, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(`${valuePath} 必须包含 ${min} 到 ${max} 项`);
  }
}

function validateSourcePath(value, valuePath = 'source.path') {
  assertText(value, valuePath, { max: 500 });
  if (value !== value.trim() || value.includes('\\') || value.includes('\0')) {
    fail(`${valuePath} 必须是安全的正斜杠相对路径`, 'ANALYSIS_PATH_INVALID');
  }
  if (path.posix.isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.startsWith('//')) {
    fail(`${valuePath} 不得使用绝对路径、盘符或 UNC 路径`, 'ANALYSIS_PATH_INVALID');
  }
  const segments = value.split('/');
  if (
    segments.some((segment) => (
      !segment
      || segment === '.'
      || segment === '..'
      || segment.endsWith('.')
      || segment.endsWith(' ')
      || /[<>:"|?*\x00-\x1f]/.test(segment)
    ))
    || path.posix.normalize(value) !== value
  ) {
    fail(`${valuePath} 必须是规范化且位于项目内的相对路径`, 'ANALYSIS_PATH_INVALID');
  }
  return value;
}

function validateSource(source, sourcePath = 'source') {
  assertObject(source, sourcePath);
  assertKeys(source, new Set([
    'id',
    'sourceKind',
    'path',
    'label',
    'type',
    'selected',
    'lastScannedAt',
    'contentHash',
    'sizeBytes',
  ]), sourcePath);
  assertStableId(source.id, `${sourcePath}.id`);
  if (!SOURCE_KINDS.has(source.sourceKind)) fail(`${sourcePath}.sourceKind 不是支持的资料来源`);
  if (source.sourceKind === 'workspace-file') {
    validateSourcePath(source.path, `${sourcePath}.path`);
    if (source.type === 'discussion') fail(`${sourcePath}.type 与文件资料不匹配`);
  } else {
    if (source.path !== null) fail(`${sourcePath}.path 必须为 null，讨论依据不能冒充文件路径`);
    if (source.type !== 'discussion') fail(`${sourcePath}.type 必须是 discussion`);
  }
  assertText(source.label, `${sourcePath}.label`, { max: 160 });
  if (!SOURCE_TYPES.has(source.type)) fail(`${sourcePath}.type 不是支持的资料类型`);
  if (typeof source.selected !== 'boolean') fail(`${sourcePath}.selected 必须是布尔值`);
  assertTimestamp(source.lastScannedAt, `${sourcePath}.lastScannedAt`, { nullable: true });
  assertHash(source.contentHash, `${sourcePath}.contentHash`, { nullable: true });
  if (source.sizeBytes !== null && (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 0 || source.sizeBytes > MAX_SOURCE_BYTES)) {
    fail(`${sourcePath}.sizeBytes 必须是 0 到 ${MAX_SOURCE_BYTES} 之间的安全整数或 null`);
  }
  const scanned = source.lastScannedAt !== null;
  if (scanned !== (source.contentHash !== null) || scanned !== (source.sizeBytes !== null)) {
    fail(`${sourcePath} 的扫描时间、内容哈希和文件大小必须同时存在或同时为 null`);
  }
  return source;
}

function validateEvidence(evidence, evidencePath = 'evidence') {
  assertObject(evidence, evidencePath);
  assertKeys(evidence, new Set([
    'id',
    'sourceId',
    'sourceKind',
    'basis',
    'path',
    'lineStart',
    'lineEnd',
    'excerpt',
    'contentHash',
    'collectedAt',
  ]), evidencePath);
  assertStableId(evidence.id, `${evidencePath}.id`);
  assertStableId(evidence.sourceId, `${evidencePath}.sourceId`);
  if (!SOURCE_KINDS.has(evidence.sourceKind)) fail(`${evidencePath}.sourceKind 不是支持的资料来源`);
  if (!EVIDENCE_BASES.has(evidence.basis)) fail(`${evidencePath}.basis 不是支持的依据类型`);
  if (evidence.sourceKind === 'workspace-file') {
    validateSourcePath(evidence.path, `${evidencePath}.path`);
    if (!Number.isSafeInteger(evidence.lineStart) || evidence.lineStart < 1) {
      fail(`${evidencePath}.lineStart 必须是从 1 开始的安全整数`);
    }
    if (!Number.isSafeInteger(evidence.lineEnd) || evidence.lineEnd < evidence.lineStart) {
      fail(`${evidencePath}.lineEnd 必须不早于 lineStart`);
    }
    if (evidence.lineEnd - evidence.lineStart + 1 > MAX_EVIDENCE_LINE_SPAN) {
      fail(`${evidencePath} 的行范围不得超过 ${MAX_EVIDENCE_LINE_SPAN} 行`);
    }
  } else {
    if (evidence.path !== null || evidence.lineStart !== null || evidence.lineEnd !== null) {
      fail(`${evidencePath} 的讨论依据不得声明文件路径或行号`);
    }
    if (!['user-confirmed', 'agent-inference'].includes(evidence.basis)) {
      fail(`${evidencePath}.basis 必须是 user-confirmed 或 agent-inference`);
    }
  }
  assertText(evidence.excerpt, `${evidencePath}.excerpt`, { max: MAX_EVIDENCE_EXCERPT_CHARS });
  assertHash(evidence.contentHash, `${evidencePath}.contentHash`);
  assertTimestamp(evidence.collectedAt, `${evidencePath}.collectedAt`);
  return evidence;
}

function validateEvidenceIds(value, valuePath, { max, knownEvidenceIds } = {}) {
  assertArray(value, valuePath, { min: 1, max });
  const seen = new Set();
  value.forEach((id, index) => {
    assertStableId(id, `${valuePath}[${index}]`);
    if (seen.has(id)) fail(`${valuePath} 不得包含重复证据 ID ${id}`);
    if (knownEvidenceIds && !knownEvidenceIds.has(id)) {
      fail(`${valuePath}[${index}] 引用了未知证据 ${id}`, 'ANALYSIS_EVIDENCE_REFERENCE_UNKNOWN');
    }
    seen.add(id);
  });
  return value;
}

function validateNodeSemanticData(data, dataPath, { requireComplete = false, view } = {}) {
  assertObject(data, dataPath);
  assertKeys(data, NODE_SEMANTIC_FIELDS, dataPath, { patch: true });
  if (!Object.keys(data).length) fail(`${dataPath} 至少需要一个语义字段`);
  if (requireComplete) {
    for (const field of REQUIRED_NODE_SEMANTIC_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(data, field)) {
        fail(`${dataPath}.${field} 是新增节点的必填字段`);
      }
    }
    if (view === 'target' && !Object.prototype.hasOwnProperty.call(data, 'horizon')) {
      fail(`${dataPath}.horizon 是目标架构新增节点的必填字段`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, 'name')) assertText(data.name, `${dataPath}.name`, { max: 120 });
  if (Object.prototype.hasOwnProperty.call(data, 'group')) assertText(data.group, `${dataPath}.group`, { max: 120 });
  if (Object.prototype.hasOwnProperty.call(data, 'purpose')) assertText(data.purpose, `${dataPath}.purpose`, { max: 2000 });
  if (Object.prototype.hasOwnProperty.call(data, 'technical')) assertText(data.technical, `${dataPath}.technical`, { max: 240 });
  if (Object.prototype.hasOwnProperty.call(data, 'product')) assertText(data.product, `${dataPath}.product`, { max: 240 });
  if (Object.prototype.hasOwnProperty.call(data, 'authorization')) assertText(data.authorization, `${dataPath}.authorization`, { max: 300 });
  if (Object.prototype.hasOwnProperty.call(data, 'horizon') && !TARGET_HORIZONS.has(data.horizon)) {
    fail(`${dataPath}.horizon 不是支持的目标时间范围`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'focus') && typeof data.focus !== 'boolean') {
    fail(`${dataPath}.focus 必须是布尔值`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'buildStrategy') && !BUILD_STRATEGIES.has(data.buildStrategy)) {
    fail(`${dataPath}.buildStrategy 不是支持的建设策略`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'aiCollaboration')) {
    assertText(data.aiCollaboration, `${dataPath}.aiCollaboration`, { max: 80 });
  }
  if (Object.prototype.hasOwnProperty.call(data, 'relatedDiagramId')) {
    assertStableId(data.relatedDiagramId, `${dataPath}.relatedDiagramId`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'relatedNodeId')) {
    assertStableId(data.relatedNodeId, `${dataPath}.relatedNodeId`);
    if (requireComplete && !Object.prototype.hasOwnProperty.call(data, 'relatedDiagramId')) {
      fail(`${dataPath}.relatedNodeId 需要同时提供 relatedDiagramId`);
    }
  }
  return data;
}

function validateNodePatch(patch, patchPath, { kind, view }) {
  assertObject(patch, patchPath);
  assertKeys(patch, new Set(['data']), patchPath, { patch: true });
  validateNodeSemanticData(patch.data, `${patchPath}.data`, {
    requireComplete: kind === 'add',
    view,
  });
  return patch;
}

function validateEdgeSemanticData(data, dataPath, { requireComplete = false } = {}) {
  assertObject(data, dataPath);
  assertKeys(data, EDGE_SEMANTIC_FIELDS, dataPath, { patch: true });
  if (!Object.keys(data).length) fail(`${dataPath} 至少需要一个语义字段`);
  if (requireComplete) {
    for (const field of EDGE_SEMANTIC_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(data, field)) {
        fail(`${dataPath}.${field} 是新增关系的必填字段`);
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(data, 'label')) {
    assertText(data.label, `${dataPath}.label`, { max: 240 });
  }
  if (Object.prototype.hasOwnProperty.call(data, 'relationType') && !RELATION_TYPES.has(data.relationType)) {
    fail(`${dataPath}.relationType 不是支持的关系类型`);
  }
  return data;
}

function validateEdgePatch(patch, patchPath, { kind }) {
  assertObject(patch, patchPath);
  assertKeys(patch, kind === 'add' ? new Set(['source', 'target', 'data']) : new Set(['data']), patchPath, { patch: true });
  if (kind === 'add') {
    for (const field of ['source', 'target', 'data']) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) {
        fail(`${patchPath}.${field} 是新增关系的必填字段`);
      }
    }
  } else if (!Object.prototype.hasOwnProperty.call(patch, 'data')) {
    fail(`${patchPath}.data 是更新关系的必填字段`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'source')) {
    assertStableId(patch.source, `${patchPath}.source`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'target')) {
    assertStableId(patch.target, `${patchPath}.target`);
  }
  if (patch.source !== undefined && patch.target !== undefined && patch.source === patch.target) {
    fail(`${patchPath} 不允许关系自连接`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'data')) {
    validateEdgeSemanticData(patch.data, `${patchPath}.data`, { requireComplete: kind === 'add' });
  }
  return patch;
}

function validateProposalChange(change, changePath = 'change', { view, knownEvidenceIds } = {}) {
  assertObject(change, changePath);
  assertKeys(change, new Set([
    'id',
    'kind',
    'targetType',
    'targetId',
    'summary',
    'evidenceIds',
    'patch',
  ]), changePath);
  assertStableId(change.id, `${changePath}.id`);
  if (!CHANGE_KINDS.has(change.kind)) fail(`${changePath}.kind 必须是 add、update 或 remove`);
  if (!CHANGE_TARGET_TYPES.has(change.targetType)) fail(`${changePath}.targetType 必须是 node 或 edge`);
  assertStableId(change.targetId, `${changePath}.targetId`);
  assertText(change.summary, `${changePath}.summary`, { max: 1000 });
  validateEvidenceIds(change.evidenceIds, `${changePath}.evidenceIds`, {
    max: MAX_EVIDENCE_REFS_PER_CHANGE,
    knownEvidenceIds,
  });
  if (change.kind === 'remove') {
    if (change.patch !== null) fail(`${changePath}.patch 在 remove 变更中必须为 null`);
    return change;
  }
  if (!isObject(change.patch)) fail(`${changePath}.patch 必须是对象`);
  if (change.targetType === 'node') {
    validateNodePatch(change.patch, `${changePath}.patch`, { kind: change.kind, view });
  } else {
    validateEdgePatch(change.patch, `${changePath}.patch`, { kind: change.kind });
  }
  return change;
}

function validateApplication(application, applicationPath = 'proposal.application') {
  if (application === null) return application;
  assertObject(application, applicationPath);
  assertKeys(application, new Set(['draftId', 'draftRevision', 'appliedAt']), applicationPath);
  assertStableId(application.draftId, `${applicationPath}.draftId`);
  assertPositiveRevision(application.draftRevision, `${applicationPath}.draftRevision`);
  assertTimestamp(application.appliedAt, `${applicationPath}.appliedAt`);
  return application;
}

function validateProposalOrigin(origin, originPath = 'proposal.origin') {
  if (origin === null) return origin;
  assertObject(origin, originPath);
  assertKeys(origin, new Set([
    'runId',
    'artifactId',
    'artifactType',
    'agentName',
    'agentClient',
  ]), originPath);
  assertStableId(origin.runId, `${originPath}.runId`);
  assertStableId(origin.artifactId, `${originPath}.artifactId`);
  if (!['architecture-snapshot', 'architecture-proposal'].includes(origin.artifactType)) {
    fail(`${originPath}.artifactType 不是可生成提案的工件类型`);
  }
  assertText(origin.agentName, `${originPath}.agentName`, { max: 120 });
  assertText(origin.agentClient, `${originPath}.agentClient`, { max: 80 });
  return origin;
}

function validateAgentRun(run, runPath = 'agentRun') {
  assertObject(run, runPath);
  assertKeys(run, new Set([
    'id',
    'agentName',
    'agentClient',
    'taskType',
    'status',
    'diagramId',
    'view',
    'baseRevision',
    'baseRevisionId',
    'createdAt',
    'updatedAt',
    'submittedAt',
    'summary',
    'artifactIds',
  ]), runPath);
  assertStableId(run.id, `${runPath}.id`);
  assertText(run.agentName, `${runPath}.agentName`, { max: 120 });
  assertText(run.agentClient, `${runPath}.agentClient`, { max: 80 });
  if (!AGENT_TASK_TYPES.has(run.taskType)) fail(`${runPath}.taskType 不是支持的智能体任务类型`);
  if (!AGENT_RUN_STATUSES.has(run.status)) fail(`${runPath}.status 不是支持的运行状态`);
  assertStableId(run.diagramId, `${runPath}.diagramId`);
  if (!['current', 'target'].includes(run.view)) fail(`${runPath}.view 必须是 current 或 target`);
  assertBaseRevision(run.baseRevision, `${runPath}.baseRevision`);
  assertBaseRevisionId(run.baseRevisionId, `${runPath}.baseRevisionId`, run.baseRevision);
  assertTimestamp(run.createdAt, `${runPath}.createdAt`);
  assertTimestamp(run.updatedAt, `${runPath}.updatedAt`);
  assertTimestamp(run.submittedAt, `${runPath}.submittedAt`, { nullable: true });
  if (run.summary !== null) assertText(run.summary, `${runPath}.summary`, { max: 1000 });
  assertArray(run.artifactIds, `${runPath}.artifactIds`, { max: MAX_ARTIFACTS_PER_RUN });
  const artifactIds = new Set();
  run.artifactIds.forEach((id, index) => {
    assertStableId(id, `${runPath}.artifactIds[${index}]`);
    if (artifactIds.has(id)) fail(`${runPath}.artifactIds 不得包含重复工件 ${id}`);
    artifactIds.add(id);
  });
  if (Date.parse(run.updatedAt) < Date.parse(run.createdAt)) fail(`${runPath}.updatedAt 不得早于 createdAt`);
  if (run.status === 'active' && run.submittedAt !== null) fail(`${runPath} 的活动运行不得包含 submittedAt`);
  if (run.status !== 'active' && run.submittedAt === null) fail(`${runPath} 的已提交运行必须包含 submittedAt`);
  return run;
}

function validateAgentArtifact(record, recordPath = 'artifactRecord') {
  assertObject(record, recordPath);
  assertKeys(record, new Set(['id', 'runId', 'artifactType', 'submittedAt', 'artifact']), recordPath);
  assertStableId(record.id, `${recordPath}.id`);
  assertStableId(record.runId, `${recordPath}.runId`);
  assertText(record.artifactType, `${recordPath}.artifactType`, { max: 80 });
  assertTimestamp(record.submittedAt, `${recordPath}.submittedAt`);
  const artifact = validateExchangeArtifact(record.artifact);
  if (artifact.artifactId !== record.id) fail(`${recordPath}.id 必须与 artifact.artifactId 一致`);
  if (artifact.artifactType !== record.artifactType) fail(`${recordPath}.artifactType 必须与工件内容一致`);
  return record;
}

function validateProposal(proposal, proposalPath = 'proposal', { knownEvidenceIds } = {}) {
  assertObject(proposal, proposalPath);
  assertKeys(proposal, new Set([
    'id',
    'status',
    'view',
    'diagramId',
    'baseRevision',
    'baseRevisionId',
    'title',
    'summary',
    'confidence',
    'createdAt',
    'reviewedAt',
    'evidenceIds',
    'changes',
    'application',
    'origin',
  ]), proposalPath);
  assertStableId(proposal.id, `${proposalPath}.id`);
  if (!PROPOSAL_STATUSES.has(proposal.status)) fail(`${proposalPath}.status 不是支持的提案状态`);
  if (!['current', 'target'].includes(proposal.view)) fail(`${proposalPath}.view 必须是 current 或 target`);
  assertStableId(proposal.diagramId, `${proposalPath}.diagramId`);
  assertBaseRevision(proposal.baseRevision, `${proposalPath}.baseRevision`);
  assertBaseRevisionId(proposal.baseRevisionId, `${proposalPath}.baseRevisionId`, proposal.baseRevision);
  assertText(proposal.title, `${proposalPath}.title`, { max: 160 });
  assertText(proposal.summary, `${proposalPath}.summary`, { max: 2000 });
  if (proposal.confidence !== null && !CONFIDENCE_LEVELS.has(proposal.confidence)) {
    fail(`${proposalPath}.confidence 必须是 low、medium、high 或 null`);
  }
  assertTimestamp(proposal.createdAt, `${proposalPath}.createdAt`);
  assertTimestamp(proposal.reviewedAt, `${proposalPath}.reviewedAt`, { nullable: true });
  validateEvidenceIds(proposal.evidenceIds, `${proposalPath}.evidenceIds`, {
    max: MAX_EVIDENCE_REFS_PER_PROPOSAL,
    knownEvidenceIds,
  });
  assertArray(proposal.changes, `${proposalPath}.changes`, { min: 1, max: MAX_CHANGES_PER_PROPOSAL });
  const changeIds = new Set();
  const changeTargets = new Set();
  proposal.changes.forEach((change, index) => {
    const changePath = `${proposalPath}.changes[${index}]`;
    validateProposalChange(change, changePath, { view: proposal.view, knownEvidenceIds });
    if (changeIds.has(change.id)) fail(`${proposalPath}.changes 包含重复变更 ID ${change.id}`);
    const targetKey = `${change.targetType}:${change.targetId}`;
    if (changeTargets.has(targetKey)) fail(`${proposalPath}.changes 不得重复修改 ${targetKey}`);
    changeIds.add(change.id);
    changeTargets.add(targetKey);
  });
  validateApplication(proposal.application, `${proposalPath}.application`);
  validateProposalOrigin(proposal.origin, `${proposalPath}.origin`);
  if (proposal.status === 'pending') {
    if (proposal.reviewedAt !== null || proposal.application !== null) {
      fail(`${proposalPath} 的待审提案不得包含审阅或应用记录`);
    }
  } else if (proposal.status === 'accepted') {
    if (proposal.reviewedAt === null || proposal.application === null) {
      fail(`${proposalPath} 的已接受提案必须包含审阅和草案应用记录`);
    }
  } else if (proposal.reviewedAt === null || proposal.application !== null) {
    fail(`${proposalPath} 的已拒绝提案必须包含审阅记录且不得写入草案`);
  }
  if (proposal.reviewedAt !== null && Date.parse(proposal.reviewedAt) < Date.parse(proposal.createdAt)) {
    fail(`${proposalPath}.reviewedAt 不得早于 createdAt`);
  }
  return proposal;
}

function validateAnalysis(analysis) {
  assertObject(analysis, 'analysis');
  assertKeys(analysis, new Set([
    'schemaVersion',
    'baseRevision',
    'lastUpdated',
    'sources',
    'evidence',
    'proposals',
    'agentRuns',
    'artifacts',
  ]), 'analysis');
  if (analysis.schemaVersion !== ANALYSIS_SCHEMA_VERSION) {
    fail(
      `analysis.schemaVersion 必须是 ${ANALYSIS_SCHEMA_VERSION}`,
      'ANALYSIS_SCHEMA_VERSION_MISMATCH',
      409,
    );
  }
  assertBaseRevision(analysis.baseRevision, 'analysis.baseRevision');
  assertTimestamp(analysis.lastUpdated, 'analysis.lastUpdated');
  assertArray(analysis.sources, 'analysis.sources', { min: 0, max: MAX_SOURCE_COUNT });
  assertArray(analysis.evidence, 'analysis.evidence', { min: 0, max: MAX_EVIDENCE_COUNT });
  assertArray(analysis.proposals, 'analysis.proposals', { min: 0, max: MAX_PROPOSAL_COUNT });
  assertArray(analysis.agentRuns, 'analysis.agentRuns', { min: 0, max: MAX_AGENT_RUN_COUNT });
  assertArray(analysis.artifacts, 'analysis.artifacts', { min: 0, max: MAX_ARTIFACT_COUNT });

  const runsById = new Map();
  analysis.agentRuns.forEach((run, index) => {
    const runPath = `analysis.agentRuns[${index}]`;
    validateAgentRun(run, runPath);
    if (runsById.has(run.id)) fail(`analysis.agentRuns 包含重复运行 ID ${run.id}`);
    runsById.set(run.id, run);
  });

  const artifactsById = new Map();
  analysis.artifacts.forEach((record, index) => {
    const recordPath = `analysis.artifacts[${index}]`;
    validateAgentArtifact(record, recordPath);
    if (artifactsById.has(record.id)) fail(`analysis.artifacts 包含重复工件 ID ${record.id}`);
    if (!runsById.has(record.runId)) fail(`${recordPath}.runId 引用了未知运行 ${record.runId}`);
    artifactsById.set(record.id, record);
  });
  analysis.agentRuns.forEach((run, index) => {
    run.artifactIds.forEach((artifactId) => {
      const record = artifactsById.get(artifactId);
      if (!record || record.runId !== run.id) {
        fail(`analysis.agentRuns[${index}].artifactIds 引用了不属于该运行的工件 ${artifactId}`);
      }
    });
  });

  const sourcesById = new Map();
  const sourcePaths = new Set();
  analysis.sources.forEach((source, index) => {
    const sourcePath = `analysis.sources[${index}]`;
    validateSource(source, sourcePath);
    if (sourcesById.has(source.id)) fail(`analysis.sources 包含重复资料 ID ${source.id}`);
    const pathKey = source.path?.toLowerCase();
    if (pathKey && sourcePaths.has(pathKey)) fail(`analysis.sources 包含重复资料路径 ${source.path}`);
    sourcesById.set(source.id, source);
    if (pathKey) sourcePaths.add(pathKey);
  });

  const evidenceIds = new Set();
  analysis.evidence.forEach((evidence, index) => {
    const evidencePath = `analysis.evidence[${index}]`;
    validateEvidence(evidence, evidencePath);
    if (evidenceIds.has(evidence.id)) fail(`analysis.evidence 包含重复证据 ID ${evidence.id}`);
    const source = sourcesById.get(evidence.sourceId);
    if (!source) fail(`${evidencePath}.sourceId 引用了未知资料 ${evidence.sourceId}`, 'ANALYSIS_SOURCE_REFERENCE_UNKNOWN');
    if (source.sourceKind !== evidence.sourceKind) {
      fail(`${evidencePath}.sourceKind 必须与其资料来源一致`, 'ANALYSIS_EVIDENCE_SOURCE_KIND_MISMATCH');
    }
    if (source.path !== evidence.path) {
      fail(`${evidencePath}.path 必须与其 sourceId 的资料路径一致`, 'ANALYSIS_EVIDENCE_PATH_MISMATCH');
    }
    if (source.lastScannedAt === null) {
      fail(`${evidencePath}.sourceId 必须引用已扫描资料`, 'ANALYSIS_SOURCE_NOT_SCANNED');
    }
    evidenceIds.add(evidence.id);
  });

  const proposalIds = new Set();
  const changeIds = new Set();
  analysis.proposals.forEach((proposal, index) => {
    const proposalPath = `analysis.proposals[${index}]`;
    validateProposal(proposal, proposalPath, { knownEvidenceIds: evidenceIds });
    if (proposalIds.has(proposal.id)) fail(`analysis.proposals 包含重复提案 ID ${proposal.id}`);
    proposalIds.add(proposal.id);
    proposal.changes.forEach((change) => {
      if (changeIds.has(change.id)) fail(`analysis.proposals 包含重复变更 ID ${change.id}`);
      changeIds.add(change.id);
    });
    if (proposal.origin) {
      const run = runsById.get(proposal.origin.runId);
      const artifact = artifactsById.get(proposal.origin.artifactId);
      if (!run) fail(`${proposalPath}.origin.runId 引用了未知运行 ${proposal.origin.runId}`);
      if (!artifact || artifact.runId !== run.id) {
        fail(`${proposalPath}.origin.artifactId 引用了不属于该运行的工件 ${proposal.origin.artifactId}`);
      }
    }
  });
  return analysis;
}

function migrateAnalysis(value) {
  const incoming = clone(value);
  if (incoming?.schemaVersion === ANALYSIS_SCHEMA_VERSION) {
    validateAnalysis(incoming);
    return incoming;
  }
  if (!['1.0.0', '2.0.0'].includes(incoming?.schemaVersion)) {
    fail(
      `analysis.schemaVersion 无法迁移到 ${ANALYSIS_SCHEMA_VERSION}`,
      'ANALYSIS_SCHEMA_VERSION_MISMATCH',
      409,
    );
  }
  const legacyBases = new Map();
  for (const record of incoming.artifacts || []) {
    if (record?.artifactType !== 'evidence-manifest') continue;
    for (const entry of record.artifact?.entries || []) {
      legacyBases.set(entry.id, entry.basis);
    }
  }
  const migratedSources = (incoming.sources || []).map((source) => ({
    ...source,
    sourceKind: source.sourceKind || 'workspace-file',
  }));
  const sourcesById = new Map(migratedSources.map((source) => [source.id, source]));
  const migratedEvidence = (incoming.evidence || []).map((evidence) => {
    const source = sourcesById.get(evidence.sourceId);
    const legacyBasis = legacyBases.get(evidence.id);
    const basis = evidence.basis
      || (legacyBasis === 'inference' ? 'agent-inference' : null)
      || (source?.type === 'source-code' ? 'code-fact' : 'design-document');
    return {
      ...evidence,
      sourceKind: evidence.sourceKind || source?.sourceKind || 'workspace-file',
      basis,
    };
  });
  const migrated = {
    ...incoming,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    sources: migratedSources,
    evidence: migratedEvidence,
    agentRuns: incoming.schemaVersion === '1.0.0' ? [] : (incoming.agentRuns || []),
    artifacts: incoming.schemaVersion === '1.0.0' ? [] : (incoming.artifacts || []),
    proposals: (incoming.proposals || []).map((proposal) => ({ ...proposal, origin: null })),
  };
  if (incoming.schemaVersion === '2.0.0') migrated.proposals = incoming.proposals || [];
  validateAnalysis(migrated);
  return migrated;
}

function createEmptyAnalysis(now = new Date().toISOString()) {
  const analysis = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    baseRevision: 0,
    lastUpdated: now,
    sources: [],
    evidence: [],
    proposals: [],
    agentRuns: [],
    artifacts: [],
  };
  validateAnalysis(analysis);
  return clone(analysis);
}

module.exports = {
  ANALYSIS_SCHEMA_VERSION,
  AGENT_RUN_STATUSES,
  AGENT_TASK_TYPES,
  CHANGE_KINDS,
  CHANGE_TARGET_TYPES,
  CONFIDENCE_LEVELS,
  EVIDENCE_BASES,
  MAX_CHANGES_PER_PROPOSAL,
  MAX_EVIDENCE_COUNT,
  MAX_EVIDENCE_EXCERPT_CHARS,
  MAX_EVIDENCE_LINE_SPAN,
  MAX_PROPOSAL_COUNT,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_COUNT,
  PROPOSAL_STATUSES,
  SOURCE_TYPES,
  SOURCE_KINDS,
  createEmptyAnalysis,
  migrateAnalysis,
  validateAnalysis,
  validateAgentArtifact,
  validateAgentRun,
  validateApplication,
  validateEvidence,
  validateProposal,
  validateProposalChange,
  validateSource,
  validateSourcePath,
};
