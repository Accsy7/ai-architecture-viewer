'use strict';

const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  ContractError,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
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
  ANALYSIS_SCHEMA_VERSION,
  createEmptyAnalysis,
  validateAnalysis,
} = require('./schema/analysis-contract.cjs');
const {
  AnalysisSourceError,
  collectEvidence,
  listAvailableAnalysisSources,
  readAnalysisSource,
} = require('./analysis-sources.cjs');
const {
  AnalysisProviderError,
  createDeepSeekProvider,
} = require('./analysis-provider.cjs');
const { readSkillCatalog } = require('./skill-catalog.cjs');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8800;
const ROOT = __dirname;
const PROJECTS_ROOT = path.join(ROOT, 'projects');
const PROJECT_MANIFEST_FILE = 'project.json';
const PROJECT_FILES = Object.freeze({
  state: 'state.json',
  documents: 'document-registry.json',
  layout: 'viewer-layout.json',
  config: 'viewer.config.json',
  catalog: 'architecture-catalog.json',
  analysis: 'analysis.json',
});
const VIEWER_CONFIG_SCHEMA_VERSION = '1.0.0';
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

function resolveAnalysisFile(value = process.env.ANALYSIS_FILE, projectDirectory = resolveProjectDirectory()) {
  return resolveProjectFile(value, projectDirectory, PROJECT_FILES.analysis);
}

function requiredConfigText(value, field, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new ContractError(`查看器配置 ${field} 无效`, 'VIEWER_CONFIG_INVALID', 500, { field });
  }
  return value.trim();
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
    };
  });
  const defaultFocusNodeId = raw.defaultFocusNodeId === null || raw.defaultFocusNodeId === undefined
    ? null
    : requiredConfigText(raw.defaultFocusNodeId, 'defaultFocusNodeId', 120);
  return {
    schemaVersion: VIEWER_CONFIG_SCHEMA_VERSION,
    projectId,
    projectName: requiredConfigText(raw.projectName, 'projectName', 80),
    viewerName: requiredConfigText(raw.viewerName, 'viewerName', 80),
    eyebrow: requiredConfigText(raw.eyebrow, 'eyebrow', 120),
    scopeNote: requiredConfigText(raw.scopeNote, 'scopeNote', 320),
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
    const analysis = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
    validateAnalysis(analysis);
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
  return ids;
}

function assertProposalEvidenceCurrent(proposal, analysis, projectRoot) {
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
    try {
      if (readAnalysisSource(source.path, projectRoot).contentHash !== evidence.contentHash) {
        staleEvidenceIds.push(evidenceId);
      }
    } catch {
      staleEvidenceIds.push(evidenceId);
    }
  });
  if (staleEvidenceIds.length) {
    throw new ContractError('提案引用的资料已变化，请重新扫描并生成新提案', 'PROPOSAL_EVIDENCE_STALE', 409, {
      evidenceIds: staleEvidenceIds,
    });
  }
}

function analysisResponse(analysis, projectRoot, analysisProvider) {
  const discovered = listAvailableAnalysisSources(projectRoot);
  const discoveredByPath = new Map(discovered.map((source) => [source.path, source]));
  const existingByPath = new Map(analysis.sources.map((source) => [source.path, source]));
  const evidenceBySource = new Map();
  analysis.evidence.forEach((evidence) => {
    evidenceBySource.set(evidence.sourceId, (evidenceBySource.get(evidence.sourceId) || 0) + 1);
  });
  const sources = discovered.map((candidate) => {
    const existing = existingByPath.get(candidate.path);
    const source = existing ? {
      ...candidate,
      id: existing.id,
      label: existing.label,
      selected: existing.selected,
      lastScannedAt: existing.lastScannedAt,
      contentHash: existing.contentHash,
      sizeBytes: existing.sizeBytes,
    } : candidate;
    return {
      ...source,
      evidenceCount: evidenceBySource.get(source.id) || 0,
      status: source.selected ? (source.lastScannedAt ? 'ready' : 'stale') : 'ignored',
    };
  });
  analysis.sources.forEach((source) => {
    if (discoveredByPath.has(source.path)) return;
    sources.push({
      ...clone(source),
      evidenceCount: evidenceBySource.get(source.id) || 0,
      status: 'failed',
    });
  });
  const evidenceById = new Map(analysis.evidence.map((evidence) => [evidence.id, evidence]));
  const proposals = analysis.proposals.map((proposal) => ({
    ...clone(proposal),
    evidence: [...proposalEvidenceIds(proposal)].map((id) => evidenceById.get(id)).filter(Boolean).map(clone),
    changeCount: proposal.changes.length,
    evidenceCount: proposalEvidenceIds(proposal).size,
  }));
  const provider = typeof analysisProvider?.describe === 'function'
    ? analysisProvider.describe()
    : { provider: 'deepseek', configured: false, model: null };
  return {
    schemaVersion: analysis.schemaVersion,
    baseRevision: analysis.baseRevision,
    lastUpdated: analysis.lastUpdated,
    sources,
    evidence: clone(analysis.evidence),
    proposals,
    provider,
  };
}

