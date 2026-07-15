'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_ANALYSIS_SOURCE_BYTES = 256 * 1024;
const MAX_ANALYSIS_SOURCE_COUNT = 80;
const MAX_EVIDENCE_PER_SOURCE = 8;
const MAX_EVIDENCE_EXCERPT_CHARS = 1800;
const SOURCE_CODE_EXTENSIONS = new Set([
  '.c', '.cc', '.cjs', '.cpp', '.cs', '.css', '.go', '.graphql', '.gql', '.h', '.hpp',
  '.html', '.java', '.js', '.jsx', '.kt', '.kts', '.mjs', '.php', '.py', '.rb', '.rs',
  '.sh', '.sql', '.svelte', '.swift', '.ts', '.tsx', '.vue', '.xml',
]);
const ALLOWED_EXTENSIONS = new Set([
  '.json', '.md', '.markdown', '.toml', '.txt', '.yaml', '.yml',
  ...SOURCE_CODE_EXTENSIONS,
]);
const SKIPPED_DIRECTORIES = new Set(['.git', '.next', '.turbo', 'build', 'coverage', 'dist', 'node_modules']);
const SENSITIVE_SOURCE_DIRECTORIES = new Set(['.env', '.ssh', 'credential', 'credentials', 'key', 'keys', 'private', 'secret', 'secrets']);
const RESERVED_SOURCE_FILES = new Set([
  'analysis.json',
  'architecture-catalog.json',
  'document-registry.json',
  'project.json',
  'state.json',
  'viewer-layout.json',
]);

class AnalysisSourceError extends Error {
  constructor(message, code = 'ANALYSIS_SOURCE_INVALID', status = 422, details) {
    super(message);
    this.name = 'AnalysisSourceError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
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

function stableHash(value, length = 16) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, length);
}

function sourceIdForPath(sourcePath) {
  return `source-${stableHash(sourcePath.toLowerCase())}`;
}

function contentHash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function normalizedSourcePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 240) {
    throw new AnalysisSourceError('资料路径无效', 'ANALYSIS_SOURCE_PATH_INVALID', 422);
  }
  const sourcePath = value.trim();
  if (sourcePath.includes('\\') || sourcePath.includes('\0') || path.isAbsolute(sourcePath)) {
    throw new AnalysisSourceError('资料路径必须是项目内的正斜杠相对路径', 'ANALYSIS_SOURCE_PATH_INVALID', 422);
  }
  const segments = sourcePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new AnalysisSourceError('资料路径不能包含空段或上级目录', 'ANALYSIS_SOURCE_PATH_INVALID', 422);
  }
  return segments.join('/');
}

function isSensitiveName(fileName) {
  const lower = fileName.toLowerCase();
  return lower === '.env'
    || lower.startsWith('.env.')
    || /(^|[._-])(secret|credential|password|token|private)([._-]|$)/.test(lower)
    || /\.(cer|crt|der|key|p12|pfx|pem)$/i.test(lower);
}

function isLockFile(fileName) {
  const lower = fileName.toLowerCase();
  return lower === 'package-lock.json'
    || lower === 'npm-shrinkwrap.json'
    || lower === 'pnpm-lock.yaml'
    || lower === 'yarn.lock'
    || lower === 'bun.lockb';
}

function isAllowedAnalysisSourcePath(sourcePath) {
  const normalized = normalizedSourcePath(sourcePath);
  const segments = normalized.toLowerCase().split('/');
  const fileName = segments.at(-1);
  if (segments.slice(0, -1).some((segment) => SENSITIVE_SOURCE_DIRECTORIES.has(segment))) return false;
  if (RESERVED_SOURCE_FILES.has(fileName.toLowerCase()) || isSensitiveName(fileName) || isLockFile(fileName)) return false;
  return ALLOWED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function sourceTypeForPath(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  if (extension === '.json') return 'json';
  if (extension === '.yaml' || extension === '.yml') return 'yaml';
  if (extension === '.toml') return 'toml';
  if (SOURCE_CODE_EXTENSIONS.has(extension)) return 'source-code';
  return 'text';
}

function sourceLabelForPath(sourcePath) {
  return sourcePath.split('/').at(-1).replace(/\.[^.]+$/, '') || sourcePath;
}

function resolveSafeAnalysisSource(sourcePath, projectRoot) {
  const relativePath = normalizedSourcePath(sourcePath);
  if (!isAllowedAnalysisSourcePath(relativePath)) {
    throw new AnalysisSourceError('该文件类型不能作为架构证据', 'ANALYSIS_SOURCE_NOT_ALLOWED', 422, { path: relativePath });
  }
  const root = path.resolve(projectRoot);
  let rootReal;
  try {
    rootReal = normalizedRealPath(root);
  } catch {
    throw new AnalysisSourceError('无法解析项目资料根目录', 'ANALYSIS_SOURCE_ROOT_UNAVAILABLE', 500);
  }

  let cursor = root;
  for (const segment of relativePath.split('/')) {
    cursor = path.join(cursor, segment);
    let stats;
    try {
      stats = fs.lstatSync(cursor);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new AnalysisSourceError('资料文件不存在', 'ANALYSIS_SOURCE_MISSING', 422, { path: relativePath });
      }
      throw new AnalysisSourceError('无法安全读取资料路径', 'ANALYSIS_SOURCE_UNREADABLE', 422, { path: relativePath });
    }
    if (stats.isSymbolicLink()) {
      throw new AnalysisSourceError('资料路径不能经过符号链接或连接点', 'ANALYSIS_SOURCE_REPARSE_POINT', 422, { path: relativePath });
    }
  }

  let fileReal;
  try {
    fileReal = normalizedRealPath(cursor);
  } catch {
    throw new AnalysisSourceError('无法解析资料真实路径', 'ANALYSIS_SOURCE_UNREADABLE', 422, { path: relativePath });
  }
  if (!isInsideRoot(fileReal, rootReal)) {
    throw new AnalysisSourceError('资料路径越过项目根目录', 'ANALYSIS_SOURCE_PATH_ESCAPE', 422, { path: relativePath });
  }
  const stats = fs.statSync(cursor);
  if (!stats.isFile()) {
    throw new AnalysisSourceError('资料路径必须指向普通文件', 'ANALYSIS_SOURCE_NOT_FILE', 422, { path: relativePath });
  }
  if (stats.size > MAX_ANALYSIS_SOURCE_BYTES) {
    throw new AnalysisSourceError('单个架构证据文件超过大小限制', 'ANALYSIS_SOURCE_TOO_LARGE', 422, {
      path: relativePath,
      maxBytes: MAX_ANALYSIS_SOURCE_BYTES,
    });
  }
  return { absolutePath: cursor, relativePath, stats };
}

