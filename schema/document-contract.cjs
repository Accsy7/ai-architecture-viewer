'use strict';

const path = require('path');
const { ContractError, clone } = require('./state-contract.cjs');

const DOCUMENT_SCHEMA_VERSION = '1.0.0';
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const MAX_PREVIEW_BYTES = 32 * 1024;
const DOCUMENT_TYPES = new Set([
  'current_fact',
  'target_design',
  'technical_spec',
  'decision',
  'work_package',
  'acceptance_evidence',
  'risk_question',
  'other',
]);
const DOCUMENT_STATUSES = new Set(['active', 'draft', 'superseded', 'archived']);
const DOCUMENT_AUTHORITIES = new Set(['source_of_truth', 'supporting', 'reference', 'candidate']);
const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function fail(message, code = 'DOCUMENT_VALIDATION_ERROR', status = 422, details) {
  throw new ContractError(message, code, status, details);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, valuePath) {
  if (!isObject(value)) fail(`${valuePath} 必须是对象`);
}

function assertKeys(value, allowed, valuePath) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${valuePath}.${key} 不是文档注册表字段`);
  }
}

function assertText(value, valuePath, max) {
  if (typeof value !== 'string' || !value.trim()) fail(`${valuePath} 必须是非空文本`);
  if (value.length > max) fail(`${valuePath} 超过 ${max} 字符`);
}

function assertStableId(value, valuePath, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !STABLE_ID.test(value)) fail(`${valuePath} 必须是稳定 ID`);
}

function assertTimestamp(value, valuePath) {
  assertText(value, valuePath, 80);
  if (Number.isNaN(Date.parse(value))) fail(`${valuePath} 必须是有效时间戳`);
}

function assertBaseRevision(value, valuePath = 'baseRevision') {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${valuePath} 必须是非负安全整数`);
}

function validateDocumentPath(value, valuePath = 'document.path') {
  assertText(value, valuePath, 500);
  if (value.includes('\0') || value.includes('\\')) fail(`${valuePath} 必须是安全的正斜杠相对路径`, 'DOCUMENT_PATH_INVALID');
  if (path.posix.isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.startsWith('//')) {
    fail(`${valuePath} 不得使用绝对路径、盘符或 UNC 路径`, 'DOCUMENT_PATH_INVALID');
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail(`${valuePath} 不得包含空段、. 或 ..`, 'DOCUMENT_PATH_INVALID');
  }
  if (path.posix.normalize(value) !== value || path.posix.extname(value).toLowerCase() !== '.md') {
    fail(`${valuePath} 必须是规范化的 Markdown 相对路径`, 'DOCUMENT_PATH_INVALID');
  }
  return value;
}

function validateDocument(document, documentPath = 'document') {
  assertObject(document, documentPath);
  assertKeys(document, new Set([
    'id', 'title', 'type', 'status', 'authority', 'path', 'summary', 'supersedes', 'lastVerifiedAt',
  ]), documentPath);
  assertStableId(document.id, `${documentPath}.id`);
  assertText(document.title, `${documentPath}.title`, 200);
  if (!DOCUMENT_TYPES.has(document.type)) fail(`${documentPath}.type 无效`);
  if (!DOCUMENT_STATUSES.has(document.status)) fail(`${documentPath}.status 无效`);
  if (!DOCUMENT_AUTHORITIES.has(document.authority)) fail(`${documentPath}.authority 无效`);
  validateDocumentPath(document.path, `${documentPath}.path`);
  assertText(document.summary, `${documentPath}.summary`, 1000);
  assertStableId(document.supersedes, `${documentPath}.supersedes`, { nullable: true });
  if (document.supersedes === document.id) fail(`${documentPath}.supersedes 不得指向自身`);
  assertTimestamp(document.lastVerifiedAt, `${documentPath}.lastVerifiedAt`);
  return document;
}

function validateRegistry(registry) {
  assertObject(registry, 'registry');
  assertKeys(registry, new Set(['schemaVersion', 'baseRevision', 'lastUpdated', 'documents']), 'registry');
  if (registry.schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    fail(`文档注册表 schemaVersion 必须是 ${DOCUMENT_SCHEMA_VERSION}`, 'DOCUMENT_SCHEMA_VERSION_MISMATCH', 409);
  }
  assertBaseRevision(registry.baseRevision, 'registry.baseRevision');
  assertTimestamp(registry.lastUpdated, 'registry.lastUpdated');
  if (!Array.isArray(registry.documents)) fail('registry.documents 必须是数组');
  const ids = new Set();
  const paths = new Set();
  registry.documents.forEach((document, index) => {
    validateDocument(document, `registry.documents[${index}]`);
    if (ids.has(document.id)) fail(`文档 ID ${document.id} 重复`);
    if (paths.has(document.path.toLowerCase())) fail(`文档路径 ${document.path} 重复`);
    ids.add(document.id);
    paths.add(document.path.toLowerCase());
  });
  registry.documents.forEach((document) => {
    if (document.supersedes !== null && !ids.has(document.supersedes)) {
      fail(`文档 ${document.id} 的 supersedes 引用了未知文档`);
    }
  });
  return registry;
}

function validateRegistryWriteRequest(request) {
  assertObject(request, 'request');
  assertKeys(request, new Set(['schemaVersion', 'baseRevision', 'document']), 'request');
  if (request.schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    fail(`文档注册表 schemaVersion 必须是 ${DOCUMENT_SCHEMA_VERSION}`, 'DOCUMENT_SCHEMA_VERSION_MISMATCH', 409);
  }
  assertBaseRevision(request.baseRevision, 'request.baseRevision');
  validateDocument(request.document, 'request.document');
  return request;
}

function validateRegistryDeleteRequest(request) {
  assertObject(request, 'request');
  assertKeys(request, new Set(['schemaVersion', 'baseRevision']), 'request');
  if (request.schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    fail(`文档注册表 schemaVersion 必须是 ${DOCUMENT_SCHEMA_VERSION}`, 'DOCUMENT_SCHEMA_VERSION_MISMATCH', 409);
  }
  assertBaseRevision(request.baseRevision, 'request.baseRevision');
  return request;
}

function createEmptyRegistry(now = new Date().toISOString()) {
  const registry = {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    baseRevision: 0,
    lastUpdated: now,
    documents: [],
  };
  return clone(registry);
}

module.exports = {
  DOCUMENT_AUTHORITIES,
  DOCUMENT_SCHEMA_VERSION,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_PREVIEW_BYTES,
  createEmptyRegistry,
  validateDocument,
  validateDocumentPath,
  validateRegistry,
  validateRegistryDeleteRequest,
  validateRegistryWriteRequest,
};