function selectionRequestSources(incoming, analysis, projectRoot) {
  if (!Array.isArray(incoming.sources)) {
    throw new ContractError('分析资料列表必须是数组', 'ANALYSIS_REQUEST_INVALID', 400);
  }
  const discovered = listAvailableAnalysisSources(projectRoot);
  const discoveredByPath = new Map(discovered.map((source) => [source.path, source]));
  const existingByPath = new Map(analysis.sources.map((source) => [source.path, source]));
  const requested = new Map();
  incoming.sources.forEach((source, index) => {
    if (!isPlainObject(source) || typeof source.path !== 'string' || typeof source.selected !== 'boolean') {
      throw new ContractError(`分析资料[${index}]必须提供 path 和 selected`, 'ANALYSIS_REQUEST_INVALID', 400);
    }
    if (requested.has(source.path)) {
      throw new ContractError(`分析资料路径重复：${source.path}`, 'ANALYSIS_REQUEST_INVALID', 400);
    }
    if (!discoveredByPath.has(source.path)) {
      throw new ContractError('只能选择项目内可安全读取的资料文件', 'ANALYSIS_SOURCE_NOT_AVAILABLE', 422, { path: source.path });
    }
    requested.set(source.path, source.selected);
  });
  const evidenceSourceIds = new Set(analysis.evidence.map((evidence) => evidence.sourceId));
  const next = discovered.map((candidate) => {
    const existing = existingByPath.get(candidate.path);
    return {
      ...candidate,
      id: existing?.id || candidate.id,
      label: existing?.label || candidate.label,
      selected: requested.has(candidate.path) ? requested.get(candidate.path) : Boolean(existing?.selected),
      lastScannedAt: existing?.lastScannedAt || null,
      contentHash: existing?.contentHash || null,
      sizeBytes: existing?.sizeBytes ?? null,
    };
  });
  analysis.sources.forEach((source) => {
    if (discoveredByPath.has(source.path) || !evidenceSourceIds.has(source.id)) return;
    next.push({ ...clone(source), selected: false });
  });
  return next;
}

function scanSelectedAnalysisSources(analysis, projectRoot, now = new Date().toISOString()) {
  const selectedSources = analysis.sources.filter((source) => source.selected);
  if (!selectedSources.length) {
    throw new ContractError('请先选择至少一份资料再分析', 'ANALYSIS_SOURCE_REQUIRED', 422);
  }
  const selectedIds = new Set(selectedSources.map((source) => source.id));
  const referencedEvidence = new Set();
  analysis.proposals.forEach((proposal) => proposalEvidenceIds(proposal).forEach((id) => referencedEvidence.add(id)));
  const nextSources = analysis.sources.map((source) => {
    if (!selectedIds.has(source.id)) return clone(source);
    const material = readAnalysisSource(source.path, projectRoot);
    return {
      ...clone(source),
      lastScannedAt: now,
      contentHash: material.contentHash,
      sizeBytes: material.stats.size,
    };
  });
  const sourcesById = new Map(nextSources.map((source) => [source.id, source]));
  const retainedEvidence = analysis.evidence.filter((evidence) => (
    !selectedIds.has(evidence.sourceId) || referencedEvidence.has(evidence.id)
  )).map(clone);
  const evidenceById = new Map(retainedEvidence.map((evidence) => [evidence.id, evidence]));
  selectedSources.forEach((source) => {
    const material = readAnalysisSource(source.path, projectRoot);
    const current = sourcesById.get(source.id);
    collectEvidence({
      id: current.id,
      path: current.path,
      content: material.content,
      contentHash: material.contentHash,
    }, now).forEach((evidence) => evidenceById.set(evidence.id, evidence));
  });
  const next = {
    ...clone(analysis),
    sources: nextSources,
    evidence: [...evidenceById.values()],
  };
  validateAnalysis(next);
  return next;
}

