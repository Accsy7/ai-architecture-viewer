'use strict';

const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  ContractError,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  DEVELOPMENT_CONTRACT_SCHEMA_VERSION,
  NODE_TYPE,
  SCHEMA_VERSION,
  clone,
  diffGraphs,
  migrateLegacyState,
  revisionSummary,
  validateActionRequest,
  validateDraftRequest,
  validateGraph,
  validateRevisionRequest,
  validateState,
  unboundDraftDevelopmentContract,
} = require('./schema/state-contract.cjs');
const {
  DOCUMENT_SCHEMA_VERSION,
  MAX_DOCUMENT_BYTES,
  MAX_PREVIEW_BYTES,
  validateDocumentPath,
  validateRegistry,
  validateRegistryDeleteRequest,
  validateRegistryWriteRequest,
} = require('./schema/document-contract.cjs');
const {
  LAYOUT_SCHEMA_VERSION,
  LayoutContractError,
  createInitialLayout,
  mergeLayout,
  validateLayout,
} = require('./schema/viewer-layout-contract.cjs');
const {
  CATALOG_SCHEMA_VERSION,
  createFallbackCatalog,
  publicArchitectureCatalog,
  resolveArchitectureCatalog,
} = require('./schema/architecture-catalog-contract.cjs');
const {
  REGISTERED_FLOW_SCHEMA_VERSION,
  resolveRegisteredFlowRegistry,
} = require('./schema/registered-flow-contract.cjs');
const {
  ANALYSIS_SCHEMA_VERSION,
  AGENT_TASK_TYPES,
  createEmptyAnalysis,
  migrateAnalysis,
  validateAnalysis,
} = require('./schema/analysis-contract.cjs');
const {
  AI_CODING_PROTOCOL_VERSION,
  validateExchangeArtifact,
} = require('./schema/ai-coding-exchange-contract.cjs');
const {
  readAnalysisSource,
  sourceIdForPath,
  sourceLabelForPath,
  sourceTypeForPath,
} = require('./analysis-sources.cjs');
const { readSkillCatalog } = require('./skill-catalog.cjs');
const {
  AGENT_NODE_DATA_FIELDS: AGENT_NODE_DATA_FIELD_NAMES,
  AGENT_NODE_CLEARABLE_FIELDS: AGENT_NODE_CLEARABLE_FIELD_NAMES,
  AGENT_EDGE_DATA_FIELDS: AGENT_EDGE_DATA_FIELD_NAMES,
} = require('./schema/agent-semantic-fields.cjs');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8800;
const ROOT = __dirname;
const PROJECTS_ROOT = path.join(ROOT, 'projects');
const PROJECT_MANIFEST_FILE = 'project.json';
const TASK_ARTIFACT_TYPES = Object.freeze({
  'architecture-discovery': new Set(['architecture-snapshot']),
  'architecture-change-plan': new Set(['architecture-proposal']),
  'implementation-reconcile': new Set(['implementation-report', 'architecture-snapshot']),
});
const PROJECT_FILES = Object.freeze({
  state: 'state.json',
  documents: 'document-registry.json',
  layout: 'viewer-layout.json',
  config: 'viewer.config.json',
  catalog: 'architecture-catalog.json',
  registeredFlows: 'registered-business-flows.json',
  analysis: 'analysis.json',
});
const VIEWER_CONFIG_SCHEMA_VERSION = '1.0.0';
const FORMAL_CONTRACT_PROTOCOL_VERSIONS = new Set(['1.3.0', AI_CODING_PROTOCOL_VERSION]);
const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const AGENT_NODE_DATA_FIELDS = new Set(AGENT_NODE_DATA_FIELD_NAMES);
const AGENT_NODE_CLEARABLE_FIELDS = new Set(AGENT_NODE_CLEARABLE_FIELD_NAMES);
const AGENT_EDGE_DATA_FIELDS = new Set(AGENT_EDGE_DATA_FIELD_NAMES);
const RECONCILIATION_NODE_FIELDS = [
  'name', 'purpose', 'technical', 'product', 'authorization',
  'documentRefs', 'interactionModes', 'architectureLayer',
];
const RECONCILIATION_EDGE_FIELDS = ['source', 'target', ...AGENT_EDGE_DATA_FIELD_NAMES];

function parsePort(value) {
  const port = value === undefined || value === '' ? DEFAULT_PORT : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 必须是 0 到 65535 之间的整数');
  return port;
}

function readProjectManifest(projectDirectory) {
  const manifestFile = path.join(projectDirectory, PROJECT_MANIFEST_FILE);
  if (!fs.existsSync(manifestFile)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('manifest 必须是对象');
    }
    return manifest;
  } catch (error) {
    throw new Error(`无法读取项目清单 ${manifestFile}：${error.message}`);
  }
}

function discoverDefaultProjectDirectory(projectsRoot = PROJECTS_ROOT) {
  if (!fs.existsSync(projectsRoot) || !fs.statSync(projectsRoot).isDirectory()) {
    throw new Error(`未找到项目数据包目录：${projectsRoot}`);
  }
  const candidates = fs.readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsRoot, entry.name))
    .filter((projectDirectory) => fs.existsSync(path.join(projectDirectory, PROJECT_MANIFEST_FILE)))
    .map((projectDirectory) => ({ projectDirectory, manifest: readProjectManifest(projectDirectory) }));
  const defaults = candidates.filter(({ manifest }) => manifest.default === true);
  if (defaults.length === 1) return defaults[0].projectDirectory;
  if (defaults.length > 1) throw new Error('多个项目数据包被标记为默认项目，请使用 VIEWER_PROJECT_DIR 显式选择');
  if (candidates.length === 1) return candidates[0].projectDirectory;
  if (!candidates.length) throw new Error('没有可用的项目数据包，请添加 project.json 或设置 VIEWER_PROJECT_DIR');
  throw new Error('存在多个项目数据包但没有默认项目，请使用 VIEWER_PROJECT_DIR 显式选择');
}

function resolveProjectDirectory(value = process.env.VIEWER_PROJECT_DIR) {
  const projectDirectory = value ? path.resolve(ROOT, value) : discoverDefaultProjectDirectory();
  if (!fs.existsSync(projectDirectory) || !fs.statSync(projectDirectory).isDirectory()) {
    throw new Error(`项目数据包目录不存在：${projectDirectory}`);
  }
  return projectDirectory;
}

function resolveWorkspaceRoot(value = process.env.VIEWER_WORKSPACE_ROOT, projectDirectory = resolveProjectDirectory()) {
  const workspaceRoot = value ? path.resolve(ROOT, value) : projectDirectory;
  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    throw new Error(`待检查代码仓库目录不存在：${workspaceRoot}`);
  }
  return workspaceRoot;
}

function resolveProjectFile(value, projectDirectory, fileName) {
  return value ? path.resolve(value) : path.join(projectDirectory, fileName);
}

function resolveStateFile(value = process.env.STATE_FILE, projectDirectory = resolveProjectDirectory()) {
  return resolveProjectFile(value, projectDirectory, PROJECT_FILES.state);
}

function resolveDocumentsFile(value = process.env.DOCUMENTS_FILE, projectDirectory = resolveProjectDirectory()) {
  return resolveProjectFile(value, projectDirectory, PROJECT_FILES.documents);
}

function resolveLayoutFile(value = process.env.LAYOUT_FILE, projectDirectory = resolveProjectDirectory()) {
  return resolveProjectFile(value, projectDirectory, PROJECT_FILES.layout);
}

function resolveConfigFile(value = process.env.VIEWER_CONFIG_FILE, projectDirectory = resolveProjectDirectory()) {
  return resolveProjectFile(value, projectDirectory, PROJECT_FILES.config);
}

function resolveCatalogFile(value = process.env.CATALOG_FILE, projectDirectory = resolveProjectDirectory()) {
  return resolveProjectFile(value, projectDirectory, PROJECT_FILES.catalog);
}

function resolveRegisteredFlowsFile(
  value = process.env.REGISTERED_FLOWS_FILE,
  projectDirectory = resolveProjectDirectory(),
) {
  return resolveProjectFile(value, projectDirectory, PROJECT_FILES.registeredFlows);
}

function resolveAnalysisFile(value = process.env.ANALYSIS_FILE, projectDirectory = resolveProjectDirectory()) {
  return resolveProjectFile(value, projectDirectory, PROJECT_FILES.analysis);
}

function requiredConfigText(value, field, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new ContractError(`查看器配置 ${field} 无效`, 'VIEWER_CONFIG_INVALID', 500, { field });
  }
  return value.trim();
}

function localizedConfigText(value, field, maxLength) {
  if (typeof value === 'string') return requiredConfigText(value, field, maxLength);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError(`查看器配置 ${field} 无效`, 'VIEWER_CONFIG_INVALID', 500, { field });
  }
  const localized = {};
  for (const language of ['zh', 'en']) {
    if (value[language] === undefined || value[language] === null) continue;
    localized[language] = requiredConfigText(value[language], `${field}.${language}`, maxLength);
  }
  if (!localized.zh && !localized.en) {
    throw new ContractError(`查看器配置 ${field} 无效`, 'VIEWER_CONFIG_INVALID', 500, { field });
  }
  return localized;
}

function resolvedConfigText(value, language = 'zh') {
  if (typeof value === 'string') return value;
  const preferredLanguage = language === 'en' ? 'en' : 'zh';
  const alternateLanguage = preferredLanguage === 'en' ? 'zh' : 'en';
  return value?.[preferredLanguage] || value?.[alternateLanguage] || '';
}

function readViewerConfig(configFile) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (error) {
    throw new ContractError(`无法读取查看器项目配置：${error.message}`, 'VIEWER_CONFIG_READ_FAILED', 500);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schemaVersion !== VIEWER_CONFIG_SCHEMA_VERSION) {
    throw new ContractError('查看器项目配置版本无效', 'VIEWER_CONFIG_INVALID', 500);
  }
  const projectId = requiredConfigText(raw.projectId, 'projectId', 80);
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(projectId)) {
    throw new ContractError('查看器配置 projectId 只能使用小写字母、数字、点、下划线和短横线', 'VIEWER_CONFIG_INVALID', 500);
  }
  const views = {};
  for (const view of ['current', 'target', 'compare']) {
    const entry = raw.views?.[view];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ContractError(`查看器配置缺少 ${view} 视图`, 'VIEWER_CONFIG_INVALID', 500);
    }
    views[view] = {
      label: requiredConfigText(entry.label, `views.${view}.label`, 40),
      description: requiredConfigText(entry.description, `views.${view}.description`, 120),
    };
  }
  if (!Array.isArray(raw.nodeFields) || raw.nodeFields.length > 20) {
    throw new ContractError('查看器配置 nodeFields 无效', 'VIEWER_CONFIG_INVALID', 500);
  }
  const nodeFields = raw.nodeFields.map((field, index) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw new ContractError(`查看器配置 nodeFields[${index}] 无效`, 'VIEWER_CONFIG_INVALID', 500);
    }
    const key = requiredConfigText(field.key, `nodeFields[${index}].key`, 80);
    if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,79}$/.test(key)) {
      throw new ContractError(`查看器配置 nodeFields[${index}].key 无效`, 'VIEWER_CONFIG_INVALID', 500);
    }
    return {
      key,
      label: requiredConfigText(field.label, `nodeFields[${index}].label`, 40),
      multiline: Boolean(field.multiline),
      tone: typeof field.tone === 'string' ? field.tone.slice(0, 40) : null,
      optional: Boolean(field.optional),
      ...(field.format === 'tags' ? { format: 'tags' } : {}),
    };
  });
  const defaultFocusNodeId = raw.defaultFocusNodeId === null || raw.defaultFocusNodeId === undefined
    ? null
    : requiredConfigText(raw.defaultFocusNodeId, 'defaultFocusNodeId', 120);
  const defaultLanguage = raw.defaultLanguage === null || raw.defaultLanguage === undefined
    ? null
    : requiredConfigText(raw.defaultLanguage, 'defaultLanguage', 8);
  if (defaultLanguage !== null && !['zh', 'en'].includes(defaultLanguage)) {
    throw new ContractError('查看器配置 defaultLanguage 只能是 zh 或 en', 'VIEWER_CONFIG_INVALID', 500);
  }
  return {
    schemaVersion: VIEWER_CONFIG_SCHEMA_VERSION,
    projectId,
    projectName: requiredConfigText(raw.projectName, 'projectName', 80),
    viewerName: localizedConfigText(raw.viewerName, 'viewerName', 80),
    eyebrow: localizedConfigText(raw.eyebrow, 'eyebrow', 120),
    scopeNote: localizedConfigText(raw.scopeNote, 'scopeNote', 320),
    defaultLanguage,
    defaultFocusNodeId,
    views,
    nodeFields,
  };
}

function readArchitectureCatalog(
  catalogFile = resolveCatalogFile(),
  stateFile = resolveStateFile(),
  layoutFile = resolveLayoutFile(),
) {
  if (!fs.existsSync(catalogFile)) return createFallbackCatalog(stateFile, layoutFile);
  try {
    const raw = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    return resolveArchitectureCatalog(raw, catalogFile);
  } catch (error) {
    if (error instanceof ContractError) {
      throw new ContractError(`本地架构目录无效：${error.message}`, 'ARCHITECTURE_CATALOG_INVALID', 500, {
        causeCode: error.code,
      });
    }
    throw new ContractError(`无法读取本地架构目录：${error.message}`, 'ARCHITECTURE_CATALOG_READ_FAILED', 500);
  }
}

function readRegisteredFlows(file, context) {
  if (!fs.existsSync(file)) {
    return {
      schemaVersion: REGISTERED_FLOW_SCHEMA_VERSION,
      diagramId: context.diagramId,
      view: context.view,
      flows: [],
    };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ContractError(
      `无法读取登记业务流：${error.message}`,
      'REGISTERED_FLOW_READ_FAILED',
      500,
    );
  }
  return resolveRegisteredFlowRegistry(raw, context);
}

function diagramFrom(url, catalog) {
  const diagramId = url.searchParams.get('diagram') || catalog.defaultDiagramId;
  const diagram = catalog.diagrams.find((entry) => entry.id === diagramId);
  if (!diagram) {
    throw new ContractError('未找到指定架构图', 'DIAGRAM_NOT_FOUND', 404, { diagramId });
  }
  return diagram;
}

function readDiagramStates(catalog) {
  return catalog.diagrams.map((diagram) => ({ diagramId: diagram.id, state: readState(diagram.statePath) }));
}

function resolveStaticRoot(value) {
  const staticRoot = path.resolve(value || path.join(ROOT, 'dist'));
  const indexFile = path.join(staticRoot, 'index.html');
  if (!fs.existsSync(indexFile) || !fs.statSync(indexFile).isFile()) {
    throw new Error('Static build is missing. Run npm run build before starting the server.');
  }
  return staticRoot;
}

function securityHeaders(contentType) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': CSP,
    'Content-Type': contentType,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

function json(res, status, value) {
  res.writeHead(status, securityHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(value));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooLarge) return;
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) {
        tooLarge = true;
        reject(new ContractError('请求内容超过 1MB', 'REQUEST_TOO_LARGE', 413));
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new ContractError('请求内容不是有效 JSON', 'INVALID_JSON', 400));
      }
    });
    req.on('error', reject);
  });
}

function writeJsonAtomic(value, file) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}

function readState(stateFile) {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const state = migrateLegacyState(raw);
    validateState(state);
    if (raw.schemaVersion !== SCHEMA_VERSION) writeJsonAtomic(state, stateFile);
    return state;
  } catch (error) {
    if (error instanceof ContractError) {
      throw new ContractError(`本地架构状态无效：${error.message}`, 'STATE_INVALID', 500, { causeCode: error.code });
    }
    throw new ContractError(`无法读取本地架构状态：${error.message}`, 'STATE_READ_FAILED', 500);
  }
}

function writeState(value, stateFile) {
  const state = clone(value);
  state.meta.lastUpdated = new Date().toISOString();
  validateState(state);
  writeJsonAtomic(state, stateFile);
  return state;
}

function readRegistry(documentsFile) {
  try {
    const registry = JSON.parse(fs.readFileSync(documentsFile, 'utf8'));
    validateRegistry(registry);
    return registry;
  } catch (error) {
    if (error instanceof ContractError) {
      throw new ContractError(`本地文档注册表无效：${error.message}`, 'DOCUMENT_REGISTRY_INVALID', 500, { causeCode: error.code });
    }
    throw new ContractError(`无法读取本地文档注册表：${error.message}`, 'DOCUMENT_REGISTRY_READ_FAILED', 500);
  }
}

function writeRegistry(value, documentsFile) {
  const registry = clone(value);
  registry.baseRevision += 1;
  registry.lastUpdated = new Date().toISOString();
  validateRegistry(registry);
  writeJsonAtomic(registry, documentsFile);
  return registry;
}

function readLayout(layoutFile, state) {
  try {
    if (!fs.existsSync(layoutFile)) {
      const initial = createInitialLayout(state);
      writeJsonAtomic(initial, layoutFile);
      return initial;
    }
    const layout = JSON.parse(fs.readFileSync(layoutFile, 'utf8'));
    return validateLayout(layout);
  } catch (error) {
    if (error instanceof LayoutContractError) {
      throw new ContractError(`本地查看器排版无效：${error.message}`, 'LAYOUT_INVALID', 500, { causeCode: error.code });
    }
    if (error instanceof ContractError) throw error;
    throw new ContractError(`无法读取本地查看器排版：${error.message}`, 'LAYOUT_READ_FAILED', 500);
  }
}