function listAvailableAnalysisSources(projectRoot) {
  const root = path.resolve(projectRoot);
  const sources = [];
  const walk = (directory) => {
    if (sources.length >= MAX_ANALYSIS_SOURCE_COUNT) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      if (sources.length >= MAX_ANALYSIS_SOURCE_COUNT) return;
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const lowerName = entry.name.toLowerCase();
        if (!SKIPPED_DIRECTORIES.has(lowerName) && !SENSITIVE_SOURCE_DIRECTORIES.has(lowerName)) walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
      if (!relativePath || !isAllowedAnalysisSourcePath(relativePath)) continue;
      try {
        resolveSafeAnalysisSource(relativePath, root);
        sources.push({
          id: sourceIdForPath(relativePath),
          sourceKind: 'workspace-file',
          path: relativePath,
          label: sourceLabelForPath(relativePath),
          type: sourceTypeForPath(relativePath),
          selected: false,
          lastScannedAt: null,
          contentHash: null,
          sizeBytes: null,
        });
      } catch {
        // 一个不可读的候选不应阻断其他公开资料的发现。
      }
    }
  };
  walk(root);
  return sources;
}

function readAnalysisSource(sourcePath, projectRoot) {
  const resolved = resolveSafeAnalysisSource(sourcePath, projectRoot);
  let content;
  try {
    content = fs.readFileSync(resolved.absolutePath, 'utf8');
  } catch {
    throw new AnalysisSourceError('无法读取资料文件内容', 'ANALYSIS_SOURCE_UNREADABLE', 422, { path: resolved.relativePath });
  }
  if (content.includes('\0')) {
    throw new AnalysisSourceError('资料文件不是可安全分析的文本', 'ANALYSIS_SOURCE_BINARY', 422, { path: resolved.relativePath });
  }
  return {
    ...resolved,
    content,
    contentHash: contentHash(content),
  };
}

function collectEvidence(source, collectedAt = new Date().toISOString()) {
  const lines = source.content.replace(/\r\n?/g, '\n').split('\n');
  const chunks = [];
  const linesPerChunk = Math.max(1, Math.ceil(lines.length / MAX_EVIDENCE_PER_SOURCE));
  for (let startIndex = 0; startIndex < lines.length && chunks.length < MAX_EVIDENCE_PER_SOURCE; startIndex += linesPerChunk) {
    const lineStart = startIndex + 1;
    const lineEnd = Math.min(lines.length, startIndex + linesPerChunk);
    const rawExcerpt = lines.slice(startIndex, lineEnd).join('\n').trim();
    if (!rawExcerpt) continue;
    const excerpt = rawExcerpt.length > MAX_EVIDENCE_EXCERPT_CHARS
      ? `${rawExcerpt.slice(0, MAX_EVIDENCE_EXCERPT_CHARS - 1)}…`
      : rawExcerpt;
    chunks.push({
      id: `evidence-${source.id}-${lineStart}-${stableHash(`${source.contentHash}:${lineStart}:${lineEnd}`, 10)}`,
      sourceId: source.id,
      sourceKind: 'workspace-file',
      basis: 'code-fact',
      path: source.path,
      lineStart,
      lineEnd,
      excerpt,
      contentHash: source.contentHash,
      collectedAt,
    });
  }
  return chunks;
}

module.exports = {
  AnalysisSourceError,
  MAX_ANALYSIS_SOURCE_BYTES,
  MAX_ANALYSIS_SOURCE_COUNT,
  collectEvidence,
  contentHash,
  isAllowedAnalysisSourcePath,
  listAvailableAnalysisSources,
  readAnalysisSource,
  resolveSafeAnalysisSource,
  sourceIdForPath,
  sourceLabelForPath,
  sourceTypeForPath,
};