function modelOutputError() {
  return new ContractError('AI 返回的提案未通过安全校验，请补充资料后重试', 'AI_OUTPUT_INVALID', 502);
}

function assertModelObject(value, allowedKeys) {
  if (!isPlainObject(value)) throw modelOutputError();
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw modelOutputError();
}

function normalizeGeneratedProposals(result, analysis, { diagramId, view, lane, now = new Date().toISOString() }) {
  try {
    assertModelObject(result, new Set(['proposals']));
    if (!Array.isArray(result.proposals) || result.proposals.length > 5) {
      throw modelOutputError();
    }
    const proposals = result.proposals.map((candidate) => {
      assertModelObject(candidate, new Set(['title', 'summary', 'confidence', 'evidenceIds', 'changes']));
      if (!Array.isArray(candidate.changes) || !candidate.changes.length) throw modelOutputError();
      return {
        id: `proposal-${crypto.randomUUID().toLowerCase()}`,
        status: 'pending',
        view,
        diagramId,
        baseRevision: lane.published.revision,
        baseRevisionId: lane.published.revisionId,
        title: candidate.title,
        summary: candidate.summary,
        confidence: candidate.confidence,
        createdAt: now,
        reviewedAt: null,
        evidenceIds: clone(candidate.evidenceIds),
        changes: candidate.changes.map((change) => {
          assertModelObject(change, new Set(['kind', 'targetType', 'targetId', 'summary', 'evidenceIds', 'patch']));
          return {
            id: `change-${crypto.randomUUID().toLowerCase()}`,
            kind: change.kind,
            targetType: change.targetType,
            targetId: change.targetId,
            summary: change.summary,
            evidenceIds: clone(change.evidenceIds),
            patch: change.patch === null ? null : clone(change.patch),
          };
        }),
        application: null,
      };
    });
    validateAnalysis({ ...clone(analysis), proposals: [...analysis.proposals, ...proposals] });
    return proposals;
  } catch (error) {
    if (error instanceof ContractError && error.code === 'AI_OUTPUT_INVALID') throw error;
    throw modelOutputError();
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
        next.nodes.push({
          id: change.targetId,
          type: NODE_TYPE,
          position: generatedNodePosition(next, generatedIndex++),
          width: DEFAULT_NODE_WIDTH,
          height: DEFAULT_NODE_HEIGHT,
          data: {
            ...clone(change.patch.data),
            group: sourceGroupForGeneratedNode(next, proposal, change.targetId, state),
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
      next.nodes = next.nodes.map((node) => node.id === change.targetId ? {
        ...node,
        data: { ...node.data, ...clone(change.patch.data) },
      } : node);
      return;
    }

    if (change.kind === 'add') {
      if (edges.has(change.targetId)) {
        throw new ContractError('提案新增的关系已存在，请刷新后重新审阅', 'PROPOSAL_TARGET_CONFLICT', 409, { targetId: change.targetId });
      }
      if (!nodes.has(change.patch.source) || !nodes.has(change.patch.target)) {
        throw new ContractError('新增关系引用的节点不存在', 'PROPOSAL_EDGE_NODE_MISSING', 422, { targetId: change.targetId });
      }
      next.edges.push({
        id: change.targetId,
        source: change.patch.source,
        target: change.patch.target,
        data: {
          ...clone(change.patch.data),
          controlledBoundaryPosture: 'none',
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
      return {
        ...edge,
        data: { ...edge.data, ...clone(change.patch.data || {}) },
      };
    });
  });
  validateGraph(next, proposal.view);
  return next;
}

function analysisModelInput({ diagram, view, lane, analysis }) {
  const selectedSources = analysis.sources.filter((source) => source.selected && source.lastScannedAt && source.contentHash);
  const selectedSourceIds = new Set(selectedSources.map((source) => source.id));
  const evidence = analysis.evidence.filter((item) => {
    const source = selectedSources.find((candidate) => candidate.id === item.sourceId);
    return selectedSourceIds.has(item.sourceId) && source?.contentHash === item.contentHash;
  }).slice(0, 64);
  if (!evidence.length) {
    throw new ContractError('请先扫描已选资料，再生成 AI 提案', 'ANALYSIS_EVIDENCE_REQUIRED', 422);
  }
  return {
    task: 'architecture-governance-proposal',
    diagram: { id: diagram.id, title: diagram.title, description: diagram.description },
    view,
    published: {
      revision: lane.published.revision,
      revisionId: lane.published.revisionId,
      graph: clone(lane.published.graph),
    },
    sources: selectedSources.map((source) => ({
      id: source.id,
      path: source.path,
      label: source.label,
      contentHash: source.contentHash,
    })),
    evidence: evidence.map(clone),
  };
}

async function generateWithSafeProvider(analysisProvider, input) {
  try {
    return await analysisProvider.generate(input);
  } catch (error) {
    if (error instanceof AnalysisProviderError) throw error;
    if (error?.code === 'AI_PROVIDER_NOT_CONFIGURED') {
      throw new AnalysisProviderError('尚未配置 AI 服务密钥', 'AI_PROVIDER_NOT_CONFIGURED', 503);
    }
    if (error?.code === 'AI_PROVIDER_UNAVAILABLE') {
      throw new AnalysisProviderError('AI 服务暂时不可访问，请稍后重试', 'AI_PROVIDER_UNAVAILABLE', 502);
    }
    throw new AnalysisProviderError('AI 服务暂时无法生成提案，请稍后重试', 'AI_PROVIDER_FAILED', 502);
  }
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

function previewDocument(document, section, projectRoot = resolveProjectDirectory()) {
  const { absolutePath, stats } = resolveSafeDocument(document.path, projectRoot);
  let fullContent;
  try {
    fullContent = fs.readFileSync(absolutePath, 'utf8');
  } catch {
    throw new ContractError('无法读取文档正文', 'DOCUMENT_UNREADABLE', 422, { path: document.path });
  }
  const scoped = extractSection(fullContent, section);
  const scopedBuffer = Buffer.from(scoped, 'utf8');
  const truncated = scopedBuffer.length > MAX_PREVIEW_BYTES;
  const content = truncated
    ? scopedBuffer.subarray(0, MAX_PREVIEW_BYTES).toString('utf8').replace(/\uFFFD$/, '')
    : scoped;
  return {
    documentId: document.id,
    path: document.path,
    section: section || null,
    content,
    truncated,
    sizeBytes: stats.size,
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
  const stateFile = resolveStateFile(options.stateFile, projectRoot);
  const documentsFile = resolveDocumentsFile(options.documentsFile, projectRoot);
  const layoutFile = resolveLayoutFile(options.layoutFile, projectRoot);
  const configFile = resolveConfigFile(options.configFile, projectRoot);
  const catalogFile = options.catalogFile !== undefined
    ? resolveCatalogFile(options.catalogFile, projectRoot)
    : (options.stateFile || options.layoutFile
      ? path.join(path.dirname(stateFile), PROJECT_FILES.catalog)
      : resolveCatalogFile(undefined, projectRoot));
  const analysisFile = options.analysisFile !== undefined
    ? resolveAnalysisFile(options.analysisFile, projectRoot)
    : (options.stateFile || options.layoutFile
      ? path.join(path.dirname(stateFile), PROJECT_FILES.analysis)
      : resolveAnalysisFile(undefined, projectRoot));
  const analysisProvider = options.analysisProvider || createDeepSeekProvider(options.analysisProviderOptions);
  const staticRoot = resolveStaticRoot(options.staticRoot || process.env.STATIC_ROOT);
  const skillsRoot = path.resolve(options.skillsRoot || path.join(ROOT, 'skills'));

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

      if (req.method === 'GET' && pathname === '/api/analysis') {
        return json(res, 200, analysisResponse(readAnalysis(analysisFile), projectRoot, analysisProvider));
      }

      if (req.method === 'PUT' && pathname === '/api/analysis/sources') {
        const incoming = await readJsonBody(req);
        assertAnalysisRequestShape(incoming, new Set(['schemaVersion', 'baseRevision', 'sources']));
        const analysis = readAnalysis(analysisFile);
        assertAnalysisRevision(incoming, analysis);
        const next = {
          ...clone(analysis),
          sources: selectionRequestSources(incoming, analysis, projectRoot),
        };
        return json(res, 200, analysisResponse(writeAnalysis(next, analysisFile), projectRoot, analysisProvider));
      }

      if (req.method === 'POST' && pathname === '/api/analysis/scan') {
        const incoming = await readJsonBody(req);
        assertAnalysisRequestShape(incoming, new Set(['schemaVersion', 'baseRevision']));
        const analysis = readAnalysis(analysisFile);
        assertAnalysisRevision(incoming, analysis);
        const next = scanSelectedAnalysisSources(analysis, projectRoot);
        return json(res, 200, analysisResponse(writeAnalysis(next, analysisFile), projectRoot, analysisProvider));
      }

      if (req.method === 'POST' && pathname === '/api/analysis/proposals') {
        const incoming = await readJsonBody(req);
        assertAnalysisRequestShape(incoming, new Set(['schemaVersion', 'baseRevision']));
        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        const diagram = diagramFrom(requestUrl, catalog);
        const view = viewFrom(requestUrl);
        const analysis = readAnalysis(analysisFile);
        assertAnalysisRevision(incoming, analysis);
        const state = readState(diagram.statePath);
        const lane = state[view];
        if (lane.draft) {
          throw new ContractError('请先发布或丢弃当前草案，再生成新的 AI 提案', 'ACTIVE_DRAFT', 409);
        }
        const input = analysisModelInput({ diagram, view, lane, analysis });
        if (!analysisProvider || typeof analysisProvider.generate !== 'function') {
          throw new AnalysisProviderError('当前未配置可用的 AI 服务', 'AI_PROVIDER_NOT_CONFIGURED', 503);
        }
        const generated = await generateWithSafeProvider(analysisProvider, input);
        const currentAnalysis = readAnalysis(analysisFile);
        const currentLane = readState(diagram.statePath)[view];
        if (
          currentAnalysis.baseRevision !== analysis.baseRevision
          || currentLane.published.revision !== lane.published.revision
          || currentLane.published.revisionId !== lane.published.revisionId
          || currentLane.draft
        ) {
          throw new ContractError('分析资料或架构基线已经变化，请刷新后重试', 'STALE_ANALYSIS_CONTEXT', 409);
        }
        const proposals = normalizeGeneratedProposals(generated, currentAnalysis, {
          diagramId: diagram.id,
          view,
          lane: currentLane,
        });
        if (!proposals.length) {
          return json(res, 200, {
            ...analysisResponse(currentAnalysis, projectRoot, analysisProvider),
            generation: { proposalCount: 0 },
          });
        }
        const next = { ...clone(currentAnalysis), proposals: [...currentAnalysis.proposals, ...proposals] };
        return json(res, 201, {
          ...analysisResponse(writeAnalysis(next, analysisFile), projectRoot, analysisProvider),
          generation: { proposalCount: proposals.length },
        });
      }

      const proposalActionMatch = /^\/api\/analysis\/proposals\/([a-z0-9][a-z0-9._-]{0,79})\/(accept|reject)$/.exec(pathname);
      if (req.method === 'POST' && proposalActionMatch) {
        const incoming = await readJsonBody(req);
        assertAnalysisRequestShape(incoming, new Set(['schemaVersion', 'baseRevision', 'userConfirmed']));
        if (incoming.userConfirmed !== true) {
          throw new ContractError('提案审阅必须由用户明确确认', 'USER_CONFIRMATION_REQUIRED', 403);
        }
        const analysis = readAnalysis(analysisFile);
        assertAnalysisRevision(incoming, analysis);
        const proposal = analysis.proposals.find((item) => item.id === proposalActionMatch[1]);
        if (!proposal) throw new ContractError('未找到该 AI 提案', 'PROPOSAL_NOT_FOUND', 404);
        if (proposal.status !== 'pending') {
          throw new ContractError('该 AI 提案已经审阅，不能重复处理', 'PROPOSAL_ALREADY_REVIEWED', 409);
        }
        const now = new Date().toISOString();
        const action = proposalActionMatch[2];
        if (action === 'reject') {
          const next = clone(analysis);
          const target = next.proposals.find((item) => item.id === proposal.id);
          target.status = 'rejected';
          target.reviewedAt = now;
          target.application = null;
          return json(res, 200, analysisResponse(writeAnalysis(next, analysisFile), projectRoot, analysisProvider));
        }

        const catalog = readArchitectureCatalog(catalogFile, stateFile, layoutFile);
        const diagram = catalog.diagrams.find((item) => item.id === proposal.diagramId);
        if (!diagram) throw new ContractError('提案对应的架构图已不存在', 'DIAGRAM_NOT_FOUND', 404, { diagramId: proposal.diagramId });
        const state = readState(diagram.statePath);
        const lane = state[proposal.view];
        if (lane.draft) {
          throw new ContractError('请先处理当前草案，再接受新的 AI 提案', 'ACTIVE_DRAFT', 409);
        }
        if (lane.published.revision !== proposal.baseRevision || lane.published.revisionId !== proposal.baseRevisionId) {
          throw new ContractError('提案的架构基线已过期，请重新分析后再审阅', 'PROPOSAL_STALE', 409, {
            headRevision: lane.published.revision,
            headRevisionId: lane.published.revisionId,
          });
        }
        assertProposalEvidenceCurrent(proposal, analysis, projectRoot);
        const graph = applyProposalChanges(lane.published.graph, proposal, state);
        assertHumanConfirmedSemantics(state.meta, proposal.view, lane.published.graph, graph, {
          userConfirmedSemanticOverride: true,
        });
        const draftId = newDraftId(proposal.view);
        lane.draft = {
          draftId,
          draftRevision: 1,
          baseRevision: lane.published.revision,
          baseRevisionId: lane.published.revisionId,
          savedAt: now,
          graph,
        };
        const next = clone(analysis);
        const target = next.proposals.find((item) => item.id === proposal.id);
        target.status = 'accepted';
        target.reviewedAt = now;
        target.application = { draftId, draftRevision: 1, appliedAt: now };
        validateAnalysis(next);
        const savedState = writeState(state, diagram.statePath);
        const savedAnalysis = writeAnalysis(next, analysisFile);
        return json(res, 200, {
          analysis: analysisResponse(savedAnalysis, projectRoot, analysisProvider),
          lane: responseState(savedState, proposal.view, diagram.id),
        });
      }

      if (req.method === 'GET' && pathname === '/api/diagrams') {
        return json(res, 200, publicArchitectureCatalog(readArchitectureCatalog(catalogFile, stateFile, layoutFile)));
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
        lane.draft = {
          draftId: lane.draft ? lane.draft.draftId : newDraftId(view),
          draftRevision: lane.draft ? lane.draft.draftRevision + 1 : 1,
          baseRevision: lane.published.revision,
          baseRevisionId: lane.published.revisionId,
          savedAt: now,
          graph: clone(incoming.graph),
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
        const now = new Date().toISOString();
        const prior = clone(lane.published);
        lane.history.push(prior);
        lane.published = {
          revision: prior.revision + 1,
          revisionId: nextRevisionId(view, { published: prior }),
          parentRevisionId: prior.revisionId,
          origin: 'publish',
          restoredFromRevisionId: null,
          message: incoming.message.trim(),
          publishedAt: now,
          publishedBy: 'user',
          graph: clone(lane.draft.graph),
        };
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
        lane.published = {
          revision: prior.revision + 1,
          revisionId: nextRevisionId(view, { published: prior }),
          parentRevisionId: prior.revisionId,
          origin: 'restore',
          restoredFromRevisionId: source.revisionId,
          message: incoming.message.trim(),
          publishedAt: new Date().toISOString(),
          publishedBy: 'user',
          graph: clone(source.graph),
        };
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
  const server = createServer({ stateFile, documentsFile, layoutFile, configFile, catalogFile, projectRoot });
  server.listen(port, HOST, () => {
    const address = server.address();
    console.log(`${config.projectName} ${config.viewerName}：http://${HOST}:${address.port}`);
    console.log(`状态文件：${stateFile}`);
    console.log(`文档注册表：${documentsFile}`);
    console.log(`查看器排版：${layoutFile}`);
    console.log(`项目配置：${configFile}`);
    console.log(`架构目录：${catalogFile}`);
    console.log(`项目文档根目录：${projectRoot}`);
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