function writeLayout(value, layoutFile) {
  const layout = clone(value);
  layout.baseRevision += 1;
  layout.lastUpdated = new Date().toISOString();
  validateLayout(layout);
  writeJsonAtomic(layout, layoutFile);
  return layout;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertAnalysisRequestShape(value, allowedKeys) {
  if (!isPlainObject(value)) throw new ContractError('分析请求必须是对象', 'ANALYSIS_REQUEST_INVALID', 400);
  Object.keys(value).forEach((key) => {
    if (!allowedKeys.has(key)) {
      throw new ContractError(`分析请求不支持字段 ${key}`, 'ANALYSIS_REQUEST_INVALID', 400);
    }
  });
  if (value.schemaVersion !== ANALYSIS_SCHEMA_VERSION) {
    throw new ContractError(`analysis schemaVersion 必须是 ${ANALYSIS_SCHEMA_VERSION}`, 'ANALYSIS_SCHEMA_VERSION_MISMATCH', 409);
  }
  if (!Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0) {
    throw new ContractError('分析请求必须提供有效 baseRevision', 'ANALYSIS_REQUEST_INVALID', 400);
  }
  return value;
}

function assertAnalysisRevision(incoming, analysis) {
  if (incoming.baseRevision !== analysis.baseRevision) {
    throw new ContractError('分析工作台内容已变化，请刷新后重试', 'STALE_ANALYSIS', 409, {
      baseRevision: analysis.baseRevision,
    });
  }
}

function readAnalysis(analysisFile) {
  try {
    if (!fs.existsSync(analysisFile)) {
      const initial = createEmptyAnalysis();
      writeJsonAtomic(initial, analysisFile);
      return initial;
    }
    const stored = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
    const analysis = migrateAnalysis(stored);
    if (stored.schemaVersion !== analysis.schemaVersion) writeJsonAtomic(analysis, analysisFile);
    return analysis;
  } catch (error) {
    if (error instanceof ContractError) {
      throw new ContractError(`本地分析工作台数据无效：${error.message}`, 'ANALYSIS_INVALID', 500, { causeCode: error.code });
    }
    throw new ContractError(`无法读取本地分析工作台数据：${error.message}`, 'ANALYSIS_READ_FAILED', 500);
  }
}

function writeAnalysis(value, analysisFile) {
  const analysis = clone(value);
  analysis.baseRevision += 1;
  analysis.lastUpdated = new Date().toISOString();
  validateAnalysis(analysis);
  writeJsonAtomic(analysis, analysisFile);
  return analysis;
}

function proposalEvidenceIds(proposal) {
  const ids = new Set(proposal.evidenceIds || []);
  (proposal.changes || []).forEach((change) => (change.evidenceIds || []).forEach((id) => ids.add(id)));
  (proposal.contractPatch?.upsert || []).forEach((criterion) => (criterion.evidenceIds || []).forEach((id) => ids.add(id)));
  (proposal.contractPatch?.delete || []).forEach((operation) => (operation.evidenceIds || []).forEach((id) => ids.add(id)));
  return ids;
}

function publicArtifactRecord(record) {
  const artifact = record.artifact;
  const summary = {};
  if (artifact.artifactType === 'evidence-manifest') {
    summary.evidenceCount = artifact.entries.length;
  } else if (artifact.artifactType === 'architecture-snapshot') {
    summary.nodeCount = artifact.nodes.length;
    summary.edgeCount = artifact.edges.length;
    summary.unknownCount = artifact.unknowns.length;
  } else if (artifact.artifactType === 'architecture-proposal') {
    summary.changeCount = artifact.changes.length;
    summary.contractChangeCount = (artifact.contractPatch?.upsert?.length || 0) + (artifact.contractPatch?.delete?.length || 0);
    summary.optionCount = artifact.options.length;
    summary.decisionCount = artifact.decisionsRequired.length;
  } else if (artifact.artifactType === 'implementation-report') {
    summary.status = artifact.status;
    summary.changedFileCount = artifact.changedFiles.length;
    summary.passedCheckCount = artifact.tests.filter((item) => item.outcome === 'passed').length;
    summary.failedCheckCount = artifact.tests.filter((item) => item.outcome === 'failed').length;
    summary.acceptedCriterionCount = artifact.acceptanceResults.filter((item) => item.status === 'satisfied').length;
    summary.criterionCount = artifact.acceptanceResults.length;
    summary.driftCount = artifact.drift.length;
    summary.unresolvedCount = artifact.unresolved.length;
  }
  return {
    id: record.id,
    artifactType: record.artifactType,
    submittedAt: record.submittedAt,
    summary,
  };
}

function assertProposalEvidenceCurrent(proposal, analysis, { workspaceRoot, projectRoot, registry }) {
  const evidenceById = new Map(analysis.evidence.map((evidence) => [evidence.id, evidence]));
  const sourceById = new Map(analysis.sources.map((source) => [source.id, source]));
  const staleEvidenceIds = [];
  proposalEvidenceIds(proposal).forEach((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    const source = evidence ? sourceById.get(evidence.sourceId) : null;
    if (!evidence || !source) {
      staleEvidenceIds.push(evidenceId);
      return;
    }
    if (evidence.sourceKind === 'discussion') {
      if (source.sourceKind !== 'discussion' || source.contentHash !== evidence.contentHash) {
        staleEvidenceIds.push(evidenceId);
      }
      return;
    }
    if (evidence.sourceKind === 'project-document') {
      try {
        const document = registry.documents.find((item) => item.id === evidence.documentId);
        const material = document
          ? readRegisteredDocumentMaterial(document, evidence.section || null, projectRoot)
          : null;
        if (!material || source.documentId !== evidence.documentId || material.scopedHash !== evidence.contentHash) {
          staleEvidenceIds.push(evidenceId);
        }
      } catch {
        staleEvidenceIds.push(evidenceId);
      }
      return;
    }
    try {
      if (readAnalysisSource(source.path, workspaceRoot).contentHash !== evidence.contentHash) {
        staleEvidenceIds.push(evidenceId);
      }
    } catch {
      staleEvidenceIds.push(evidenceId);
    }
  });
  if (staleEvidenceIds.length) {
    throw new ContractError('提案引用的文件已变化，请让智能体重新检查仓库并提交新提案', 'PROPOSAL_EVIDENCE_STALE', 409, {
      evidenceIds: staleEvidenceIds,
    });
  }
}

function assertProposalEvidenceBasisAllowed(proposal, analysis) {
  if (proposal.view !== 'current') return;
  const evidenceById = new Map(analysis.evidence.map((evidence) => [evidence.id, evidence]));
  const forbidden = [...proposalEvidenceIds(proposal)]
    .map((id) => evidenceById.get(id))
    .filter((evidence) => evidence && evidence.basis !== 'code-fact')
    .map((evidence) => ({ id: evidence.id, basis: evidence.basis }));
  if (forbidden.length) {
    throw new ContractError(
      '该提案把目标意图用作当前实现依据；请让智能体根据代码事实重新提交',
      'PROPOSAL_EVIDENCE_BASIS_FORBIDDEN',
      422,
      { evidence: forbidden },
    );
  }
}

function analysisResponse(analysis) {
  const evidenceBySource = new Map();
  analysis.evidence.forEach((evidence) => {
    evidenceBySource.set(evidence.sourceId, (evidenceBySource.get(evidence.sourceId) || 0) + 1);
  });
  const sources = analysis.sources.map((source) => ({
    ...clone(source),
    evidenceCount: evidenceBySource.get(source.id) || 0,
    status: source.lastScannedAt ? 'ready' : 'stale',
  }));
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const publicEvidence = analysis.evidence.map((evidence) => {
    const source = sourcesById.get(evidence.sourceId);
    return {
      ...clone(evidence),
      sourceLabel: source?.label || null,
      sourceType: source?.type || null,
    };
  });
  const evidenceById = new Map(publicEvidence.map((evidence) => [evidence.id, evidence]));
  const proposals = analysis.proposals.map((proposal) => ({
    ...clone(proposal),
    evidence: [...proposalEvidenceIds(proposal)].map((id) => evidenceById.get(id)).filter(Boolean).map(clone),
    changeCount: proposal.changes.length,
    evidenceCount: proposalEvidenceIds(proposal).size,
  }));
  const proposalsByRun = new Map();
  analysis.proposals.forEach((proposal) => {
    if (!proposal.origin?.runId) return;
    const list = proposalsByRun.get(proposal.origin.runId) || [];
    list.push(proposal);
    proposalsByRun.set(proposal.origin.runId, list);
  });
  const artifactsById = new Map(analysis.artifacts.map((record) => [record.id, record]));
  const runs = analysis.agentRuns.map((run) => {
    const runProposals = proposalsByRun.get(run.id) || [];
    return {
      ...clone(run),
      artifacts: run.artifactIds.map((id) => artifactsById.get(id)).filter(Boolean).map(publicArtifactRecord),
      proposalCount: runProposals.length,
      pendingProposalCount: runProposals.filter((proposal) => proposal.status === 'pending').length,
      draftWriteCount: runProposals.filter((proposal) => proposal.status === 'draft-applied').length,
    };
  });
  return {
    schemaVersion: analysis.schemaVersion,
    baseRevision: analysis.baseRevision,
    lastUpdated: analysis.lastUpdated,
    sources,
    evidence: publicEvidence,
    proposals,
    runs,
    artifacts: analysis.artifacts.map((record) => ({ ...publicArtifactRecord(record), runId: record.runId })),
    integration: {
      mode: 'external-agent',
      protocolVersion: AI_CODING_PROTOCOL_VERSION,
      modelProviderRequired: false,
      implementationHumanReviewRequired: true,
      serverComputedContractGate: true,
      agentCanReview: false,
      agentCanApprove: false,
      agentCanPublish: false,
      mcpCommand: 'npm run mcp',
      cliCommand: 'npm run agent --',
    },
  };
}

function assertAgentRequest(value, allowedKeys, valuePath = 'agent request') {
  if (!isPlainObject(value)) {
    throw new ContractError(`${valuePath} 必须是对象`, 'AGENT_REQUEST_INVALID', 400);
  }
  Object.keys(value).forEach((key) => {
    if (!allowedKeys.has(key)) {
      throw new ContractError(`${valuePath} 不支持字段 ${key}`, 'AGENT_REQUEST_INVALID', 400);
    }
  });
  return value;
}

function requiredAgentText(value, field, maxLength = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new ContractError(`智能体提交字段 ${field} 无效`, 'AGENT_REQUEST_INVALID', 400, { field });
  }
  return value.trim();
}

function agentDiagram(catalog, diagramId) {
  const selectedId = diagramId || catalog.defaultDiagramId;
  const diagram = catalog.diagrams.find((item) => item.id === selectedId);
  if (!diagram) throw new ContractError('未找到智能体运行对应的架构图', 'DIAGRAM_NOT_FOUND', 404, { diagramId: selectedId });
  return diagram;
}

function laneLockDescriptor(lane) {
  return {
    publishedRevision: lane.published.revision,
    publishedRevisionId: lane.published.revisionId,
    draftId: lane.draft?.draftId || null,
    draftRevision: lane.draft?.draftRevision || 0,
  };
}

function sameLaneLock(left, right) {
  return Boolean(left && right) && [
    'publishedRevision', 'publishedRevisionId', 'draftId', 'draftRevision',
  ].every((field) => left[field] === right[field]);
}

function assertAgentRunLaneLock(run, lane) {
  const actual = laneLockDescriptor(lane);
  if (!run.laneLock) {
    throw new ContractError(
      '该旧智能体运行没有视图状态锁，不能安全继续提交；请基于当前正式基线和草案创建新的运行',
      'AGENT_LANE_LOCK_REQUIRED',
      409,
      { actual },
    );
  }
  if (!sameLaneLock(run.laneLock, actual)) {
    throw new ContractError(
      '智能体运行锁定的正式基线或活动草案已经变化，请创建新的运行后重新提交',
      'AGENT_RUN_STALE',
      409,
      {
        headRevision: lane.published.revision,
        headRevisionId: lane.published.revisionId,
        expectedLaneLock: clone(run.laneLock),
        actualLaneLock: actual,
      },
    );
  }
  return lane.draft ? lane.draft.graph : lane.published.graph;
}

function createAgentRun(incoming, catalog, { registry, projectRoot }) {
  assertAgentRequest(incoming, new Set(['agentName', 'agentClient', 'taskType', 'diagramId', 'view', 'summary']));
  const agentName = requiredAgentText(incoming.agentName, 'agentName');
  const agentClient = requiredAgentText(incoming.agentClient, 'agentClient', 80);
  if (!AGENT_TASK_TYPES.has(incoming.taskType)) {
    throw new ContractError('taskType 不是支持的智能体协作任务', 'AGENT_TASK_TYPE_INVALID', 422);
  }
  const diagram = agentDiagram(catalog, incoming.diagramId);
  const defaultView = incoming.taskType === 'architecture-change-plan' ? 'target' : 'current';
  const view = incoming.view || defaultView;
  if (!['current', 'target'].includes(view)) {
    throw new ContractError('智能体运行 view 必须是 current 或 target', 'AGENT_VIEW_INVALID', 422);
  }
  if (incoming.taskType !== 'architecture-change-plan' && view !== 'current') {
    throw new ContractError('项目理解和实施核验只能提交到当前架构视图', 'AGENT_VIEW_INVALID', 422);
  }
  const state = readState(diagram.statePath);
  if (incoming.taskType === 'implementation-reconcile') {
    assertExecutableTargetContract(state.target.published, registry, projectRoot);
  }
  const lane = state[view];
  const now = new Date().toISOString();
  return {
    id: `run-${crypto.randomUUID().toLowerCase()}`,
    agentName,
    agentClient,
    taskType: incoming.taskType,
    status: 'active',
    diagramId: diagram.id,
    view,
    baseRevision: lane.published.revision,
    baseRevisionId: lane.published.revisionId,
    laneLock: laneLockDescriptor(lane),
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    summary: incoming.summary === undefined || incoming.summary === null
      ? null
      : requiredAgentText(incoming.summary, 'summary', 1000),
    artifactIds: [],
    approvedTarget: incoming.taskType === 'implementation-reconcile'
      ? formalTargetDescriptor(diagram.id, state.target.published)
      : null,
    agentClaim: null,
    architectureGate: null,
    contractGate: null,
    humanReview: null,
  };
}

function artifactRecord(artifact, runId, submittedAt) {
  return {
    id: artifact.artifactId,
    runId,
    artifactType: artifact.artifactType,
    submittedAt,
    artifact: clone(artifact),
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function evidenceExcerpt(material, entry) {
  const lines = material.content.replace(/\r\n?/g, '\n').split('\n');
  if (entry.lineEnd > lines.length) {
    throw new ContractError('证据行号超出文件范围', 'AGENT_EVIDENCE_RANGE_INVALID', 422, {
      evidenceId: entry.id,
      path: entry.path,
      lineCount: lines.length,
    });
  }
  const excerpt = lines.slice(entry.lineStart - 1, entry.lineEnd).join('\n').trim();
  if (!excerpt) {
    throw new ContractError('证据范围没有可核验文本', 'AGENT_EVIDENCE_RANGE_INVALID', 422, {
      evidenceId: entry.id,
      path: entry.path,
    });
  }
  return excerpt.length > 12000 ? `${excerpt.slice(0, 11999)}…` : excerpt;
}

function normalizedEvidenceSourceKind(entry) {
  return entry.sourceKind || 'workspace-file';
}

function normalizedEvidenceBasis(entry) {
  if (entry.basis === 'inference') return 'agent-inference';
  if (entry.basis === 'fact') {
    return sourceTypeForPath(entry.path) === 'source-code' ? 'code-fact' : 'design-document';
  }
  return entry.basis;
}

function discussionEvidenceHash(entry) {
  return crypto.createHash('sha256').update(JSON.stringify({
    sourceLabel: entry.sourceLabel,
    recordedAt: entry.recordedAt,
    summary: entry.summary,
    excerpt: entry.excerpt,
  })).digest('hex');
}

function discussionSourceId(entry) {
  const digest = crypto.createHash('sha256')
    .update(`${entry.sourceLabel}:${entry.recordedAt}:${entry.id}`)
    .digest('hex')
    .slice(0, 24);
  return `discussion-${digest}`;
}

function projectDocumentSourceId(documentId) {
  return `project-document-${crypto.createHash('sha256').update(documentId).digest('hex').slice(0, 24)}`;
}

function importAgentEvidence(analysis, manifest, { workspaceRoot, projectRoot, registry }, collectedAt) {
  const next = clone(analysis);
  const sourcesByPath = new Map(next.sources.filter((source) => source.path).map((source) => [source.path.toLowerCase(), source]));
  const sourcesById = new Map(next.sources.map((source) => [source.id, source]));
  const evidenceById = new Map(next.evidence.map((evidence) => [evidence.id, evidence]));

  manifest.entries.forEach((entry) => {
    const sourceKind = normalizedEvidenceSourceKind(entry);
    const basis = normalizedEvidenceBasis(entry);
    if (sourceKind === 'discussion') {
      const contentHash = discussionEvidenceHash(entry);
      const sourceId = discussionSourceId(entry);
      const source = {
        id: sourceId,
        sourceKind,
        path: null,
        label: entry.sourceLabel,
        type: 'discussion',
        selected: false,
        lastScannedAt: entry.recordedAt,
        contentHash,
        sizeBytes: Buffer.byteLength(entry.excerpt, 'utf8'),
      };
      const existingSource = sourcesById.get(sourceId);
      if (existingSource && !sameJson(existingSource, source)) {
        throw new ContractError('讨论来源 ID 已被其他内容使用', 'AGENT_EVIDENCE_ID_CONFLICT', 409, { evidenceId: entry.id });
      }
      if (!existingSource) {
        next.sources.push(source);
        sourcesById.set(sourceId, source);
      }
      const evidence = {
        id: entry.id,
        sourceId,
        sourceKind,
        basis,
        path: null,
        lineStart: null,
        lineEnd: null,
        excerpt: entry.excerpt.trim(),
        contentHash,
        collectedAt,
      };
      addImportedEvidence(next, evidenceById, evidence);
      return;
    }

    if (sourceKind === 'project-document') {
      const document = registry.documents.find((item) => item.id === entry.documentId);
      if (!document) {
        throw new ContractError('智能体引用的注册文档不存在', 'DOCUMENT_NOT_FOUND', 404, { documentId: entry.documentId });
      }
      const material = readRegisteredDocumentMaterial(document, entry.section || null, projectRoot);
      if (material.scopedHash !== entry.contentHash) {
        throw new ContractError('注册文档依据已变化，请按 documentId 重新读取后提交', 'AGENT_EVIDENCE_STALE', 409, {
          evidenceId: entry.id,
          documentId: entry.documentId,
          section: entry.section || null,
        });
      }
      const sourceId = projectDocumentSourceId(document.id);
      const source = {
        id: sourceId,
        sourceKind,
        path: null,
        documentId: document.id,
        label: document.title,
        type: 'markdown',
        selected: false,
        lastScannedAt: collectedAt,
        contentHash: material.fullHash,
        sizeBytes: material.stats.size,
      };
      const existingSource = sourcesById.get(sourceId);
      if (existingSource) Object.assign(existingSource, source);
      else {
        next.sources.push(source);
        sourcesById.set(sourceId, source);
      }
      const evidence = {
        id: entry.id,
        sourceId,
        sourceKind,
        basis,
        path: null,
        documentId: document.id,
        section: entry.section || null,
        lineStart: null,
        lineEnd: null,
        excerpt: material.scopedContent.length > 12000
          ? `${material.scopedContent.slice(0, 11999)}…`
          : material.scopedContent,
        contentHash: material.scopedHash,
        collectedAt,
      };
      addImportedEvidence(next, evidenceById, evidence);
      return;
    }

    const material = readAnalysisSource(entry.path, workspaceRoot);
    if (material.contentHash !== entry.contentHash) {
      throw new ContractError('智能体证据与当前工作区内容不一致，请重新检查仓库后提交', 'AGENT_EVIDENCE_STALE', 409, {
        evidenceId: entry.id,
        path: entry.path,
      });
    }
    const sourceKey = entry.path.toLowerCase();
    const existingSource = sourcesByPath.get(sourceKey);
    const source = {
      id: existingSource?.id || sourceIdForPath(entry.path),
      sourceKind,
      path: entry.path,
      documentId: null,
      label: existingSource?.label || sourceLabelForPath(entry.path),
      type: sourceTypeForPath(entry.path),
      selected: Boolean(existingSource?.selected),
      lastScannedAt: collectedAt,
      contentHash: material.contentHash,
      sizeBytes: material.stats.size,
    };
    if (existingSource) Object.assign(existingSource, source);
    else {
      next.sources.push(source);
      sourcesByPath.set(sourceKey, source);
      sourcesById.set(source.id, source);
    }

    const evidence = {
      id: entry.id,
      sourceId: source.id,
      sourceKind,
      basis,
      path: entry.path,
      documentId: null,
      section: null,
      lineStart: entry.lineStart,
      lineEnd: entry.lineEnd,
      excerpt: evidenceExcerpt(material, entry),
      contentHash: material.contentHash,
      collectedAt,
    };
    addImportedEvidence(next, evidenceById, evidence);
  });
  return next;
}

function addImportedEvidence(analysis, evidenceById, evidence) {
  const existingEvidence = evidenceById.get(evidence.id);
  const sameEvidence = existingEvidence && [
    'id', 'sourceId', 'sourceKind', 'basis', 'path', 'documentId', 'section',
    'lineStart', 'lineEnd', 'excerpt', 'contentHash',
  ].every((field) => existingEvidence[field] === evidence[field]);
  if (existingEvidence && !sameEvidence) {
    throw new ContractError('证据 ID 已被其他内容使用', 'AGENT_EVIDENCE_ID_CONFLICT', 409, { evidenceId: evidence.id });
  }
  if (!existingEvidence) {
    analysis.evidence.push(evidence);
    evidenceById.set(evidence.id, evidence);
  }
}

function changeIdForArtifact(artifactId, kind, targetType, targetId) {
  const digest = crypto.createHash('sha256').update(`${artifactId}:${kind}:${targetType}:${targetId}`).digest('hex').slice(0, 20);
  return `change-${digest}`;
}

function proposalOrigin(run, artifact) {
  return {
    runId: run.id,
    artifactId: artifact.artifactId,
    artifactType: artifact.artifactType,
    agentName: run.agentName,
    agentClient: run.agentClient,
  };
}

function proposalAcceptanceCriteria(artifact) {
  const defaultRefs = [...new Map((artifact.changes || []).map((change) => [
    `${change.targetType}:${change.targetId}`,
    { targetType: change.targetType, targetId: change.targetId },
  ])).values()];
  return (artifact.acceptanceCriteria || []).map((criterion, index) => {
    if (criterion && typeof criterion === 'object' && !Array.isArray(criterion)) return clone(criterion);
    const statement = String(criterion);
    const digest = crypto.createHash('sha256')
      .update(`${artifact.artifactId}:${index}:${statement}`)
      .digest('hex')
      .slice(0, 20);
    return { id: `criterion-${digest}`, statement, targetRefs: clone(defaultRefs) };
  });
}

function normalizeExchangeProposalChange(change) {
  const normalized = clone(change);
  if (
    normalized.targetType === 'node'
    && typeof normalized.patch?.data?.group === 'string'
  ) normalized.patch.data.group = normalized.patch.data.group.trim();
  return normalized;
}

function artifactEvidenceIds(artifact) {
  if (artifact.artifactType === 'architecture-snapshot') {
    return new Set([
      ...artifact.nodes.flatMap((node) => node.evidenceIds),
      ...artifact.edges.flatMap((edge) => edge.evidenceIds),
    ]);
  }
  if (artifact.artifactType === 'architecture-proposal') {
    return new Set([
      ...artifact.changes.flatMap((change) => change.evidenceIds),
      ...(artifact.contractPatch?.upsert || []).flatMap((criterion) => criterion.evidenceIds),
      ...(artifact.contractPatch?.delete || []).flatMap((operation) => operation.evidenceIds),
    ]);
  }
  if (artifact.artifactType === 'implementation-report') {
    return new Set([
      ...artifact.acceptanceResults.flatMap((result) => result.evidenceIds),
      ...artifact.drift.flatMap((item) => item.evidenceIds),
    ]);
  }
  return new Set();
}

function assertRunArtifactType(run, artifact) {
  const allowedTypes = TASK_ARTIFACT_TYPES[run.taskType];
  if (!allowedTypes?.has(artifact.artifactType)) {
    throw new ContractError(
      `任务 ${run.taskType} 不接受 ${artifact.artifactType} 工件`,
      'AGENT_ARTIFACT_TYPE_MISMATCH',
      422,
      { taskType: run.taskType, artifactType: artifact.artifactType, allowedTypes: [...(allowedTypes || [])] },
    );
  }
}

function assertManifestCoversArtifact(artifact, manifest) {
  const manifestIds = new Set(manifest.entries.map((entry) => entry.id));
  const missingEvidenceIds = [...artifactEvidenceIds(artifact)].filter((id) => !manifestIds.has(id));
  if (missingEvidenceIds.length) {
    throw new ContractError(
      '当前提交的证据清单未覆盖工件引用的全部证据',
      'AGENT_EVIDENCE_MANIFEST_INCOMPLETE',
      422,
      { evidenceIds: missingEvidenceIds },
    );
  }
}

function assertEvidenceBasisAllowed(run, artifact, manifest) {
  if (run.view !== 'current') return;
  const referencedIds = artifactEvidenceIds(artifact);
  const forbidden = manifest.entries
    .filter((entry) => referencedIds.has(entry.id) && normalizedEvidenceBasis(entry) !== 'code-fact')
    .map((entry) => ({ id: entry.id, basis: normalizedEvidenceBasis(entry) }));
  if (forbidden.length) {
    throw new ContractError(
      '当前架构与实施结果只能引用代码事实；用户讨论和设计材料只能支持目标架构',
      'AGENT_EVIDENCE_BASIS_FORBIDDEN',
      422,
      { evidence: forbidden },
    );
  }
}

function assertEvidenceBasisIntegrity(manifest) {
  const mislabeled = manifest.entries.filter((entry) => (
    normalizedEvidenceSourceKind(entry) === 'workspace-file'
    && normalizedEvidenceBasis(entry) === 'code-fact'
    && sourceTypeForPath(entry.path) === 'markdown'
  ));
  if (mislabeled.length) {
    throw new ContractError(
      'Markdown 设计材料不能标记为代码事实',
      'AGENT_EVIDENCE_BASIS_INVALID',
      422,
      { evidenceIds: mislabeled.map((entry) => entry.id) },
    );
  }
}

function proposalFromExchangeArtifact(artifact, run) {
  const evidenceIds = [...artifactEvidenceIds(artifact)];
  return {
    id: artifact.artifactId,
    status: 'pending',
    view: run.view,
    diagramId: run.diagramId,
    baseRevision: run.baseRevision,
    baseRevisionId: run.baseRevisionId,
    laneLock: clone(run.laneLock),
    title: artifact.title,
    summary: artifact.summary,
    requestId: artifact.requestId,
    acceptanceCriteria: proposalAcceptanceCriteria(artifact),
    contractPatch: clone(artifact.contractPatch || null),
    confidence: null,
    createdAt: artifact.createdAt,
    reviewedAt: null,
    evidenceIds,
    changes: artifact.changes.map(normalizeExchangeProposalChange),
    application: null,
    origin: proposalOrigin(run, artifact),
  };
}

function snapshotProposal(artifact, run, graph) {
  const changes = [];
  const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const graphEdges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const semanticFields = [
    'name', 'purpose', 'technical', 'product', 'authorization',
    'documentRefs', 'interactionModes', 'architectureLayer',
  ];

  artifact.nodes.forEach((node) => {
    const existing = graphNodes.get(node.id);
    const data = Object.fromEntries(semanticFields
      .filter((field) => node[field] !== undefined)
      .map((field) => [field, clone(node[field])]));
    if (!existing) {
      changes.push({
        id: changeIdForArtifact(artifact.artifactId, 'add', 'node', node.id),
        kind: 'add',
        targetType: 'node',
        targetId: node.id,
        summary: `智能体识别到新的架构职责：${node.name}`,
        evidenceIds: clone(node.evidenceIds),
        patch: { data },
      });
      return;
    }
    const patchData = {};
    semanticFields.forEach((field) => {
      if (node[field] !== undefined && !sameJson(existing.data?.[field], node[field])) patchData[field] = clone(node[field]);
    });
    if (Object.keys(patchData).length) {
      changes.push({
        id: changeIdForArtifact(artifact.artifactId, 'update', 'node', node.id),
        kind: 'update',
        targetType: 'node',
        targetId: node.id,
        summary: `根据仓库证据更新架构职责：${node.name}`,
        evidenceIds: clone(node.evidenceIds),
        patch: { data: patchData },
      });
    }
  });

  artifact.edges.forEach((edge) => {
    const existing = graphEdges.get(edge.id);
    if (!existing) {
      changes.push({
        id: changeIdForArtifact(artifact.artifactId, 'add', 'edge', edge.id),
        kind: 'add',
        targetType: 'edge',
        targetId: edge.id,
        summary: `智能体识别到新的架构关系：${edge.label}`,
        evidenceIds: clone(edge.evidenceIds),
        patch: {
          source: edge.source,
          target: edge.target,
          data: {
            label: edge.label,
            relationType: edge.relationType,
            ...(edge.controlledBoundaryPosture === undefined
              ? {}
              : { controlledBoundaryPosture: edge.controlledBoundaryPosture }),
          },
        },
      });
      return;
    }
    if (existing.source !== edge.source || existing.target !== edge.target) {
      throw new ContractError('快照试图用同一关系 ID 改变连接端点，请使用新的稳定 ID', 'AGENT_EDGE_ID_CONFLICT', 422, {
        edgeId: edge.id,
      });
    }
    const patchData = {};
    if (existing.data?.label !== edge.label) patchData.label = edge.label;
    if (existing.data?.relationType !== edge.relationType) patchData.relationType = edge.relationType;
    if (
      edge.controlledBoundaryPosture !== undefined
      && existing.data?.controlledBoundaryPosture !== edge.controlledBoundaryPosture
    ) {
      patchData.controlledBoundaryPosture = edge.controlledBoundaryPosture;
    }
    if (Object.keys(patchData).length) {
      changes.push({
        id: changeIdForArtifact(artifact.artifactId, 'update', 'edge', edge.id),
        kind: 'update',
        targetType: 'edge',
        targetId: edge.id,
        summary: `根据仓库证据更新架构关系：${edge.label}`,
        evidenceIds: clone(edge.evidenceIds),
        patch: { data: patchData },
      });
    }
  });

  if (!changes.length) return null;
  const evidenceIds = [...new Set(changes.flatMap((change) => change.evidenceIds))];
  const notes = [
    artifact.assumptions.length ? `假设 ${artifact.assumptions.length} 项` : null,
    artifact.unknowns.length ? `未知项 ${artifact.unknowns.length} 项` : null,
  ].filter(Boolean).join('，');
  return {
    id: artifact.artifactId,
    status: 'pending',
    view: run.view,
    diagramId: run.diagramId,
    baseRevision: run.baseRevision,
    baseRevisionId: run.baseRevisionId,
    laneLock: clone(run.laneLock),
    title: `审阅 ${run.agentName} 对当前架构的理解`,
    summary: `智能体基于仓库证据提交了 ${changes.length} 项架构差异${notes ? `；${notes}` : ''}。未在快照中出现的现有节点不会被自动移除。`,
    requestId: null,
    acceptanceCriteria: [],
    confidence: null,
    createdAt: artifact.createdAt,
    reviewedAt: null,
    evidenceIds,
    changes,
    application: null,
    origin: proposalOrigin(run, artifact),
  };
}

function reconciliationId(kind, targetType, targetId) {
  const digest = crypto.createHash('sha256')
    .update(`${kind}:${targetType}:${targetId}`)
    .digest('hex')
    .slice(0, 20);
  return `drift-${digest}`;
}

function unsupportedDriftId(item, index) {
  const digest = crypto.createHash('sha256')
    .update(`${index}:${item.kind}:${item.targetId}:${item.summary}`)
    .digest('hex')
    .slice(0, 20);
  return `unsupported-${digest}`;
}

function targetNodeElement(node) {
  return {
    id: node.id,
    targetType: 'node',
    name: node.data.name,
    purpose: node.data.purpose,
    technical: node.data.technical,
    product: node.data.product,
    authorization: node.data.authorization,
    ...(node.data.documentRefs === undefined ? {} : { documentRefs: clone(node.data.documentRefs) }),
    ...(node.data.interactionModes === undefined ? {} : { interactionModes: clone(node.data.interactionModes) }),
    ...(node.data.architectureLayer === undefined ? {} : { architectureLayer: node.data.architectureLayer }),
    evidenceIds: [],
  };
}

function targetEdgeElement(edge) {
  return {
    id: edge.id,
    targetType: 'edge',
    source: edge.source,
    target: edge.target,
    label: edge.data.label,
    relationType: edge.data.relationType,
    controlledBoundaryPosture: edge.data.controlledBoundaryPosture,
    evidenceIds: [],
  };
}

function actualNodeElement(node) {
  return {
    id: node.id,
    targetType: 'node',
    name: node.name,
    purpose: node.purpose,
    technical: node.technical,
    product: node.product,
    authorization: node.authorization,
    ...(node.documentRefs === undefined ? {} : { documentRefs: clone(node.documentRefs) }),
    ...(node.interactionModes === undefined ? {} : { interactionModes: clone(node.interactionModes) }),
    ...(node.architectureLayer === undefined ? {} : { architectureLayer: node.architectureLayer }),
    evidenceIds: clone(node.evidenceIds),
  };
}

function actualEdgeElement(edge) {
  return {
    id: edge.id,
    targetType: 'edge',
    source: edge.source,
    target: edge.target,
    label: edge.label,
    relationType: edge.relationType,
    controlledBoundaryPosture: edge.controlledBoundaryPosture,
    evidenceIds: clone(edge.evidenceIds),
  };
}

function reconciliationElementKey(targetType, targetId) {
  return `${targetType}:${targetId}`;
}

function hasSufficientCodeEvidence(analysis, element) {
  if (!element?.evidenceIds?.length) return false;
  const evidenceById = new Map(analysis.evidence.map((evidence) => [evidence.id, evidence]));
  return element.evidenceIds.every((id) => {
    const evidence = evidenceById.get(id);
    return Boolean(
      evidence
      && evidence.sourceKind === 'workspace-file'
      && evidence.basis === 'code-fact'
      && evidence.path
      && evidence.excerpt
      && evidence.contentHash
    );
  });
}

function serverDriftItem({ kind, targetType, targetId, summary, changedFields = [], target, actual, source = 'server-computed' }) {
  return {
    id: reconciliationId(kind, targetType, targetId),
    kind,
    source,
    targetType,
    targetId,
    summary,
    changedFields,
    target: target ? clone(target) : null,
    actual: actual ? clone(actual) : null,
    evidenceIds: clone(actual?.evidenceIds || []),
    explanation: {
      status: 'unexplained',
      summary: null,
      evidenceIds: [],
    },
  };
}

function buildImplementationReconciliation({ run, targetRevision, snapshot, report, analysis, computedAt }) {
  const targetElements = new Map();
  targetRevision.graph.nodes.forEach((node) => {
    const element = targetNodeElement(node);
    targetElements.set(reconciliationElementKey('node', element.id), element);
  });
  targetRevision.graph.edges.forEach((edge) => {
    const element = targetEdgeElement(edge);
    targetElements.set(reconciliationElementKey('edge', element.id), element);
  });

  const actualElements = new Map();
  snapshot.nodes.forEach((node) => {
    const element = actualNodeElement(node);
    actualElements.set(reconciliationElementKey('node', element.id), element);
  });
  snapshot.edges.forEach((edge) => {
    const element = actualEdgeElement(edge);
    actualElements.set(reconciliationElementKey('edge', element.id), element);
  });

  const drift = [];
  targetElements.forEach((target, key) => {
    const actual = actualElements.get(key);
    if (!actual) {
      drift.push(serverDriftItem({
        kind: 'missing',
        targetType: target.targetType,
        targetId: target.id,
        summary: `实施后快照缺少正式目标中的${target.targetType === 'node' ? '模块' : '关系'} ${target.id}`,
        target,
        actual: null,
      }));
      return;
    }
    const fields = target.targetType === 'node' ? RECONCILIATION_NODE_FIELDS : RECONCILIATION_EDGE_FIELDS;
    const changedFields = fields.filter((field) => !sameJson(target[field], actual[field]));
    if (changedFields.length) {
      drift.push(serverDriftItem({
        kind: 'changed',
        targetType: target.targetType,
        targetId: target.id,
        summary: `${target.targetType === 'node' ? '模块职责或权限边界' : '关系或受控边界'}与正式目标不同：${changedFields.join('、')}`,
        changedFields,
        target,
        actual,
      }));
    }
  });
  actualElements.forEach((actual, key) => {
    if (!targetElements.has(key)) {
      drift.push(serverDriftItem({
        kind: 'extra',
        targetType: actual.targetType,
        targetId: actual.id,
        summary: `实施后快照包含正式目标之外的${actual.targetType === 'node' ? '模块' : '关系'} ${actual.id}`,
        target: null,
        actual,
      }));
    }
    if (!hasSufficientCodeEvidence(analysis, actual)) {
      drift.push(serverDriftItem({
        kind: 'unverified',
        source: 'evidence-check',
        targetType: actual.targetType,
        targetId: actual.id,
        summary: `实施后快照中的 ${actual.id} 缺少可核验的 code-fact 证据`,
        target: targetElements.get(key) || null,
        actual,
      }));
    }
  });

  const explanations = new Map();
  const unsupported = [];
  report.drift.forEach((reported, index) => {
    if (reported.kind === 'unverified') {
      const elementCandidates = [...new Set([
        ...[...targetElements.values()].filter((item) => item.id === reported.targetId).map((item) => reconciliationElementKey(item.targetType, item.id)),
        ...[...actualElements.values()].filter((item) => item.id === reported.targetId).map((item) => reconciliationElementKey(item.targetType, item.id)),
      ])];
      if (elementCandidates.length === 1) {
        const [key] = elementCandidates;
        const target = targetElements.get(key) || null;
        const actual = actualElements.get(key) || null;
        const targetType = (target || actual).targetType;
        let item = drift.find((candidate) => (
          candidate.kind === 'unverified'
          && candidate.targetType === targetType
          && candidate.targetId === reported.targetId
        ));
        if (!item) {
          item = serverDriftItem({
            kind: 'unverified',
            source: 'agent-declared',
            targetType,
            targetId: reported.targetId,
            summary: `智能体声明 ${reported.targetId} 尚不能由当前证据充分核验`,
            target,
            actual,
          });
          drift.push(item);
        }
        if (!explanations.has(item.id)) {
          explanations.set(item.id, reported);
          return;
        }
      }
    } else {
      const candidates = drift.filter((item) => (
        item.kind === reported.kind
        && item.targetId === reported.targetId
        && !explanations.has(item.id)
      ));
      if (candidates.length === 1) {
        explanations.set(candidates[0].id, reported);
        return;
      }
    }
    unsupported.push({
      id: unsupportedDriftId(reported, index),
      kind: reported.kind,
      targetId: reported.targetId,
      summary: reported.summary,
    });
  });

  const detailedDrift = drift
    .map((item) => {
      const explanation = explanations.get(item.id);
      const explanationEvidenceIds = explanation ? clone(explanation.evidenceIds) : [];
      return {
        ...item,
        evidenceIds: [...new Set([...item.evidenceIds, ...explanationEvidenceIds])],
        explanation: explanation
          ? {
            status: 'agent-provided',
            summary: explanation.summary,
            evidenceIds: explanationEvidenceIds,
          }
          : item.explanation,
      };
    })
    .sort((left, right) => (
      ['missing', 'extra', 'changed', 'unverified'].indexOf(left.kind)
      - ['missing', 'extra', 'changed', 'unverified'].indexOf(right.kind)
      || left.targetType.localeCompare(right.targetType)
      || left.targetId.localeCompare(right.targetId)
    ));
  const unreported = detailedDrift
    .filter((item) => item.explanation.status === 'unexplained')
    .map((item) => item.id);
  const counts = {
    missing: detailedDrift.filter((item) => item.kind === 'missing').length,
    extra: detailedDrift.filter((item) => item.kind === 'extra').length,
    changed: detailedDrift.filter((item) => item.kind === 'changed').length,
    unverified: detailedDrift.filter((item) => item.kind === 'unverified').length,
    unexplained: detailedDrift.filter((item) => item.explanation.status === 'unexplained').length,
    unreported: unreported.length,
    unsupported: unsupported.length,
  };
  const crossCheck = {
    matches: !unreported.length && !unsupported.length,
    unreported,
    unsupported,
  };
  const unresolved = Boolean(counts.unverified || counts.unexplained || counts.unsupported);
  const status = !detailedDrift.length && !unsupported.length
    ? 'aligned'
    : unresolved
      ? 'unresolved-drift'
      : 'explained-drift';
  return {
    status,
    target: clone(run.approvedTarget),
    snapshotArtifactId: snapshot.artifactId,
    reportArtifactId: report.artifactId,
    computedAt,
    counts,
    drift: detailedDrift,
    crossCheck,
    readyForHumanReview: status !== 'unresolved-drift',
  };
}

function assertImplementationTarget(run, state, artifact, { registry, projectRoot }) {
  if (run.taskType !== 'implementation-reconcile') return;
  if (!run.approvedTarget) {
    if (FORMAL_CONTRACT_PROTOCOL_VERSIONS.has(artifact.schemaVersion)) {
      throw new ContractError(
        '旧实施运行没有正式目标锁，请创建新的 implementation-reconcile 运行',
        'AGENT_APPROVED_TARGET_LOCK_REQUIRED',
        409,
      );
    }
    return;
  }
  if (!FORMAL_CONTRACT_PROTOCOL_VERSIONS.has(artifact.schemaVersion)) {
    throw new ContractError(
      `新实施运行必须使用协议 ${AI_CODING_PROTOCOL_VERSION}，旧协议不能绕过正式目标核验`,
      'AGENT_PROTOCOL_UPGRADE_REQUIRED',
      422,
      { requiredVersion: AI_CODING_PROTOCOL_VERSION },
    );
  }
  assertExecutableTargetContract(state.target.published, registry, projectRoot);
  const actualTarget = formalTargetDescriptor(run.diagramId, state.target.published);
  if (!sameFormalTarget(run.approvedTarget, actualTarget)) {
    throw new ContractError(
      '运行锁定的正式目标已经变化，请基于新目标创建新的实施运行',
      'AGENT_APPROVED_TARGET_STALE',
      409,
      { expected: clone(run.approvedTarget), actual: actualTarget },
    );
  }
}

function implementationArtifactRecords(analysis, run) {
  return analysis.artifacts.filter((record) => record.runId === run.id);
}

function assertImplementationAcceptanceResults(report, contract) {
  if (report.artifactType !== 'implementation-report') return;
  const expected = new Set(contract.acceptanceCriteria.map((criterion) => criterion.id));
  const submitted = new Set(report.acceptanceResults.map((result) => result.criterionId));
  const missing = [...expected].filter((id) => !submitted.has(id));
  const extra = [...submitted].filter((id) => !expected.has(id));
  if (missing.length || extra.length || submitted.size !== report.acceptanceResults.length) {
    throw new ContractError(
      '实施报告必须逐项引用正式开发合同的验收条件，不能漏报、增报或改写',
      'AGENT_ACCEPTANCE_CONTRACT_MISMATCH',
      422,
      { missingCriterionIds: missing, extraCriterionIds: extra },
    );
  }
}

function buildImplementationContractGate({ run, contract, report, computedAt }) {
  const resultsById = new Map(report.acceptanceResults.map((result) => [result.criterionId, result]));
  const criteria = contract.acceptanceCriteria.map((criterion) => {
    const result = resultsById.get(criterion.id);
    return {
      criterionId: criterion.id,
      statement: criterion.statement,
      targetRefs: clone(criterion.targetRefs),
      status: result?.status || 'unverified',
      evidenceIds: clone(result?.evidenceIds || []),
    };
  });
  const counts = {
    satisfied: criteria.filter((criterion) => criterion.status === 'satisfied').length,
    unsatisfied: criteria.filter((criterion) => criterion.status === 'unsatisfied').length,
    unverified: criteria.filter((criterion) => criterion.status === 'unverified').length,
  };
  const status = counts.unsatisfied || counts.unverified
    ? 'criteria-unmet'
    : report.status === 'complete'
      ? 'satisfied'
      : 'claim-incomplete';
  return {
    status,
    contractId: run.approvedTarget.contractId,
    contractHash: run.approvedTarget.contractHash,
    reportArtifactId: report.artifactId,
    computedAt,
    agentClaimStatus: report.status,
    counts,
    criteria,
    readyForAcceptance: status === 'satisfied',
  };
}

function assertImplementationSequence(analysis, run, artifact) {
  if (run.taskType !== 'implementation-reconcile' || !run.approvedTarget) return null;
  const records = implementationArtifactRecords(analysis, run);
  const snapshots = records.filter((record) => record.artifactType === 'architecture-snapshot');
  const reports = records.filter((record) => record.artifactType === 'implementation-report');
  if (artifact.artifactType === 'architecture-snapshot') {
    if (reports.length) {
      throw new ContractError('实施报告已经提交，不能再替换实施后快照；请创建新的运行', 'AGENT_IMPLEMENTATION_RUN_FINALIZED', 409);
    }
    if (snapshots.some((record) => record.id !== artifact.artifactId)) {
      throw new ContractError('一个实施运行只能绑定一个实施后快照', 'AGENT_RESULTING_SNAPSHOT_CONFLICT', 409);
    }
    return null;
  }
  if (artifact.artifactType !== 'implementation-report') return null;
  if (!snapshots.length) {
    throw new ContractError(
      '请先提交由 code-fact 支持的实施后架构快照，再提交实施报告',
      'AGENT_RESULTING_SNAPSHOT_REQUIRED',
      422,
    );
  }
  if (snapshots.length !== 1 || snapshots[0].id !== artifact.resultingSnapshotArtifactId) {
    throw new ContractError(
      '实施报告引用的快照工件与该运行已提交的快照不一致',
      'AGENT_RESULTING_SNAPSHOT_MISMATCH',
      422,
      { submittedSnapshotIds: snapshots.map((record) => record.id) },
    );
  }
  if (!sameFormalTarget(run.approvedTarget, artifact.approvedTarget)) {
    throw new ContractError(
      '实施报告引用的正式目标与运行锁定目标不一致',
      'AGENT_APPROVED_TARGET_MISMATCH',
      422,
      { expected: clone(run.approvedTarget), submitted: clone(artifact.approvedTarget) },
    );
  }
  if (!sameJson(snapshots[0].artifact.project.revision, artifact.resultingRevision)) {
    throw new ContractError(
      '实施报告的结果版本与实施后快照版本不一致',
      'AGENT_RESULTING_REVISION_MISMATCH',
      422,
    );
  }
  if (reports.some((record) => record.id !== artifact.artifactId)) {
    throw new ContractError('一个实施运行只能绑定一份实施报告', 'AGENT_IMPLEMENTATION_REPORT_CONFLICT', 409);
  }
  return snapshots[0].artifact;
}

function addArtifactRecord(next, run, artifact, submittedAt) {
  const existing = next.artifacts.find((record) => record.id === artifact.artifactId);
  if (existing) {
    if (existing.runId !== run.id || !sameJson(existing.artifact, artifact)) {
      throw new ContractError('工件 ID 已被其他提交使用', 'AGENT_ARTIFACT_ID_CONFLICT', 409, { artifactId: artifact.artifactId });
    }
    return false;
  }
  next.artifacts.push(artifactRecord(artifact, run.id, submittedAt));
  return true;
}

function proposalCanOverrideProtectedTarget(proposal, analysis, state, beforeGraph, afterGraph) {
  if (proposal.view !== 'target') return false;
  const protectedChanges = protectedSemanticChanges(state.meta, proposal.view, beforeGraph, afterGraph);
  if (!protectedChanges.length) return false;
  const evidenceById = new Map(analysis.evidence.map((evidence) => [evidence.id, evidence]));
  return protectedChanges.every(({ nodeId }) => proposal.changes
    .filter((change) => change.targetType === 'node' && change.targetId === nodeId)
    .some((change) => change.evidenceIds.some((id) => evidenceById.get(id)?.basis === 'user-confirmed')));
}

function assertAgentRelatedArchitectureReferences(proposal, graph, catalog) {
  const changedNodeIds = new Set(proposal.changes
    .filter((change) => (
      change.targetType === 'node'
      && change.kind !== 'remove'
      && (
        Object.prototype.hasOwnProperty.call(change.patch?.data || {}, 'relatedDiagramId')
        || Object.prototype.hasOwnProperty.call(change.patch?.data || {}, 'relatedNodeId')
      )
    ))
    .map((change) => change.targetId));
  if (!changedNodeIds.size) return;
  const catalogById = new Map(catalog.diagrams.map((diagram) => [diagram.id, diagram]));
  const graphByDiagramId = new Map([[proposal.diagramId, graph]]);
  for (const nodeId of changedNodeIds) {
    const node = graph.nodes.find((entry) => entry.id === nodeId);
    const relatedDiagramId = node?.data?.relatedDiagramId;
    const relatedNodeId = node?.data?.relatedNodeId;
    if (!relatedDiagramId) continue;
    const relatedDiagram = catalogById.get(relatedDiagramId);
    if (!relatedDiagram) {
      throw new ContractError(
        '智能体补丁引用了项目目录中不存在的下钻架构图',
        'AGENT_RELATED_DIAGRAM_NOT_FOUND',
        422,
        { targetId: nodeId, relatedDiagramId },
      );
    }
    if (!relatedNodeId) continue;
    if (!graphByDiagramId.has(relatedDiagramId)) {
      const relatedLane = readState(relatedDiagram.statePath)[proposal.view];
      graphByDiagramId.set(relatedDiagramId, relatedLane.draft?.graph || relatedLane.published.graph);
    }
    const relatedGraph = graphByDiagramId.get(relatedDiagramId);
    if (!relatedGraph.nodes.some((entry) => entry.id === relatedNodeId)) {
      throw new ContractError(
        '智能体补丁引用的下钻目标节点在对应架构图视图中不存在',
        'AGENT_RELATED_NODE_NOT_FOUND',
        422,
        { targetId: nodeId, relatedDiagramId, relatedNodeId, view: proposal.view },
      );
    }
  }
}

function applyAgentProposalToDraft(proposal, analysis, state, {
  workspaceRoot, projectRoot, registry, catalog, now,
}) {
  const lane = state[proposal.view];
  const actualLaneLock = laneLockDescriptor(lane);
  if (!proposal.laneLock || !sameLaneLock(proposal.laneLock, actualLaneLock)) {
    throw new ContractError(
      '智能体写入锁定的正式基线或活动草稿已经变化，请创建新运行并重新提交',
      'AGENT_RUN_STALE',
      409,
      { expectedLaneLock: clone(proposal.laneLock || null), actualLaneLock },
    );
  }
  if (proposal.view === 'current' && proposal.contractPatch) {
    throw new ContractError(
      '当前架构草稿不能携带目标开发合同条件；请在目标架构运行中提交合同补丁',
      'AGENT_CURRENT_CONTRACT_PATCH_FORBIDDEN',
      422,
    );
  }
  assertProposalEvidenceBasisAllowed(proposal, analysis);
  assertProposalEvidenceCurrent(proposal, analysis, { workspaceRoot, projectRoot, registry });
  const priorDraft = lane.draft;
  const priorContract = proposal.view === 'target' ? editableDraftContractBase(lane) : null;
  const priorGraph = priorDraft ? priorDraft.graph : lane.published.graph;
  const graph = applyProposalChanges(priorGraph, proposal, state);
  assertAgentRelatedArchitectureReferences(proposal, graph, catalog);
  assertHumanConfirmedSemantics(state.meta, proposal.view, priorGraph, graph, {
    userConfirmedSemanticOverride: proposalCanOverrideProtectedTarget(
      proposal,
      analysis,
      state,
      priorGraph,
      graph,
    ),
  });
  validateNewDocumentBindings(priorGraph, graph, registry, projectRoot);
  const draftId = priorDraft?.draftId || newDraftId(proposal.view);
  const draftRevision = priorDraft ? priorDraft.draftRevision + 1 : 1;
  const developmentContract = proposal.view === 'target'
    ? draftDevelopmentContract(graph, {
      draftId,
      proposal,
      prior: priorContract,
      registry,
      projectRoot,
    })
    : null;
  const graphChanged = agentSemanticHash({ graph }) !== agentSemanticHash({ graph: priorGraph });
  const criteriaChanged = proposal.view === 'target'
    && !sameJson(
      developmentContract?.acceptanceCriteria || [],
      priorContract?.acceptanceCriteria || [],
    );
  if (!graphChanged && !criteriaChanged) {
    throw new ContractError(
      '该语义补丁与当前锁定草稿完全相同，没有产生可发布变化',
      'AGENT_PATCH_NO_EFFECT',
      422,
      { diagramId: proposal.diagramId, view: proposal.view },
    );
  }

  const candidateDraft = {
    draftId,
    draftRevision,
    baseRevision: lane.published.revision,
    baseRevisionId: lane.published.revisionId,
    savedAt: now,
    graph,
    developmentContract,
  };
  const revertedToPublished = Boolean(priorDraft) && draftEquivalentToPublished(candidateDraft, lane.published, proposal.view);
  lane.draft = revertedToPublished ? null : candidateDraft;
  proposal.status = 'draft-applied';
  proposal.reviewedAt = null;
  proposal.application = {
    draftId,
    draftRevision,
    appliedAt: now,
    outcome: revertedToPublished ? 'reverted-to-published' : 'draft-updated',
  };
  return clone(proposal.application);
}

function submitAgentArtifact(analysis, runId, incoming, {
  workspaceRoot, projectRoot, registry, catalog, diagram,
}) {
  assertAgentRequest(incoming, new Set(['artifact', 'evidenceManifest']));
  const artifact = validateExchangeArtifact(incoming.artifact);
  const requiresEvidence = ['architecture-snapshot', 'architecture-proposal', 'implementation-report'].includes(artifact.artifactType);
  const manifest = incoming.evidenceManifest === undefined
    ? null
    : validateExchangeArtifact(incoming.evidenceManifest);
  if (manifest && manifest.artifactType !== 'evidence-manifest') {
    throw new ContractError('evidenceManifest 必须是证据清单工件', 'AGENT_EVIDENCE_MANIFEST_INVALID', 422);
  }
  if (requiresEvidence && !manifest) {
    throw new ContractError('该工件必须与证据清单一起提交', 'AGENT_EVIDENCE_MANIFEST_REQUIRED', 422);
  }

  let next = clone(analysis);
  const run = next.agentRuns.find((item) => item.id === runId);
  if (!run) throw new ContractError('未找到该智能体运行', 'AGENT_RUN_NOT_FOUND', 404);
  assertRunArtifactType(run, artifact);
  const existingArtifact = analysis.artifacts.find((record) => record.id === artifact.artifactId);
  if (existingArtifact) {
    if (existingArtifact.runId !== run.id || !sameJson(existingArtifact.artifact, artifact)) {
      throw new ContractError('工件 ID 已被其他提交使用', 'AGENT_ARTIFACT_ID_CONFLICT', 409, { artifactId: artifact.artifactId });
    }
    if (manifest) {
      const existingManifest = analysis.artifacts.find((record) => record.id === manifest.artifactId);
      if (!existingManifest || existingManifest.runId !== run.id || !sameJson(existingManifest.artifact, manifest)) {
        throw new ContractError('证据清单 ID 已被其他提交使用', 'AGENT_ARTIFACT_ID_CONFLICT', 409, { artifactId: manifest.artifactId });
      }
    }
    const replayState = readState(diagram.statePath);
    return {
      analysis,
      artifact,
      proposal: analysis.proposals.find((item) => item.origin?.artifactId === artifact.artifactId) || null,
      state: replayState,
      originalState: clone(replayState),
      stateChanged: false,
      draftApplication: analysis.proposals.find((item) => item.origin?.artifactId === artifact.artifactId)?.application || null,
      replayed: true,
    };
  }
  if (run.status === 'reviewed') {
    throw new ContractError('该运行已经完成审阅，请创建新的运行提交后续结果', 'AGENT_RUN_ALREADY_REVIEWED', 409);
  }
  assertManifestCoversArtifact(artifact, manifest);
  assertEvidenceBasisIntegrity(manifest);
  assertEvidenceBasisAllowed(run, artifact, manifest);
  const state = readState(diagram.statePath);
  const originalState = clone(state);
  const lane = state[run.view];
  const baselineGraph = assertAgentRunLaneLock(run, lane);
  assertImplementationTarget(run, state, artifact, { registry, projectRoot });
  if (run.taskType === 'implementation-reconcile' && run.approvedTarget) {
    assertImplementationAcceptanceResults(artifact, state.target.published.developmentContract);
  }
  const resultingSnapshot = assertImplementationSequence(analysis, run, artifact);

  const submittedAt = new Date().toISOString();
  if (manifest) next = importAgentEvidence(next, manifest, { workspaceRoot, projectRoot, registry }, submittedAt);
  if (manifest) addArtifactRecord(next, run, manifest, submittedAt);
  addArtifactRecord(next, run, artifact, submittedAt);

  const targetRun = next.agentRuns.find((item) => item.id === run.id);
  for (const id of [manifest?.artifactId, artifact.artifactId].filter(Boolean)) {
    if (!targetRun.artifactIds.includes(id)) targetRun.artifactIds.push(id);
  }
  targetRun.status = 'submitted';
  targetRun.updatedAt = submittedAt;
  targetRun.submittedAt ||= submittedAt;

  let proposal = null;
  let draftApplication = null;
  let stateChanged = false;
  if (artifact.artifactType === 'architecture-proposal') {
    proposal = proposalFromExchangeArtifact(artifact, targetRun);
  } else if (
    artifact.artifactType === 'architecture-snapshot'
    && targetRun.taskType !== 'implementation-reconcile'
  ) {
    proposal = snapshotProposal(artifact, targetRun, baselineGraph);
  }
  if (proposal) {
    const existingProposal = next.proposals.find((item) => item.id === proposal.id);
    if (existingProposal && !sameJson(existingProposal.origin, proposal.origin)) {
      throw new ContractError('提案 ID 已被其他提交使用', 'AGENT_PROPOSAL_ID_CONFLICT', 409, { proposalId: proposal.id });
    }
    if (!existingProposal) {
      draftApplication = applyAgentProposalToDraft(proposal, next, state, {
        workspaceRoot,
        projectRoot,
        registry,
        catalog,
        now: submittedAt,
      });
      next.proposals.push(proposal);
      stateChanged = true;
    } else {
      proposal = existingProposal;
    }
  }
  if (
    targetRun.taskType === 'implementation-reconcile'
    && targetRun.approvedTarget
    && artifact.artifactType === 'implementation-report'
  ) {
    const architectureGate = buildImplementationReconciliation({
      run: targetRun,
      targetRevision: state.target.published,
      snapshot: resultingSnapshot,
      report: artifact,
      analysis: next,
      computedAt: submittedAt,
    });
    const contractGate = buildImplementationContractGate({
      run: targetRun,
      contract: state.target.published.developmentContract,
      report: artifact,
      computedAt: submittedAt,
    });
    targetRun.agentClaim = {
      status: artifact.status,
      reportArtifactId: artifact.artifactId,
      claimedAt: submittedAt,
    };
    targetRun.architectureGate = architectureGate;
    targetRun.contractGate = contractGate;
    targetRun.humanReview = null;
  }
  validateAnalysis(next);
  return {
    analysis: next,
    artifact,
    proposal,
    state,
    originalState,
    stateChanged,
    draftApplication,
    replayed: false,
  };
}

function architectureGateSummary(gate) {
  if (!gate) return null;
  return {
    status: gate.status,
    targetRevisionId: gate.target.revisionId,
    snapshotArtifactId: gate.snapshotArtifactId,
    reportArtifactId: gate.reportArtifactId,
    computedAt: gate.computedAt,
    counts: clone(gate.counts),
    crossCheckMatches: gate.crossCheck.matches,
    readyForHumanReview: gate.readyForHumanReview,
    detailAvailable: true,
  };
}

function contractGateSummary(gate) {
  if (!gate) return null;
  return {
    status: gate.status,
    contractId: gate.contractId,
    contractHash: gate.contractHash,
    reportArtifactId: gate.reportArtifactId,
    computedAt: gate.computedAt,
    agentClaimStatus: gate.agentClaimStatus,
    counts: clone(gate.counts),
    readyForAcceptance: gate.readyForAcceptance,
    detailAvailable: true,
  };
}

function publicAgentRun(run, {
  includeArchitectureGateDetails = false,
  includeContractGateDetails = false,
} = {}) {
  return {
    ...clone(run),
    architectureGate: includeArchitectureGateDetails
      ? clone(run.architectureGate)
      : architectureGateSummary(run.architectureGate),
    contractGate: includeContractGateDetails
      ? clone(run.contractGate)
      : contractGateSummary(run.contractGate),
  };
}

function agentRunResponse(
  analysis,
  runId,
  {
    activeDraftId = null,
    includeArchitectureGateDetails = false,
    includeContractGateDetails = false,
  } = {},
) {
  const run = analysis.agentRuns.find((item) => item.id === runId);
  if (!run) throw new ContractError('未找到该智能体运行', 'AGENT_RUN_NOT_FOUND', 404);
  return {
    protocolVersion: AI_CODING_PROTOCOL_VERSION,
    analysisRevision: analysis.baseRevision,
    run: publicAgentRun(run, { includeArchitectureGateDetails, includeContractGateDetails }),
    artifacts: analysis.artifacts.filter((record) => record.runId === run.id).map(publicArtifactRecord),
    proposals: analysis.proposals.filter((proposal) => proposal.origin?.runId === run.id).map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      reviewedAt: proposal.reviewedAt,
      application: clone(proposal.application),
      draftWrite: proposal.status === 'draft-applied'
        ? {
          status: proposal.application?.outcome === 'reverted-to-published'
            ? 'reverted-to-published'
            : 'applied-to-draft',
          summary: proposal.summary,
          humanApproved: false,
        }
        : null,
      publication: ['draft-applied', 'accepted'].includes(proposal.status)
        && proposal.application?.draftId === activeDraftId
        ? {
          status: 'awaiting-publication',
          summary: proposal.summary,
        }
        : null,
    })),
    permissions: {
      canSubmit: run.status !== 'reviewed',
      requiresHumanReview: run.taskType === 'implementation-reconcile' && Boolean(run.agentClaim),
      canAcceptImplementation: Boolean(
        run.architectureGate?.readyForHumanReview && run.contractGate?.readyForAcceptance
      ),
      agentCanReview: false,
      canApprove: false,
      canPublish: false,
    },
  };
}

function updateReviewedRun(analysis, proposal, reviewedAt) {
  const runId = proposal.origin?.runId;
  if (!runId) return;
  const run = analysis.agentRuns.find((item) => item.id === runId);
  if (!run) return;
  if (run.taskType === 'implementation-reconcile' && !run.humanReview) {
    run.status = 'submitted';
    run.updatedAt = reviewedAt;
    return;
  }
  const hasPendingProposal = analysis.proposals.some((item) => (
    item.origin?.runId === runId && item.status === 'pending'
  ));
  if (!hasPendingProposal) run.status = 'reviewed';
  run.updatedAt = reviewedAt;
}

function reviewImplementationRun(analysis, runId, incoming, state, { registry, projectRoot }) {
  const run = analysis.agentRuns.find((item) => item.id === runId);
  if (!run) throw new ContractError('未找到该智能体运行', 'AGENT_RUN_NOT_FOUND', 404);
  if (run.taskType !== 'implementation-reconcile') {
    throw new ContractError('只有实施核验运行可以进行实施结果验收', 'IMPLEMENTATION_REVIEW_NOT_APPLICABLE', 422);
  }
  if (!run.agentClaim || !run.architectureGate) {
    throw new ContractError('实施报告和自动架构核对尚未完成', 'IMPLEMENTATION_REVIEW_NOT_READY', 409);
  }
  if (run.humanReview) {
    throw new ContractError('该实施结果已经由用户验收，不能覆盖原结论', 'IMPLEMENTATION_ALREADY_REVIEWED', 409);
  }
  if (!['accepted', 'revision-requested', 'rejected'].includes(incoming.decision)) {
    throw new ContractError('人工验收结论无效', 'ANALYSIS_REQUEST_INVALID', 400);
  }
  if (typeof incoming.note !== 'string' || !incoming.note.trim() || incoming.note.trim().length > 2000) {
    throw new ContractError('人工验收必须填写 1–2000 字备注', 'ANALYSIS_REQUEST_INVALID', 400);
  }
  if (incoming.decision === 'accepted') {
    if (!run.contractGate) {
      throw new ContractError(
        '该旧实施运行未绑定正式开发合同，不能接受；请基于当前正式目标创建新的实施运行',
        'IMPLEMENTATION_CONTRACT_GATE_REQUIRED',
        409,
      );
    }
    const currentContract = assertExecutableTargetContract(
      state.target.published,
      registry,
      projectRoot,
    );
    const currentTarget = formalTargetDescriptor(run.diagramId, state.target.published);
    if (!sameFormalTarget(run.approvedTarget, currentTarget)) {
      throw new ContractError(
        '该运行锁定的正式目标已经变化，不能作为当前目标的实施结果接受',
        'AGENT_APPROVED_TARGET_STALE',
        409,
        { expected: clone(run.approvedTarget), actual: currentTarget },
      );
    }
    if (!run.architectureGate.readyForHumanReview) {
      throw new ContractError(
        '自动架构核对仍有未解决项，不能接受；请要求修订或拒绝',
        'IMPLEMENTATION_GATE_NOT_READY',
        409,
        { status: run.architectureGate.status, counts: clone(run.architectureGate.counts) },
      );
    }
    const reportRecord = analysis.artifacts.find((record) => (
      record.id === run.contractGate.reportArtifactId
      && record.runId === run.id
      && record.artifactType === 'implementation-report'
    ));
    const recomputedContractGate = reportRecord
      ? buildImplementationContractGate({
        run,
        contract: currentContract,
        report: reportRecord.artifact,
        computedAt: run.contractGate.computedAt,
      })
      : null;
    if (!recomputedContractGate || !sameJson(recomputedContractGate, run.contractGate)) {
      throw new ContractError(
        '实施合同门禁与正式合同或原始报告不一致，不能接受；请创建新的实施运行',
        'IMPLEMENTATION_CONTRACT_GATE_INVALID',
        409,
      );
    }
    if (!run.contractGate.readyForAcceptance) {
      throw new ContractError(
        '正式开发合同仍有未满足、未核验条件，或智能体尚未声明完整完成；不能接受，请要求修订或拒绝',
        'IMPLEMENTATION_CONTRACT_GATE_NOT_READY',
        409,
        {
          status: run.contractGate.status,
          agentClaimStatus: run.contractGate.agentClaimStatus,
          counts: clone(run.contractGate.counts),
        },
      );
    }
  }

  const next = clone(analysis);
  const targetRun = next.agentRuns.find((item) => item.id === runId);
  const reviewedAt = new Date().toISOString();
  targetRun.humanReview = {
    decision: incoming.decision,
    reviewer: 'local-user',
    reviewedAt,
    note: incoming.note.trim(),
  };
  targetRun.status = 'reviewed';
  targetRun.updatedAt = reviewedAt;
  validateAnalysis(next);
  return next;
}

function configuredGroupNames(state) {
  return Array.isArray(state.meta?.groups)
    ? state.meta.groups
      .map((group) => typeof group?.group === 'string' ? group.group.trim() : '')
      .filter(Boolean)
    : [];
}

function assertAgentChangePatch(change, state, view) {
  if (change.kind === 'remove') return;
  const patch = isPlainObject(change.patch) ? change.patch : {};
  const allowedPatchKeys = change.targetType === 'edge' ? new Set(['source', 'target', 'data']) : new Set(['data']);
  const forbiddenPatchKeys = Object.keys(patch).filter((field) => !allowedPatchKeys.has(field));
  const allowedDataFields = change.targetType === 'edge' ? AGENT_EDGE_DATA_FIELDS : AGENT_NODE_DATA_FIELDS;
  const forbiddenDataFields = Object.keys(patch.data || {}).filter((field) => !allowedDataFields.has(field));
  if (forbiddenPatchKeys.length || forbiddenDataFields.length) {
    throw new ContractError(
      '智能体补丁包含非架构语义字段；人工确认元数据、布局、端口和路由只能由本地用户维护',
      'AGENT_PATCH_FIELD_FORBIDDEN',
      422,
      {
        changeId: change.id,
        targetType: change.targetType,
        forbiddenPatchFields: forbiddenPatchKeys,
        forbiddenDataFields,
      },
    );
  }
  const clearedFields = Object.entries(patch.data || {})
    .filter(([, value]) => value === null)
    .map(([field]) => field);
  const invalidClears = clearedFields.filter((field) => (
    change.targetType !== 'node'
    || change.kind !== 'update'
    || !AGENT_NODE_CLEARABLE_FIELDS.has(field)
    || (view === 'target' && field === 'horizon')
  ));
  if (invalidClears.length) {
    throw new ContractError(
      '智能体只能在协议 1.4 的节点更新中显式清除可选语义字段；必填字段、关系字段和目标时间范围不能清除',
      'AGENT_PATCH_CLEAR_INVALID',
      422,
      { changeId: change.id, targetId: change.targetId, invalidFields: invalidClears, view },
    );
  }
  if (clearedFields.includes('relatedDiagramId') || clearedFields.includes('relatedNodeId')) {
    if (patch.data.relatedDiagramId !== null || patch.data.relatedNodeId !== null) {
      throw new ContractError(
        '下钻图与下钻节点引用必须在同一次补丁中成对清除',
        'AGENT_RELATED_REFERENCE_CLEAR_PAIR_REQUIRED',
        422,
        { changeId: change.id, targetId: change.targetId },
      );
    }
  }
  if (change.targetType === 'node' && typeof patch.data?.group === 'string' && patch.data.group.trim()) {
    const allowedGroups = configuredGroupNames(state);
    if (allowedGroups.length && !allowedGroups.includes(patch.data.group.trim())) {
      throw new ContractError(
        '智能体补丁指定了项目配置中不存在的架构分组',
        'AGENT_NODE_GROUP_INVALID',
        422,
        { changeId: change.id, targetId: change.targetId, group: patch.data.group, allowedGroups },
      );
    }
  }
}

function sourceGroupForGeneratedNode(graph, proposal, targetId, state) {
  const neighborIds = [];
  proposal.changes.forEach((change) => {
    if (change.kind !== 'add' || change.targetType !== 'edge') return;
    if (change.patch.source === targetId) neighborIds.push(change.patch.target);
    if (change.patch.target === targetId) neighborIds.push(change.patch.source);
  });
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const nodeId of neighborIds) {
    const group = byId.get(nodeId)?.data?.group;
    if (typeof group === 'string' && group.trim()) return group;
  }
  const configuredGroup = Array.isArray(state.meta?.groups)
    ? state.meta.groups.find((group) => typeof group?.group === 'string' && group.group.trim())
    : null;
  if (configuredGroup) return configuredGroup.group;
  const graphGroup = graph.nodes.find((node) => typeof node.data?.group === 'string' && node.data.group.trim())?.data?.group;
  return graphGroup || '待确认归属';
}

function generatedNodePosition(graph, index) {
  if (!graph.nodes.length) return { x: 80, y: 80 + index * (DEFAULT_NODE_HEIGHT + 40) };
  const right = Math.max(...graph.nodes.map((node) => Number(node.position?.x || 0) + Number(node.width || DEFAULT_NODE_WIDTH)));
  const top = Math.min(...graph.nodes.map((node) => Number(node.position?.y || 0)));
  return { x: right + 80, y: top + index * (DEFAULT_NODE_HEIGHT + 40) };
}

function proposalChangePhase(change) {
  if (change.kind === 'remove' && change.targetType === 'edge') return 0;
  if (change.kind === 'remove' && change.targetType === 'node') return 1;
  if (change.kind === 'add' && change.targetType === 'node') return 2;
  if (change.kind === 'update' && change.targetType === 'node') return 3;
  if (change.kind === 'add' && change.targetType === 'edge') return 4;
  return 5;
}

function applyProposalChanges(graph, proposal, state) {
  const next = clone(graph);
  const changes = proposal.changes
    .map((change, index) => ({ change, index }))
    .sort((left, right) => proposalChangePhase(left.change) - proposalChangePhase(right.change) || left.index - right.index)
    .map(({ change }) => change);
  changes.forEach((change) => assertAgentChangePatch(change, state, proposal.view));
  let generatedIndex = 0;
  const nodeById = () => new Map(next.nodes.map((node) => [node.id, node]));
  const edgeById = () => new Map(next.edges.map((edge) => [edge.id, edge]));

  changes.forEach((change) => {
    const nodes = nodeById();
    const edges = edgeById();
    if (change.targetType === 'node') {
      if (change.kind === 'add') {
        if (nodes.has(change.targetId)) {
          throw new ContractError('提案新增的节点已存在，请刷新后重新审阅', 'PROPOSAL_TARGET_CONFLICT', 409, { targetId: change.targetId });
        }
        const nodeData = clone(change.patch.data || {});
        const explicitGroup = typeof nodeData.group === 'string' ? nodeData.group.trim() : '';
        next.nodes.push({
          id: change.targetId,
          type: NODE_TYPE,
          position: generatedNodePosition(next, generatedIndex++),
          width: DEFAULT_NODE_WIDTH,
          height: DEFAULT_NODE_HEIGHT,
          data: {
            ...nodeData,
            group: explicitGroup || sourceGroupForGeneratedNode(next, proposal, change.targetId, state),
          },
        });
        return;
      }
      if (!nodes.has(change.targetId)) {
        throw new ContractError('提案引用的节点已不存在，请刷新后重新审阅', 'PROPOSAL_TARGET_MISSING', 409, { targetId: change.targetId });
      }
      if (change.kind === 'remove') {
        if (next.edges.some((edge) => edge.source === change.targetId || edge.target === change.targetId)) {
          throw new ContractError('移除节点前必须先在同一提案中移除关联关系', 'PROPOSAL_NODE_HAS_EDGES', 422, { targetId: change.targetId });
        }
        next.nodes = next.nodes.filter((node) => node.id !== change.targetId);
        return;
      }
      next.nodes = next.nodes.map((node) => {
        if (node.id !== change.targetId) return node;
        const data = { ...node.data };
        for (const [field, value] of Object.entries(change.patch.data || {})) {
          if (value === null) delete data[field];
          else data[field] = clone(value);
        }
        if (typeof data.group === 'string') data.group = data.group.trim();
        return { ...node, data };
      });
      return;
    }

    if (change.kind === 'add') {
      if (edges.has(change.targetId)) {
        throw new ContractError('提案新增的关系已存在，请刷新后重新审阅', 'PROPOSAL_TARGET_CONFLICT', 409, { targetId: change.targetId });
      }
      if (!nodes.has(change.patch.source) || !nodes.has(change.patch.target)) {
        throw new ContractError('新增关系引用的节点不存在', 'PROPOSAL_EDGE_NODE_MISSING', 422, { targetId: change.targetId });
      }
      if (change.patch.source === change.patch.target) {
        throw new ContractError('架构关系不允许自连接', 'PROPOSAL_EDGE_SELF_LOOP', 422, { targetId: change.targetId });
      }
      next.edges.push({
        id: change.targetId,
        source: change.patch.source,
        target: change.patch.target,
        data: {
          controlledBoundaryPosture: 'none',
          ...clone(change.patch.data),
          routingMode: 'auto',
        },
      });
      return;
    }
    if (!edges.has(change.targetId)) {
      throw new ContractError('提案引用的关系已不存在，请刷新后重新审阅', 'PROPOSAL_TARGET_MISSING', 409, { targetId: change.targetId });
    }
    if (change.kind === 'remove') {
      next.edges = next.edges.filter((edge) => edge.id !== change.targetId);
      return;
    }
    next.edges = next.edges.map((edge) => {
      if (edge.id !== change.targetId) return edge;
      const source = change.patch.source === undefined ? edge.source : change.patch.source;
      const target = change.patch.target === undefined ? edge.target : change.patch.target;
      if (!nodes.has(source) || !nodes.has(target)) {
        throw new ContractError('关系端点更新引用了不存在的节点', 'PROPOSAL_EDGE_NODE_MISSING', 422, {
          targetId: change.targetId,
          source,
          target,
        });
      }
      if (source === target) {
        throw new ContractError('架构关系不允许自连接', 'PROPOSAL_EDGE_SELF_LOOP', 422, { targetId: change.targetId });
      }
      return {
        ...edge,
        source,
        target,
        data: { ...edge.data, ...clone(change.patch.data || {}) },
      };
    });
  });
  validateGraph(next, proposal.view);
  return next;
}

function responseLayout(layout, view, diagramId = 'default') {
  return {
    schemaVersion: layout.schemaVersion,
    baseRevision: layout.baseRevision,
    lastUpdated: layout.lastUpdated,
    diagramId,
    view,
    positions: clone(layout.layouts[view].positions),
    containers: clone(layout.layouts[view].containers || {}),
  };
}

function viewFrom(url) {
  const view = url.searchParams.get('view');
  if (!['current', 'target'].includes(view)) {
    throw new ContractError('必须显式提供 view=current 或 view=target', 'INVALID_VIEW', 400);
  }
  return view;
}

function responseState(state, view, diagramId = 'default') {
  return {
    schemaVersion: state.schemaVersion,
    meta: state.meta,
    diagramId,
    view,
    published: state[view].published,
    draft: state[view].draft,
    historyCount: state[view].history.length,
  };
}

function actualLock(lane) {
  return {
    headRevision: lane.published.revision,
    headRevisionId: lane.published.revisionId,
    draftId: lane.draft ? lane.draft.draftId : null,
    draftRevision: lane.draft ? lane.draft.draftRevision : 0,
  };
}

function assertLaneLock(incoming, lane) {
  const actual = actualLock(lane);
  if (
    incoming.expectedHeadRevision !== actual.headRevision
    || incoming.expectedHeadRevisionId !== actual.headRevisionId
  ) {
    throw new ContractError('正式架构已变化，请刷新后重试', 'STALE_HEAD', 409, actual);
  }
  if (incoming.expectedDraftId !== actual.draftId || incoming.expectedDraftRevision !== actual.draftRevision) {
    throw new ContractError('草案已变化，请刷新后重试', 'STALE_DRAFT', 409, actual);
  }
}

function allRevisions(lane) {
  return [...lane.history, lane.published];
}

function findRevision(lane, revisionId) {
  return allRevisions(lane).find((revision) => revision.revisionId === revisionId) || null;
}

function nextRevisionId(view, lane) {
  return `${view}-r${lane.published.revision + 1}`;
}

function newDraftId(view) {
  return `${view}-draft-${crypto.randomUUID().toLowerCase()}`;
}

function assertRegistryRevision(incoming, registry) {
  if (incoming.baseRevision !== registry.baseRevision) {
    throw new ContractError('文档注册表已变化，请刷新后重试', 'STALE_DOCUMENT_REGISTRY', 409, {
      baseRevision: registry.baseRevision,
    });
  }
}

function normalizedRealPath(value) {
  const resolved = fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInsideRoot(candidate, root) {
  const normalizedCandidate = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function resolveSafeDocument(documentPath, projectRoot = resolveProjectDirectory()) {
  validateDocumentPath(documentPath);
  const root = path.resolve(projectRoot);
  let rootReal;
  try {
    rootReal = normalizedRealPath(root);
  } catch {
    throw new ContractError('无法解析项目文档根目录', 'DOCUMENT_ROOT_UNAVAILABLE', 500);
  }
  const segments = documentPath.split('/');
  let cursor = root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    let stats;
    try {
      stats = fs.lstatSync(cursor);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new ContractError('文档文件不存在', 'DOCUMENT_MISSING', 422, { path: documentPath });
      }
      throw new ContractError('无法安全检查文档路径', 'DOCUMENT_UNREADABLE', 422, { path: documentPath });
    }
    if (stats.isSymbolicLink()) {
      throw new ContractError('文档路径不得经过符号链接或联接点', 'DOCUMENT_REPARSE_POINT', 422, { path: documentPath });
    }
  }
  let fileReal;
  try {
    fileReal = normalizedRealPath(cursor);
  } catch {
    throw new ContractError('无法解析文档真实路径', 'DOCUMENT_UNREADABLE', 422, { path: documentPath });
  }
  if (!isInsideRoot(fileReal, rootReal)) {
    throw new ContractError('文档解析路径越过项目文档根目录', 'DOCUMENT_PATH_ESCAPE', 422, { path: documentPath });
  }
  let stats;
  try {
    stats = fs.statSync(cursor);
  } catch {
    throw new ContractError('无法读取文档文件属性', 'DOCUMENT_UNREADABLE', 422, { path: documentPath });
  }
  if (!stats.isFile()) throw new ContractError('文档路径必须指向普通文件', 'DOCUMENT_NOT_FILE', 422, { path: documentPath });
  if (stats.size > MAX_DOCUMENT_BYTES) {
    throw new ContractError('文档超过 1MiB 安全上限', 'DOCUMENT_TOO_LARGE', 422, { path: documentPath, sizeBytes: stats.size });
  }
  return { absolutePath: cursor, stats };
}

function referenceContexts(stateOrEntries) {
  const contexts = [];
  const scan = (graph, context) => {
    graph.nodes.forEach((node) => {
      (node.data.documentRefs || []).forEach((documentId) => contexts.push({ documentId, nodeId: node.id, ...context }));
    });
  };
  const entries = Array.isArray(stateOrEntries)
    ? stateOrEntries
    : [{ diagramId: null, state: stateOrEntries }];
  entries.forEach(({ diagramId, state }) => {
    ['current', 'target'].forEach((view) => {
      const lane = state[view];
      const diagramContext = diagramId ? { diagramId } : {};
      scan(lane.published.graph, { ...diagramContext, view, scope: 'head', revisionId: lane.published.revisionId });
      if (lane.draft) scan(lane.draft.graph, { ...diagramContext, view, scope: 'draft', draftId: lane.draft.draftId });
      lane.history.forEach((revision) => scan(revision.graph, {
        ...diagramContext,
        view,
        scope: 'history',
        revisionId: revision.revisionId,
      }));
    });
  });
  return contexts;
}

function documentFileDiagnostics(document, projectRoot = resolveProjectDirectory()) {
  try {
    const { stats } = resolveSafeDocument(document.path, projectRoot);
    const diagnostics = [];
    if (stats.mtimeMs > Date.parse(document.lastVerifiedAt) + 1000) {
      diagnostics.push({ code: 'STALE_FILE', severity: 'warning', message: '文件在上次核验后发生过修改' });
    }
    return diagnostics;
  } catch (error) {
    if (error instanceof ContractError) {
      return [{ code: error.code, severity: 'error', message: error.message }];
    }
    throw error;
  }
}

function enrichedRegistry(registry, stateOrEntries, projectRoot = resolveProjectDirectory()) {
  const contexts = referenceContexts(stateOrEntries);
  const documentsById = new Map(registry.documents.map((document) => [document.id, document]));
  const documents = registry.documents.map((document) => {
    const refs = contexts.filter((context) => context.documentId === document.id);
    const activeCount = refs.filter((context) => context.scope !== 'history').length;
    const historicalCount = refs.filter((context) => context.scope === 'history').length;
    const diagnostics = documentFileDiagnostics(document, projectRoot);
    if (document.status === 'archived') diagnostics.push({ code: 'ARCHIVED', severity: 'warning', message: '文档已归档' });
    if (document.status === 'superseded') diagnostics.push({ code: 'SUPERSEDED', severity: 'warning', message: '文档已被替代' });
    if (activeCount === 0 && historicalCount === 0) {
      diagnostics.push({ code: 'ORPHANED', severity: 'info', message: '文档尚未绑定任何模块' });
    } else if (activeCount === 0 && historicalCount > 0) {
      diagnostics.push({ code: 'HISTORICAL_ONLY', severity: 'info', message: '文档只被历史版本引用' });
    }
    return { ...clone(document), diagnostics, referenceSummary: { activeCount, historicalCount } };
  });
  const bindingDiagnostics = [];
  contexts.forEach((context) => {
    const document = documentsById.get(context.documentId);
    if (!document) {
      bindingDiagnostics.push({ ...context, code: 'UNKNOWN_DOCUMENT', severity: 'error', message: '模块引用了注册表中不存在的文档' });
      return;
    }
    if (document.status === 'archived' || document.status === 'superseded') {
      bindingDiagnostics.push({
        ...context,
        code: document.status === 'archived' ? 'ARCHIVED_DOCUMENT' : 'SUPERSEDED_DOCUMENT',
        severity: 'warning',
        message: document.status === 'archived' ? '模块引用了已归档文档' : '模块引用了已替代文档',
      });
    }
    const fileProblem = documentFileDiagnostics(document, projectRoot).find((item) => item.severity === 'error');
    if (fileProblem) bindingDiagnostics.push({ ...context, ...fileProblem });
  });
  return {
    schemaVersion: registry.schemaVersion,
    baseRevision: registry.baseRevision,
    lastUpdated: registry.lastUpdated,
    documents,
    bindingDiagnostics,
  };
}

function pickAgentFields(value, allowed) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key, item]) => allowed.has(key) && item !== undefined));
}

function compactAgentArchitecture(revision) {
  const { graph, developmentContract, ...metadata } = revision;
  return {
    ...clone(metadata),
    representation: 'semantic-graph-v1',
    graph: {
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        ...(node.type ? { type: node.type } : {}),
        data: pickAgentFields(node.data, AGENT_NODE_DATA_FIELDS),
      })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: pickAgentFields(edge.data, AGENT_EDGE_DATA_FIELDS),
      })),
    },
  };
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeJson(value[key])]));
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalizeJson(value))).digest('hex');
}

function canonicalAgentSemanticGraph(revision) {
  const graph = compactAgentArchitecture(revision).graph;
  return canonicalizeJson({
    nodes: [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...graph.edges].sort((left, right) => left.id.localeCompare(right.id)),
  });
}

function agentSemanticHash(revision) {
  return sha256Json(canonicalAgentSemanticGraph(revision));
}

function graphContractTargetRefs(graph) {
  return [
    ...graph.nodes.map((node) => ({ targetType: 'node', targetId: node.id })),
    ...graph.edges.map((edge) => ({ targetType: 'edge', targetId: edge.id })),
  ].sort((left, right) => `${left.targetType}:${left.targetId}`.localeCompare(`${right.targetType}:${right.targetId}`));
}

function graphContractBoundaryRefs(graph) {
  return [
    ...graph.nodes.map((node) => ({
      targetType: 'node',
      targetId: node.id,
      field: 'authorization',
      value: node.data.authorization,
    })),
    ...graph.edges.map((edge) => ({
      targetType: 'edge',
      targetId: edge.id,
      field: 'controlledBoundaryPosture',
      value: edge.data.controlledBoundaryPosture,
    })),
  ].sort((left, right) => (
    `${left.targetType}:${left.targetId}:${left.field}`.localeCompare(`${right.targetType}:${right.targetId}:${right.field}`)
  ));
}

function graphDocumentIds(graph) {
  return [...new Set(graph.nodes.flatMap((node) => node.data.documentRefs || []))].sort();
}

function frozenDocumentIndex(graph, registry, projectRoot) {
  const documentsById = new Map(registry.documents.map((document) => [document.id, document]));
  return graphDocumentIds(graph).map((documentId) => {
    const document = documentsById.get(documentId);
    if (!document) {
      throw new ContractError('目标架构绑定了注册表中不存在的文档', 'UNKNOWN_DOCUMENT_BINDING', 422, { documentId });
    }
    if (['archived', 'superseded'].includes(document.status)) {
      throw new ContractError('目标开发合同不能冻结已归档或已替代文档', 'DOCUMENT_BINDING_BLOCKED', 422, {
        documentId,
        status: document.status,
      });
    }
    const material = readRegisteredDocumentMaterial(document, null, projectRoot);
    return {
      id: document.id,
      title: document.title,
      path: document.path,
      summary: document.summary,
      status: document.status,
      authority: document.authority,
      lastVerifiedAt: document.lastVerifiedAt,
      contentHash: material.fullHash,
      sizeBytes: material.stats.size,
    };
  });
}

function contractDocumentSetHash(documents) {
  return sha256Json(documents.map((document) => ({
    id: document.id,
    status: document.status,
    authority: document.authority,
    path: document.path,
    contentHash: document.contentHash,
  })));
}

function contractDocumentBinding(document, contentHash = document.contentHash) {
  return {
    id: document.id,
    status: document.status,
    authority: document.authority,
    path: document.path,
    contentHash,
  };
}

function contractHash(contract) {
  const { contractHash: ignored, ...content } = contract;
  return sha256Json(content);
}

function proposalContractSource(proposal) {
  if (!proposal) return null;
  return {
    proposalId: proposal.id,
    requestId: proposal.requestId || null,
    artifactId: proposal.origin?.artifactId || null,
    runId: proposal.origin?.runId || null,
  };
}

function editableDraftContractBase(lane) {
  if (lane.draft?.developmentContract) return lane.draft.developmentContract;
  const published = lane.published?.developmentContract;
  if (!published || !['executable', 'not-executable'].includes(published.status)) return null;
  return {
    contractId: null,
    source: clone(published.source || null),
    acceptanceCriteria: clone(published.acceptanceCriteria || []),
  };
}

function comparableCriteria(contract) {
  return clone(contract?.acceptanceCriteria || [])
    .sort((left, right) => left.id.localeCompare(right.id));
}

function comparableDocumentBindings(contract) {
  return clone(contract?.documents || [])
    .map((document) => contractDocumentBinding(document))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function draftEquivalentToPublished(draft, published, view) {
  if (agentSemanticHash({ graph: draft.graph }) !== agentSemanticHash(published)) return false;
  if (view !== 'target') return true;
  return sameJson(
    comparableCriteria(draft.developmentContract),
    comparableCriteria(published.developmentContract),
  ) && sameJson(
    comparableDocumentBindings(draft.developmentContract),
    comparableDocumentBindings(published.developmentContract),
  );
}

function draftDevelopmentContract(graph, { draftId, proposal = null, prior = null, registry, projectRoot }) {
  const acceptanceCriteriaById = new Map();
  for (const criterion of prior?.acceptanceCriteria || []) {
    acceptanceCriteriaById.set(criterion.id, clone(criterion));
  }
  if (proposal?.contractPatch) {
    for (const criterion of proposal.contractPatch.upsert || []) {
      acceptanceCriteriaById.set(criterion.id, {
        id: criterion.id,
        statement: criterion.statement,
        targetRefs: clone(criterion.targetRefs),
      });
    }
    for (const operation of proposal.contractPatch.delete || []) {
      if (!acceptanceCriteriaById.has(operation.id)) {
        throw new ContractError(
          '合同补丁试图删除活动目标草稿中不存在的验收条件',
          'PROPOSAL_CONTRACT_CRITERION_NOT_FOUND',
          409,
          { criterionId: operation.id },
        );
      }
      acceptanceCriteriaById.delete(operation.id);
    }
  } else {
    for (const criterion of proposal?.acceptanceCriteria || []) {
      const existing = acceptanceCriteriaById.get(criterion.id);
      if (existing && !sameJson(existing, criterion)) {
        throw new ContractError(
          '旧版 acceptanceCriteria 不能用同一 ID 覆盖草稿条件；请使用显式 contractPatch.upsert',
          'PROPOSAL_CONTRACT_CRITERION_CONFLICT',
          409,
          { criterionId: criterion.id },
        );
      }
      if (!existing) acceptanceCriteriaById.set(criterion.id, clone(criterion));
    }
  }
  const acceptanceCriteria = [...acceptanceCriteriaById.values()];
  const source = clone(prior?.source || (proposal ? proposalContractSource(proposal) : null));
  return {
    schemaVersion: DEVELOPMENT_CONTRACT_SCHEMA_VERSION,
    status: 'draft',
    contractId: prior?.contractId || `contract-${draftId}`,
    target: { revision: null, revisionId: null, semanticHash: null },
    source,
    acceptanceCriteria,
    targetRefs: graphContractTargetRefs(graph),
    boundaryRefs: graphContractBoundaryRefs(graph),
    documents: frozenDocumentIndex(graph, registry, projectRoot),
    frozenAt: null,
    frozenBy: null,
    contractHash: null,
    documentSetHash: null,
    executionReason: acceptanceCriteria.length
      ? '该开发合同仍是草案，必须由用户正式发布后才能用于实施。'
      : '草案尚未绑定可执行验收标准。',
  };
}

function acceptanceCriteriaReferenceExistingTargets(criteria, graph) {
  const valid = new Set(graphContractTargetRefs(graph).map((ref) => `${ref.targetType}:${ref.targetId}`));
  return criteria.every((criterion) => criterion.targetRefs.every((ref) => valid.has(`${ref.targetType}:${ref.targetId}`)));
}

function assertDraftBoundDocumentsCurrent(draftContract, graph, registry, projectRoot) {
  const expected = clone(draftContract?.documents || []);
  let current;
  try {
    current = frozenDocumentIndex(graph, registry, projectRoot);
  } catch (error) {
    throw new ContractError(
      '目标草稿绑定文档在审阅后发生变化；请刷新草稿合同并重新检查后再发布',
      'DRAFT_BOUND_DOCUMENT_STALE',
      409,
      { causeCode: error.code || 'DOCUMENT_BINDING_UNAVAILABLE', cause: error.message },
    );
  }
  const expectedBindings = expected.map((document) => contractDocumentBinding(document));
  const currentBindings = current.map((document) => contractDocumentBinding(document));
  if (!sameJson(expectedBindings, currentBindings)) {
    throw new ContractError(
      '目标草稿绑定文档在审阅后发生变化；请刷新草稿合同并重新检查后再发布',
      'DRAFT_BOUND_DOCUMENT_STALE',
      409,
      { expected: expectedBindings, current: currentBindings },
    );
  }
  return current;
}

function freezeDevelopmentContract(draftContract, graph, revision, registry, projectRoot, frozenAt, verifiedDocuments = null) {
  const acceptanceCriteria = clone(draftContract?.acceptanceCriteria || []);
  const documents = verifiedDocuments ? clone(verifiedDocuments) : frozenDocumentIndex(graph, registry, projectRoot);
  const refsValid = acceptanceCriteriaReferenceExistingTargets(acceptanceCriteria, graph);
  const executable = acceptanceCriteria.length > 0 && refsValid;
  const frozen = {
    schemaVersion: DEVELOPMENT_CONTRACT_SCHEMA_VERSION,
    status: executable ? 'executable' : 'not-executable',
    contractId: `contract-${revision.revisionId}`,
    target: {
      revision: revision.revision,
      revisionId: revision.revisionId,
      semanticHash: agentSemanticHash({ graph }),
    },
    source: clone(draftContract?.source || null),
    acceptanceCriteria,
    targetRefs: graphContractTargetRefs(graph),
    boundaryRefs: graphContractBoundaryRefs(graph),
    documents,
    frozenAt,
    frozenBy: 'user',
    contractHash: null,
    documentSetHash: contractDocumentSetHash(documents),
    executionReason: executable
      ? null
      : acceptanceCriteria.length
        ? '验收条件引用了该目标版本中不存在的架构项。'
        : '该正式目标没有用户发布的可观察验收条件，不能启动严格实施闭环。',
  };
  frozen.contractHash = contractHash(frozen);
  return frozen;
}

function compactDevelopmentContract(contract) {
  return contract ? clone(contract) : null;
}

function compactDraftDevelopmentContract(contract) {
  if (!contract) return null;
  return {
    contractId: contract.contractId,
    status: 'draft',
    unpublished: true,
    acceptanceCriteria: clone(contract.acceptanceCriteria || []),
    targetRefs: clone(contract.targetRefs || []),
    boundaryRefs: clone(contract.boundaryRefs || []),
    documentIds: (contract.documents || []).map((document) => document.id),
    executionReason: contract.executionReason || null,
  };
}

function assertExecutableTargetContract(revision, registry, projectRoot) {
  const contract = revision.developmentContract;
  if (!contract || contract.status !== 'executable') {
    throw new ContractError(
      '当前正式目标没有可执行开发合同；请先发布带稳定验收条件的目标提案',
      'AGENT_TARGET_NOT_EXECUTABLE',
      409,
      { revisionId: revision.revisionId, contractStatus: contract?.status || 'unbound' },
    );
  }
  if (contract.contractHash !== contractHash(contract)
    || contract.documentSetHash !== contractDocumentSetHash(contract.documents)) {
    throw new ContractError('正式目标开发合同完整性校验失败', 'AGENT_TARGET_CONTRACT_INVALID', 409, {
      revisionId: revision.revisionId,
    });
  }
  const semanticHash = agentSemanticHash(revision);
  if (contract.target.semanticHash !== semanticHash
    || !sameJson(contract.targetRefs, graphContractTargetRefs(revision.graph))
    || !sameJson(contract.boundaryRefs, graphContractBoundaryRefs(revision.graph))) {
    throw new ContractError('正式目标语义图与冻结开发合同不一致', 'AGENT_TARGET_CONTRACT_INVALID', 409, {
      revisionId: revision.revisionId,
      expectedSemanticHash: contract.target.semanticHash,
      actualSemanticHash: semanticHash,
    });
  }
  const registryById = new Map(registry.documents.map((document) => [document.id, document]));
  const staleDocumentIds = [];
  contract.documents.forEach((locked) => {
    try {
      const document = registryById.get(locked.id);
      const material = document ? readRegisteredDocumentMaterial(document, null, projectRoot) : null;
      const currentBinding = material ? contractDocumentBinding(document, material.fullHash) : null;
      if (!currentBinding
        || sha256Json(currentBinding) !== sha256Json(contractDocumentBinding(locked))) {
        staleDocumentIds.push(locked.id);
      }
    } catch {
      staleDocumentIds.push(locked.id);
    }
  });
  if (staleDocumentIds.length) {
    throw new ContractError(
      '正式目标绑定的文档已经变化，请由用户重新发布目标合同后再继续',
      'AGENT_BOUND_DOCUMENT_STALE',
      409,
      { documentIds: staleDocumentIds },
    );
  }
  return contract;
}

function formalTargetDescriptor(diagramId, revision) {
  return {
    status: 'executable-formal-baseline',
    diagramId,
    revision: revision.revision,
    revisionId: revision.revisionId,
    semanticHash: revision.developmentContract.target.semanticHash,
    contractId: revision.developmentContract.contractId,
    contractHash: revision.developmentContract.contractHash,
    documentSetHash: revision.developmentContract.documentSetHash,
  };
}

function publishedTargetBaseline(diagramId, revision, registry, projectRoot) {
  const contract = revision.developmentContract;
  let formalBaseline = null;
  let baselineStatus = contract?.status || 'unbound';
  let executionIssue = null;
  if (contract?.status === 'executable') {
    try {
      assertExecutableTargetContract(revision, registry, projectRoot);
      formalBaseline = formalTargetDescriptor(diagramId, revision);
      baselineStatus = 'executable-formal-baseline';
    } catch (error) {
      if (!['AGENT_BOUND_DOCUMENT_STALE', 'AGENT_TARGET_CONTRACT_INVALID'].includes(error.code)) throw error;
      baselineStatus = 'stale-formal-contract';
      executionIssue = { code: error.code, message: error.message, details: error.details || null };
    }
  }
  return { baselineStatus, formalBaseline, executionIssue };
}

function sameFormalTarget(left, right) {
  return Boolean(left && right) && [
    'status', 'diagramId', 'revision', 'revisionId', 'semanticHash',
    ...(left.status === 'executable-formal-baseline' ? ['contractId', 'contractHash', 'documentSetHash'] : []),
  ]
    .every((field) => left[field] === right[field]);
}

function addedDocumentRefs(beforeGraph, afterGraph) {
  const before = new Map(beforeGraph.nodes.map((node) => [node.id, new Set(node.data.documentRefs || [])]));
  const added = [];
  afterGraph.nodes.forEach((node) => {
    const oldRefs = before.get(node.id) || new Set();
    (node.data.documentRefs || []).forEach((documentId) => {
      if (!oldRefs.has(documentId)) added.push({ nodeId: node.id, documentId });
    });
  });
  return added;
}

function validateNewDocumentBindings(beforeGraph, afterGraph, registry, projectRoot = resolveProjectDirectory()) {
  const documents = new Map(registry.documents.map((document) => [document.id, document]));
  for (const binding of addedDocumentRefs(beforeGraph, afterGraph)) {
    const document = documents.get(binding.documentId);
    if (!document) {
      throw new ContractError('不能绑定注册表中不存在的文档', 'UNKNOWN_DOCUMENT_BINDING', 422, binding);
    }
    if (document.status === 'archived' || document.status === 'superseded') {
      throw new ContractError('不能新增绑定已归档或已替代的文档', 'DOCUMENT_BINDING_BLOCKED', 422, {
        ...binding,
        status: document.status,
      });
    }
    resolveSafeDocument(document.path, projectRoot);
  }
}

function protectedSemanticChanges(meta, view, beforeGraph, afterGraph) {
  const beforeNodes = new Map((beforeGraph?.nodes || []).map((node) => [node.id, node]));
  const afterNodes = new Map((afterGraph?.nodes || []).map((node) => [node.id, node]));
  const policyDecisions = Array.isArray(meta?.humanConfirmedArchitecture?.decisions)
    ? meta.humanConfirmedArchitecture.decisions.filter((decision) => decision?.view === view)
    : [];
  const policyFields = new Map();
  policyDecisions.forEach((decision) => {
    const fields = Array.isArray(decision.protectedFields) ? decision.protectedFields : [];
    (decision.nodeIds || []).forEach((nodeId) => {
      const current = policyFields.get(nodeId) || new Set();
      fields.forEach((field) => current.add(field));
      policyFields.set(nodeId, current);
    });
  });

  const changes = [];
  beforeNodes.forEach((beforeNode, nodeId) => {
    const afterNode = afterNodes.get(nodeId);
    const fields = new Set(policyFields.get(nodeId) || []);
    if (beforeNode.data?.humanConfirmed === true) {
      Object.keys(beforeNode.data || {}).forEach((field) => {
        if (field !== 'documentRefs') fields.add(field);
      });
    }
    if (!fields.size) return;
    if (!afterNode) {
      changes.push({ nodeId, fields: ['模块删除'] });
      return;
    }
    const changedFields = [...fields].filter((field) => (
      JSON.stringify(beforeNode.data?.[field]) !== JSON.stringify(afterNode.data?.[field])
    ));
    if (changedFields.length) changes.push({ nodeId, fields: changedFields });
  });
  return changes;
}

function assertHumanConfirmedSemantics(meta, view, beforeGraph, afterGraph, incoming) {
  const changes = protectedSemanticChanges(meta, view, beforeGraph, afterGraph);
  if (!changes.length || incoming.userConfirmedSemanticOverride === true) return;
  throw new ContractError(
    '此次修改会覆盖用户已经确认的架构理解，请通过人工纠正入口明确确认',
    'HUMAN_CONFIRMATION_REQUIRED',
    403,
    { changes },
  );
}

function resolveGraphReference(lane, reference) {
  if (reference === 'head') return { reference, kind: 'head', graph: lane.published.graph, revisionId: lane.published.revisionId };
  if (reference === 'draft') {
    if (!lane.draft) throw new ContractError('当前没有可比较的草案', 'NO_ACTIVE_DRAFT', 409);
    return { reference, kind: 'draft', graph: lane.draft.graph, draftId: lane.draft.draftId };
  }
  const revision = findRevision(lane, reference);
  if (!revision) throw new ContractError('未找到指定历史版本', 'REVISION_NOT_FOUND', 404, { revisionId: reference });
  return { reference, kind: 'revision', graph: revision.graph, revisionId: revision.revisionId };
}

function extractSection(content, section) {
  if (!section) return content;
  if (section.length > 200) throw new ContractError('section 参数过长', 'INVALID_SECTION', 400);
  const lines = content.split(/\r?\n/);
  const wanted = section.trim().toLocaleLowerCase('zh-CN');
  let start = -1;
  let level = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index]);
    if (match && match[2].trim().toLocaleLowerCase('zh-CN') === wanted) {
      start = index;
      level = match[1].length;
      break;
    }
  }
  if (start < 0) throw new ContractError('未找到指定 Markdown 标题', 'SECTION_NOT_FOUND', 404, { section });
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+/.exec(lines[index]);
    if (match && match[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function readRegisteredDocumentMaterial(document, section, projectRoot = resolveProjectDirectory()) {
  const { absolutePath, stats } = resolveSafeDocument(document.path, projectRoot);
  let fullContent;
  try {
    fullContent = fs.readFileSync(absolutePath, 'utf8');
  } catch {
    throw new ContractError('无法读取文档正文', 'DOCUMENT_UNREADABLE', 422, { path: document.path });
  }
  const scopedContent = extractSection(fullContent, section);
  return {
    stats,
    fullContent,
    scopedContent,
    fullHash: crypto.createHash('sha256').update(fullContent).digest('hex'),
    scopedHash: crypto.createHash('sha256').update(scopedContent).digest('hex'),
  };
}

function previewDocument(document, section, projectRoot = resolveProjectDirectory()) {
  const material = readRegisteredDocumentMaterial(document, section, projectRoot);
  const scopedBuffer = Buffer.from(material.scopedContent, 'utf8');
  const truncated = scopedBuffer.length > MAX_PREVIEW_BYTES;
  const content = truncated
    ? scopedBuffer.subarray(0, MAX_PREVIEW_BYTES).toString('utf8').replace(/\uFFFD$/, '')
    : material.scopedContent;
  return {
    documentId: document.id,
    title: document.title,
    path: document.path,
    section: section || null,
    content,
    truncated,
    sizeBytes: material.stats.size,
    contentHash: material.scopedHash,
    fullContentHash: material.fullHash,
    diagnostics: documentFileDiagnostics(document, projectRoot),
  };
}

function serveFile(req, res, staticRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new ContractError('静态资源路径编码无效', 'INVALID_PATH', 400);
  }
  if (decoded.includes('\0')) throw new ContractError('静态资源路径无效', 'INVALID_PATH', 400);
  const rawRelative = decoded === '/' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
  const relative = path.posix.normalize(rawRelative.replace(/\\/g, '/'));
  if (relative === '..' || relative.startsWith('../') || relative.split('/').some((segment) => segment.startsWith('.'))) {
    throw new ContractError('静态资源路径无效', 'INVALID_PATH', 400);
  }
  const root = path.resolve(staticRoot);
  const isPublicAsset = relative === 'index.html' || relative.startsWith('assets/');
  let file = path.resolve(root, relative);
  if (!isInsideRoot(file, root)) throw new ContractError('静态资源路径越界', 'INVALID_PATH', 400);
  if (!isPublicAsset) {
    if (path.extname(relative)) return false;
    file = path.join(root, 'index.html');
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (path.extname(relative)) return false;
    file = path.join(root, 'index.html');
    if (!fs.existsSync(file)) return false;
  }
  const contentType = MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = securityHeaders(contentType);
  headers['Content-Length'] = fs.statSync(file).size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
  return true;
}

function createServer(options = {}) {
  const projectRoot = resolveProjectDirectory(options.projectDirectory || options.projectRoot || options.commandRoot);
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot, projectRoot);
  const stateFile = resolveStateFile(options.stateFile, projectRoot);
  const documentsFile = resolveDocumentsFile(options.documentsFile, projectRoot);
  const layoutFile = resolveLayoutFile(options.layoutFile, projectRoot);
  const configFile = resolveConfigFile(options.configFile, projectRoot);
  const catalogFile = options.catalogFile !== undefined
    ? resolveCatalogFile(options.catalogFile, projectRoot)
    : (options.stateFile || options.layoutFile
      ? path.join(path.dirname(stateFile), PROJECT_FILES.catalog)
      : resolveCatalogFile(undefined, projectRoot));
  const registeredFlowsFile = resolveRegisteredFlowsFile(options.registeredFlowsFile, projectRoot);
  const analysisFile = options.analysisFile !== undefined
    ? resolveAnalysisFile(options.analysisFile, projectRoot)
    : (options.stateFile || options.layoutFile
      ? path.join(path.dirname(stateFile), PROJECT_FILES.analysis)
      : resolveAnalysisFile(undefined, projectRoot));
  const staticRoot = resolveStaticRoot(options.staticRoot || process.env.STATIC_ROOT);
  const skillsRoot = path.resolve(options.skillsRoot || path.join(ROOT, 'skills'));
  const afterAgentDraftStateWrite = typeof options.afterAgentDraftStateWrite === 'function'
    ? options.afterAgentDraftStateWrite
    : null;

  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${HOST}`);
      const { pathname } = requestUrl;

      if (req.method === 'GET' && pathname === '/api/config') {
        return json(res, 200, readViewerConfig(configFile));
      }

      if (req.method === 'GET' && pathname === '/api/skills') {
        return json(res, 200, readSkillCatalog(skillsRoot));
      }

      if (req.method === 'GET' && pathname === '/api/agent/context') {
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        const diagram = agentDiagram(catalog, requestUrl.searchParams.get('diagram'));
        const view = requestUrl.searchParams.get('view') || 'current';
        if (!['current', 'target'].includes(view)) {
          throw new ContractError('智能体上下文 view 必须是 current 或 target', 'AGENT_VIEW_INVALID', 422);
        }
        const lane = readState(diagram.statePath)[view];
        const config = readViewerConfig(configFile);
        const registry = readRegistry(documentsFile);
        const targetBaseline = view === 'target'
          ? publishedTargetBaseline(diagram.id, lane.published, registry, projectRoot)
          : null;
        return json(res, 200, {
          protocolVersion: AI_CODING_PROTOCOL_VERSION,
          project: {
            id: config.projectId,
            name: config.projectName,
            scopeNote: resolvedConfigText(config.scopeNote, config.defaultLanguage || 'zh'),
          },
          diagrams: publicArchitectureCatalog(catalog),
          selected: {
            diagramId: diagram.id,
            view,
            title: diagram.title,
            description: diagram.description,
            published: compactAgentArchitecture(lane.published),
            developmentContract: view === 'target'
              ? compactDevelopmentContract(lane.published.developmentContract)
              : null,
            ...(targetBaseline || {}),
            draft: lane.draft ? {
              draftId: lane.draft.draftId,
              draftRevision: lane.draft.draftRevision,
              baseRevision: lane.draft.baseRevision,
              baseRevisionId: lane.draft.baseRevisionId,
              savedAt: lane.draft.savedAt,
              representation: 'semantic-graph-v1',
              graph: compactAgentArchitecture(lane.draft).graph,
              developmentContract: view === 'target'
                ? compactDraftDevelopmentContract(lane.draft.developmentContract)
                : null,
            } : null,
          },
          documents: registry.documents.map((document) => ({
            id: document.id,
            title: document.title,
            path: document.path,
            summary: document.summary,
            status: document.status,
            authority: document.authority,
            lastVerifiedAt: document.lastVerifiedAt,
            diagnostics: documentFileDiagnostics(document, projectRoot),
          })),
          workflow: {
            createRunFirst: true,
            evidenceRequired: true,
            supportedEvidenceBases: ['user-confirmed', 'design-document', 'code-fact', 'agent-inference'],
            conceptProjectsSupported: true,
            currentArchitectureRequiresCodeFacts: true,
            implementationRequiresPublishedTarget: true,
            implementationSnapshotFirst: true,
            serverComputedReconciliation: true,
            serverComputedContractGate: true,
            implementationHumanReviewRequired: true,
            evidencePathsAreWorkspaceRelative: true,
            projectDocumentsUseRegisteredIds: true,
            projectDocumentsCannotProveImplementation: true,
            separateWorkspaceConfigured: workspaceRoot !== projectRoot,
            architectureChangesApplyToDraft: true,
            architectureChangeHumanReviewRequired: false,
            architecturePublicationHumanOnly: true,
            agentCanReview: false,
            agentCanApprove: false,
            agentCanPublish: false,
          },
        });
      }

      if (req.method === 'POST' && pathname === '/api/agent/runs') {
        const incoming = await readJsonBody(req);
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        const run = createAgentRun(incoming, catalog, {
          registry: readRegistry(documentsFile),
          projectRoot,
        });
        const analysis = readAnalysis(analysisFile);
        const next = { ...clone(analysis), agentRuns: [...analysis.agentRuns, run] };
        const saved = writeAnalysis(next, analysisFile);
        return json(res, 201, agentRunResponse(saved, run.id));
      }

      const agentRunMatch = /^\/api\/agent\/runs\/([a-z0-9][a-z0-9._-]{0,79})$/.exec(pathname);
      if (req.method === 'GET' && agentRunMatch) {
        const analysis = readAnalysis(analysisFile);
        const run = analysis.agentRuns.find((item) => item.id === agentRunMatch[1]);
        if (!run) throw new ContractError('未找到该智能体运行', 'AGENT_RUN_NOT_FOUND', 404);
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        const diagram = agentDiagram(catalog, run.diagramId);
        const activeDraftId = readState(diagram.statePath)[run.view].draft?.draftId || null;
        const details = requestUrl.searchParams.get('details');
        if (details && !['architecture-gate', 'contract-gate', 'review-gates', 'reconciliation'].includes(details)) {
          throw new ContractError('details 只支持 architecture-gate、contract-gate 或 review-gates', 'AGENT_REQUEST_INVALID', 400);
        }
        return json(res, 200, agentRunResponse(analysis, run.id, {
          activeDraftId,
          includeArchitectureGateDetails: ['architecture-gate', 'review-gates', 'reconciliation'].includes(details),
          includeContractGateDetails: ['contract-gate', 'review-gates'].includes(details),
        }));
      }

      const agentArtifactMatch = /^\/api\/agent\/runs\/([a-z0-9][a-z0-9._-]{0,79})\/artifacts$/.exec(pathname);
      if (req.method === 'POST' && agentArtifactMatch) {
        const incoming = await readJsonBody(req);
        const analysis = readAnalysis(analysisFile);
        const run = analysis.agentRuns.find((item) => item.id === agentArtifactMatch[1]);
        if (!run) throw new ContractError('未找到该智能体运行', 'AGENT_RUN_NOT_FOUND', 404);
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        const diagram = agentDiagram(catalog, run.diagramId);
        const result = submitAgentArtifact(analysis, run.id, incoming, {
          workspaceRoot,
          projectRoot,
          registry: readRegistry(documentsFile),
          catalog,
          diagram,
        });
        let saved = result.analysis;
        if (!result.replayed) {
          if (result.stateChanged) {
            try {
              writeState(result.state, diagram.statePath);
              afterAgentDraftStateWrite?.({ runId: run.id, diagramId: diagram.id });
              saved = writeAnalysis(result.analysis, analysisFile);
            } catch (error) {
              try {
                writeState(result.originalState, diagram.statePath);
              } catch (rollbackError) {
                throw new ContractError(
                  '智能体草稿写入未能完整提交，且自动回滚失败；请停止发布并检查本地状态',
                  'AGENT_DRAFT_TRANSACTION_ROLLBACK_FAILED',
                  500,
                  { cause: error.message, rollbackCause: rollbackError.message },
                );
              }
              throw error;
            }
          } else {
            saved = writeAnalysis(result.analysis, analysisFile);
          }
        }
        return json(res, result.replayed ? 200 : 201, {
          ...agentRunResponse(saved, run.id, {
            activeDraftId: result.state?.[run.view]?.draft?.draftId || null,
          }),
          submission: {
            artifactId: result.artifact.artifactId,
            artifactType: result.artifact.artifactType,
            proposalId: result.proposal?.id || null,
            draftApplication: clone(result.draftApplication),
            replayed: result.replayed,
            requiresHumanReview: result.artifact.artifactType === 'implementation-report',
            requiresPublication: Boolean(
              result.draftApplication
              && result.draftApplication.outcome !== 'reverted-to-published'
            ),
            reviewType: result.artifact.artifactType === 'implementation-report'
              ? 'implementation-result'
              : result.draftApplication?.outcome !== 'reverted-to-published' && result.draftApplication
                ? 'draft-publication'
                : null,
          },
        });
      }

      if (req.method === 'GET' && pathname === '/api/agent/approved-target') {
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        const diagram = agentDiagram(catalog, requestUrl.searchParams.get('diagram'));
        const lane = readState(diagram.statePath).target;
        const registry = readRegistry(documentsFile);
        const contract = lane.published.developmentContract;
        const { baselineStatus, formalBaseline, executionIssue } = publishedTargetBaseline(
          diagram.id,
          lane.published,
          registry,
          projectRoot,
        );
        return json(res, 200, {
          protocolVersion: AI_CODING_PROTOCOL_VERSION,
          diagramId: diagram.id,
          approvalStatus: 'published-target',
          baselineStatus,
          formalBaseline,
          architecture: compactAgentArchitecture(lane.published),
          developmentContract: compactDevelopmentContract(contract),
          executionIssue,
          agentCanPublish: false,
        });
      }

      if (req.method === 'GET' && pathname === '/api/analysis') {
        return json(res, 200, analysisResponse(readAnalysis(analysisFile)));
      }

      if (req.method === 'PUT' && pathname === '/api/analysis/sources') {
        throw new ContractError(
          '查看器不选择或扫描仓库文件；请由外部智能体提交结构化依据清单',
          'VIEWER_REPOSITORY_SCAN_REMOVED',
          410,
        );
      }

      if (req.method === 'POST' && pathname === '/api/analysis/scan') {
        throw new ContractError(
          '查看器不选择或扫描仓库文件；请由外部智能体提交结构化依据清单',
          'VIEWER_REPOSITORY_SCAN_REMOVED',
          410,
        );
      }

      if (req.method === 'POST' && pathname === '/api/analysis/proposals') {
        throw new ContractError(
          'v0.2 不再内嵌模型生成提案；请通过 MCP 或命令行创建智能体运行并提交工件',
          'EMBEDDED_MODEL_REMOVED',
          410,
        );
      }

      const implementationReviewMatch = /^\/api\/analysis\/runs\/([a-z0-9][a-z0-9._-]{0,79})\/review$/.exec(pathname);
      if (req.method === 'POST' && implementationReviewMatch) {
        const incoming = await readJsonBody(req);
        assertAnalysisRequestShape(incoming, new Set([
          'schemaVersion', 'baseRevision', 'userConfirmed', 'decision', 'note',
        ]));
        if (incoming.userConfirmed !== true) {
          throw new ContractError('实施结果验收必须由用户明确确认', 'USER_CONFIRMATION_REQUIRED', 403);
        }
        const analysis = readAnalysis(analysisFile);
        assertAnalysisRevision(incoming, analysis);
        const run = analysis.agentRuns.find((item) => item.id === implementationReviewMatch[1]);
        if (!run) throw new ContractError('未找到该智能体运行', 'AGENT_RUN_NOT_FOUND', 404);
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        const diagram = agentDiagram(catalog, run.diagramId);
        const state = readState(diagram.statePath);
        const next = reviewImplementationRun(analysis, run.id, incoming, state, {
          registry: readRegistry(documentsFile),
          projectRoot,
        });
        return json(res, 200, analysisResponse(writeAnalysis(next, analysisFile)));
      }

      const proposalActionMatch = /^\/api\/analysis\/proposals\/([a-z0-9][a-z0-9._-]{0,79})\/(accept|reject)$/.exec(pathname);
      if (req.method === 'POST' && proposalActionMatch) {
        throw new ContractError(
          '逐项提案审阅入口已停用；智能体变更只写入锁定草稿，用户通过发布完整草稿作最终确认',
          'PROPOSAL_REVIEW_RETIRED',
          410,
          { proposalId: proposalActionMatch[1], action: proposalActionMatch[2] },
        );
      }

      if (req.method === 'GET' && pathname === '/api/diagrams') {
        return json(res, 200, publicArchitectureCatalog(readArchitectureCatalog(catalogFile, stateFile, layoutFile)));
      }

      if (req.method === 'GET' && pathname === '/api/registered-flows') {
        const view = viewFrom(requestUrl);
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        const diagram = diagramFrom(requestUrl, catalog);
        return json(res, 200, readRegisteredFlows(registeredFlowsFile, {
          catalog,
          diagramId: diagram.id,
          view,
          readState,
        }));
      }

      if (req.method === 'GET' && pathname === '/api/state') {
        const view = viewFrom(requestUrl);
        const diagram = diagramFrom(requestUrl, readArchitectureCatalog(catalogFile, stateFile, layoutFile));
        return json(res, 200, responseState(readState(diagram.statePath), view, diagram.id));
      }

      if (req.method === 'GET' && pathname === '/api/layout') {
        const view = viewFrom(requestUrl);
        const diagram = diagramFrom(requestUrl, readArchitectureCatalog(catalogFile, stateFile, layoutFile));
        const state = readState(diagram.statePath);
        return json(res, 200, responseLayout(readLayout(diagram.layoutPath, state), view, diagram.id));
      }

      if (req.method === 'PUT' && pathname === '/api/layout') {
        const view = viewFrom(requestUrl);
        const incoming = await readJsonBody(req);
        const diagram = diagramFrom(requestUrl, readArchitectureCatalog(catalogFile, stateFile, layoutFile));
        const state = readState(diagram.statePath);
        const current = readLayout(diagram.layoutPath, state);
        let merged;
        try {
          merged = mergeLayout(current, state, view, incoming);
        } catch (error) {
          if (error instanceof LayoutContractError) {
            throw new ContractError(error.message, error.code, error.status, error.details);
          }
          throw error;
        }
        return json(res, 200, responseLayout(writeLayout(merged, diagram.layoutPath), view, diagram.id));
      }

      if (req.method === 'PUT' && pathname === '/api/draft') {
        const view = viewFrom(requestUrl);
        const incoming = await readJsonBody(req);
        validateDraftRequest(incoming, view);
        const diagram = diagramFrom(requestUrl, readArchitectureCatalog(catalogFile, stateFile, layoutFile));
        const state = readState(diagram.statePath);
        const lane = state[view];
        assertLaneLock(incoming, lane);
        const priorGraph = lane.draft ? lane.draft.graph : lane.published.graph;
        assertHumanConfirmedSemantics(state.meta, view, priorGraph, incoming.graph, incoming);
        const registry = readRegistry(documentsFile);
        validateNewDocumentBindings(priorGraph, incoming.graph, registry, projectRoot);
        const now = new Date().toISOString();
        const draftId = lane.draft ? lane.draft.draftId : newDraftId(view);
        const priorContract = view === 'target' ? editableDraftContractBase(lane) : null;
        lane.draft = {
          draftId,
          draftRevision: lane.draft ? lane.draft.draftRevision + 1 : 1,
          baseRevision: lane.published.revision,
          baseRevisionId: lane.published.revisionId,
          savedAt: now,
          graph: clone(incoming.graph),
          developmentContract: view === 'target'
            ? draftDevelopmentContract(incoming.graph, {
              draftId,
              prior: priorContract,
              registry,
              projectRoot,
            })
            : null,
        };
        return json(res, 200, responseState(writeState(state, diagram.statePath), view, diagram.id));
      }

      if (req.method === 'DELETE' && pathname === '/api/draft') {
        const view = viewFrom(requestUrl);
        const incoming = await readJsonBody(req);
        validateRevisionRequest(incoming);
        const diagram = diagramFrom(requestUrl, readArchitectureCatalog(catalogFile, stateFile, layoutFile));
        const state = readState(diagram.statePath);
        const lane = state[view];
        assertLaneLock(incoming, lane);
        if (!lane.draft) throw new ContractError('当前没有可丢弃的草案', 'NO_ACTIVE_DRAFT', 409);
        lane.draft = null;
        return json(res, 200, responseState(writeState(state, diagram.statePath), view, diagram.id));
      }

      if (req.method === 'POST' && pathname === '/api/draft/refresh-documents') {
        const view = viewFrom(requestUrl);
        if (view !== 'target') {
          throw new ContractError(
            '只有目标架构草稿可以刷新开发合同的绑定文档锁',
            'DRAFT_DOCUMENT_REFRESH_TARGET_ONLY',
            422,
          );
        }
        const incoming = await readJsonBody(req);
        validateRevisionRequest(incoming);
        const diagram = diagramFrom(requestUrl, readArchitectureCatalog(catalogFile, stateFile, layoutFile));
        const state = readState(diagram.statePath);
        const lane = state.target;
        assertLaneLock(incoming, lane);
        if (!lane.draft) throw new ContractError('当前没有可刷新的目标草案', 'NO_ACTIVE_DRAFT', 409);

        const registry = readRegistry(documentsFile);
        const refreshedContract = draftDevelopmentContract(lane.draft.graph, {
          draftId: lane.draft.draftId,
          prior: lane.draft.developmentContract,
          registry,
          projectRoot,
        });
        lane.draft = {
          ...lane.draft,
          draftRevision: lane.draft.draftRevision + 1,
          savedAt: new Date().toISOString(),
          developmentContract: refreshedContract,
        };
        return json(res, 200, responseState(writeState(state, diagram.statePath), view, diagram.id));
      }

      if (req.method === 'POST' && pathname === '/api/publish') {
        const view = viewFrom(requestUrl);
        const incoming = await readJsonBody(req);
        validateActionRequest(incoming);
        const diagram = diagramFrom(requestUrl, readArchitectureCatalog(catalogFile, stateFile, layoutFile));
        const state = readState(diagram.statePath);
        const lane = state[view];
        assertLaneLock(incoming, lane);
        if (!lane.draft) throw new ContractError('当前没有可发布的草案', 'NO_ACTIVE_DRAFT', 409);
        validateGraph(lane.draft.graph, view);
        const registry = view === 'target' ? readRegistry(documentsFile) : null;
        const verifiedDocuments = view === 'target'
          ? assertDraftBoundDocumentsCurrent(lane.draft.developmentContract, lane.draft.graph, registry, projectRoot)
          : null;
        const now = new Date().toISOString();
        const prior = clone(lane.published);
        lane.history.push(prior);
        const published = {
          revision: prior.revision + 1,
          revisionId: nextRevisionId(view, { published: prior }),
          parentRevisionId: prior.revisionId,
          origin: 'publish',
          restoredFromRevisionId: null,
          message: incoming.message.trim(),
          publishedAt: now,
          publishedBy: 'user',
          graph: clone(lane.draft.graph),
          developmentContract: null,
        };
        if (view === 'target') {
          published.developmentContract = freezeDevelopmentContract(
            lane.draft.developmentContract,
            published.graph,
            published,
            registry,
            projectRoot,
            now,
            verifiedDocuments,
          );
        }
        lane.published = published;
        lane.draft = null;
        return json(res, 200, responseState(writeState(state, diagram.statePath), view, diagram.id));
      }

      if (req.method === 'GET' && pathname === '/api/revisions') {
        const view = viewFrom(requestUrl);
        const diagram = diagramFrom(requestUrl, readArchitectureCatalog(catalogFile, stateFile, layoutFile));
        const state = readState(diagram.statePath);
        const lane = state[view];
        const revisions = allRevisions(lane).map((revision) => revisionSummary(revision, {
          isHead: revision.revisionId === lane.published.revisionId,
        })).reverse();
        return json(res, 200, {
          schemaVersion: SCHEMA_VERSION,
          diagramId: diagram.id,
          view,
          headRevisionId: lane.published.revisionId,
          revisions,
        });
      }

      if (req.method === 'GET' && pathname === '/api/revision') {
        const view = viewFrom(requestUrl);
        const diagram = diagramFrom(requestUrl, readArchitectureCatalog(catalogFile, stateFile, layoutFile));
        const revisionId = requestUrl.searchParams.get('id');
        if (!revisionId) throw new ContractError('必须提供 id', 'REVISION_ID_REQUIRED', 400);
        const revision = findRevision(readState(diagram.statePath)[view], revisionId);
        if (!revision) throw new ContractError('未找到指定历史版本', 'REVISION_NOT_FOUND', 404, { revisionId });
        return json(res, 200, { schemaVersion: SCHEMA_VERSION, diagramId: diagram.id, view, revision });
      }

      if (req.method === 'GET' && pathname === '/api/diff') {
        const view = viewFrom(requestUrl);
        const diagram = diagramFrom(requestUrl, readArchitectureCatalog(catalogFile, stateFile, layoutFile));
        const fromRef = requestUrl.searchParams.get('from');
        const toRef = requestUrl.searchParams.get('to');
        if (!fromRef || !toRef) throw new ContractError('必须提供 from 和 to', 'DIFF_REFERENCE_REQUIRED', 400);
        const lane = readState(diagram.statePath)[view];
        const from = resolveGraphReference(lane, fromRef);
        const to = resolveGraphReference(lane, toRef);
        return json(res, 200, {
          schemaVersion: SCHEMA_VERSION,
          diagramId: diagram.id,
          view,
          from: { ...from, graph: undefined },
          to: { ...to, graph: undefined },
          ...diffGraphs(from.graph, to.graph),
        });
      }

      if (req.method === 'POST' && pathname === '/api/restore') {
        const view = viewFrom(requestUrl);
        const incoming = await readJsonBody(req);
        validateActionRequest(incoming, { restore: true });
        const diagram = diagramFrom(requestUrl, readArchitectureCatalog(catalogFile, stateFile, layoutFile));
        const state = readState(diagram.statePath);
        const lane = state[view];
        assertLaneLock(incoming, lane);
        if (lane.draft) throw new ContractError('请先发布或丢弃当前草案，再恢复历史版本', 'ACTIVE_DRAFT', 409);
        const source = findRevision(lane, incoming.sourceRevisionId);
        if (!source) throw new ContractError('未找到要恢复的历史版本', 'REVISION_NOT_FOUND', 404, { revisionId: incoming.sourceRevisionId });
        const prior = clone(lane.published);
        lane.history.push(prior);
        const now = new Date().toISOString();
        const restored = {
          revision: prior.revision + 1,
          revisionId: nextRevisionId(view, { published: prior }),
          parentRevisionId: prior.revisionId,
          origin: 'restore',
          restoredFromRevisionId: source.revisionId,
          message: incoming.message.trim(),
          publishedAt: now,
          publishedBy: 'user',
          graph: clone(source.graph),
          developmentContract: null,
        };
        if (view === 'target') {
          restored.developmentContract = freezeDevelopmentContract(
            source.developmentContract,
            restored.graph,
            restored,
            readRegistry(documentsFile),
            projectRoot,
            now,
          );
        }
        lane.published = restored;
        return json(res, 200, responseState(writeState(state, diagram.statePath), view, diagram.id));
      }

      if (pathname === '/api/undo') {
        return json(res, 410, { error: '旧版 undo 已退役，请从版本历史中恢复并生成新版本', code: 'ENDPOINT_RETIRED' });
      }

      if (req.method === 'GET' && pathname === '/api/documents') {
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        return json(res, 200, enrichedRegistry(readRegistry(documentsFile), readDiagramStates(catalog), projectRoot));
      }

      const previewMatch = /^\/api\/documents\/([a-z0-9][a-z0-9._-]{0,79})\/preview$/.exec(pathname);
      if (req.method === 'GET' && previewMatch) {
        const registry = readRegistry(documentsFile);
        const document = registry.documents.find((item) => item.id === previewMatch[1]);
        if (!document) throw new ContractError('未找到文档', 'DOCUMENT_NOT_FOUND', 404);
        return json(res, 200, previewDocument(document, requestUrl.searchParams.get('section'), projectRoot));
      }

      const documentMatch = /^\/api\/documents\/([a-z0-9][a-z0-9._-]{0,79})$/.exec(pathname);
      if (req.method === 'GET' && documentMatch) {
        const registry = readRegistry(documentsFile);
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        const enriched = enrichedRegistry(registry, readDiagramStates(catalog), projectRoot);
        const document = enriched.documents.find((item) => item.id === documentMatch[1]);
        if (!document) throw new ContractError('未找到文档', 'DOCUMENT_NOT_FOUND', 404);
        return json(res, 200, { schemaVersion: DOCUMENT_SCHEMA_VERSION, baseRevision: registry.baseRevision, document });
      }

      if (req.method === 'POST' && pathname === '/api/documents') {
        const incoming = await readJsonBody(req);
        validateRegistryWriteRequest(incoming);
        const registry = readRegistry(documentsFile);
        assertRegistryRevision(incoming, registry);
        if (registry.documents.some((document) => document.id === incoming.document.id)) {
          throw new ContractError('文档 ID 已存在', 'DOCUMENT_ID_CONFLICT', 409);
        }
        if (registry.documents.some((document) => document.path.toLowerCase() === incoming.document.path.toLowerCase())) {
          throw new ContractError('文档路径已注册', 'DOCUMENT_PATH_CONFLICT', 409);
        }
        resolveSafeDocument(incoming.document.path, projectRoot);
        registry.documents.push({ ...clone(incoming.document), lastVerifiedAt: new Date().toISOString() });
        const saved = writeRegistry(registry, documentsFile);
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        return json(res, 201, enrichedRegistry(saved, readDiagramStates(catalog), projectRoot));
      }

      if (req.method === 'PUT' && documentMatch) {
        const incoming = await readJsonBody(req);
        validateRegistryWriteRequest(incoming);
        if (incoming.document.id !== documentMatch[1]) throw new ContractError('路径 ID 与文档 ID 不一致', 'DOCUMENT_ID_MISMATCH', 422);
        const registry = readRegistry(documentsFile);
        assertRegistryRevision(incoming, registry);
        const index = registry.documents.findIndex((document) => document.id === documentMatch[1]);
        if (index < 0) throw new ContractError('未找到文档', 'DOCUMENT_NOT_FOUND', 404);
        if (registry.documents.some((document, itemIndex) => itemIndex !== index && document.path.toLowerCase() === incoming.document.path.toLowerCase())) {
          throw new ContractError('文档路径已注册', 'DOCUMENT_PATH_CONFLICT', 409);
        }
        const existing = registry.documents[index];
        const pathChanged = existing.path !== incoming.document.path;
        const retainingUnavailableRecord = !pathChanged && ['archived', 'superseded'].includes(incoming.document.status);
        if (!retainingUnavailableRecord) resolveSafeDocument(incoming.document.path, projectRoot);
        registry.documents[index] = {
          ...clone(incoming.document),
          lastVerifiedAt: retainingUnavailableRecord ? existing.lastVerifiedAt : new Date().toISOString(),
        };
        const saved = writeRegistry(registry, documentsFile);
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        return json(res, 200, enrichedRegistry(saved, readDiagramStates(catalog), projectRoot));
      }

      if (req.method === 'DELETE' && documentMatch) {
        const incoming = await readJsonBody(req);
        validateRegistryDeleteRequest(incoming);
        const registry = readRegistry(documentsFile);
        assertRegistryRevision(incoming, registry);
        const index = registry.documents.findIndex((document) => document.id === documentMatch[1]);
        if (index < 0) throw new ContractError('未找到文档', 'DOCUMENT_NOT_FOUND', 404);
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        const references = referenceContexts(readDiagramStates(catalog)).filter((context) => context.documentId === documentMatch[1]);
        if (references.length) {
          throw new ContractError('被正式、草案或历史架构引用的文档不能硬删除；请改为归档', 'DOCUMENT_REFERENCED', 409, { references });
        }
        const supersedingDocuments = registry.documents
          .filter((document) => document.supersedes === documentMatch[1])
          .map((document) => document.id);
        if (supersedingDocuments.length) {
          throw new ContractError('被其他登记项作为替代来源引用的文档不能硬删除；请改为归档', 'DOCUMENT_REFERENCED', 409, {
            supersedingDocuments,
          });
        }
        registry.documents.splice(index, 1);
        return json(res, 200, enrichedRegistry(writeRegistry(registry, documentsFile), readDiagramStates(catalog), projectRoot));
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/api/')) {
        if (serveFile(req, res, staticRoot, pathname)) return;
      }
      return json(res, 404, { error: '未找到页面或接口', code: 'NOT_FOUND' });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      const code = error.code || 'INTERNAL_ERROR';
      const message = status === 500 && !(error instanceof ContractError) ? '本地服务发生错误' : error.message;
      const payload = { error: message, code };
      if (error.details !== undefined) payload.details = error.details;
      return json(res, status, payload);
    }
  });
}

if (require.main === module) {
  const port = parsePort(process.env.PORT);
  const projectRoot = resolveProjectDirectory();
  const workspaceRoot = resolveWorkspaceRoot(undefined, projectRoot);
  const stateFile = resolveStateFile(undefined, projectRoot);
  const documentsFile = resolveDocumentsFile(undefined, projectRoot);
  const layoutFile = resolveLayoutFile(undefined, projectRoot);
  const configFile = resolveConfigFile(undefined, projectRoot);
  const catalogFile = process.env.CATALOG_FILE
    ? resolveCatalogFile(undefined, projectRoot)
    : (process.env.STATE_FILE || process.env.LAYOUT_FILE
      ? path.join(path.dirname(stateFile), PROJECT_FILES.catalog)
      : resolveCatalogFile(undefined, projectRoot));
  const config = readViewerConfig(configFile);
  const server = createServer({ stateFile, documentsFile, layoutFile, configFile, catalogFile, projectRoot, workspaceRoot });
  server.listen(port, HOST, () => {
    const address = server.address();
    console.log(`${config.projectName} ${resolvedConfigText(config.viewerName, config.defaultLanguage || 'zh')}：http://${HOST}:${address.port}`);
    console.log(`状态文件：${stateFile}`);
    console.log(`文档注册表：${documentsFile}`);
    console.log(`查看器排版：${layoutFile}`);
    console.log(`项目配置：${configFile}`);
    console.log(`架构目录：${catalogFile}`);
    console.log(`项目文档根目录：${projectRoot}`);
    console.log(`待检查代码仓库：${workspaceRoot}`);
  });
}

module.exports = {
  CATALOG_SCHEMA_VERSION,
  HOST,
  LAYOUT_SCHEMA_VERSION,
  PROJECTS_ROOT,
  SCHEMA_VERSION,
  createServer,
  diffGraphs,
  enrichedRegistry,
  parsePort,
  previewDocument,
  publicArchitectureCatalog,
  readArchitectureCatalog,
  readLayout,
  readRegistry,
  readState,
  readViewerConfig,
  referenceContexts,
  resolveDocumentsFile,
  resolveCatalogFile,
  resolveConfigFile,
  resolveLayoutFile,
  resolveProjectDirectory,
  resolveWorkspaceRoot,
  resolveSafeDocument,
  resolveStateFile,
  resolveStaticRoot,
  responseState,
  responseLayout,
  serveFile,
  validateNewDocumentBindings,
  writeRegistry,
  writeLayout,
  writeState,
};
