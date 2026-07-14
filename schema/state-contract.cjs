'use strict';

const SCHEMA_VERSION = '3.1.0';
const PREVIOUS_CANONICAL_SCHEMA_VERSION = '3.0.0';
const LEGACY_SCHEMA_VERSION = '2.0.0';
const NODE_TYPE = 'architectureNode';
const DEFAULT_NODE_WIDTH = 260;
const DEFAULT_NODE_HEIGHT = 150;
const MAX_NODE_COUNT = 200;
const MAX_EDGE_COUNT = 1000;
const RELATION_TYPES = new Set(['flow', 'support', 'reference', 'governance', 'handoff']);
const BOUNDARY_POSTURES = new Set(['none', 'controlled', 'blocked']);
const ROUTING_MODES = new Set(['auto', 'manual']);
const ROUTING_PORTS = new Set(['top', 'right', 'bottom', 'left']);
const MAX_WAYPOINT_COUNT = 24;
const TARGET_HORIZONS = new Set(['近期', '后续', '远期']);
const BUILD_STRATEGIES = new Set(['自建', '现有自建', '外部集成', '待决定']);
const REVISION_ORIGINS = new Set(['migration', 'publish', 'restore']);
const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const MIGRATION_LAYOUTS = { current: {}, target: {} };

class ContractError extends Error {
  constructor(message, code = 'VALIDATION_ERROR', status = 422, details) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function fail(message, code, status, details) {
  throw new ContractError(message, code, status, details);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, objectPath) {
  if (!isObject(value)) fail(`${objectPath} 必须是对象`);
}

function assertKeys(value, allowed, objectPath) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${objectPath}.${key} 不是 canonical schema 字段`);
  }
}

function assertText(value, valuePath, { optional = false, nullable = false, max = 2000 } = {}) {
  if (optional && value === undefined) return;
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value.trim()) fail(`${valuePath} 必须是非空文本`);
  if (value.length > max) fail(`${valuePath} 超过 ${max} 字符`);
}

function assertStableId(value, valuePath, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !STABLE_ID.test(value)) {
    fail(`${valuePath} 必须是稳定 ID（小写字母、数字、点、下划线或连字符）`);
  }
}

function assertTimestamp(value, valuePath, { nullable = false } = {}) {
  if (nullable && value === null) return;
  assertText(value, valuePath, { max: 80 });
  if (Number.isNaN(Date.parse(value))) fail(`${valuePath} 必须是有效时间戳`);
}

function assertFiniteNumber(value, valuePath, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    fail(`${valuePath} 必须是 ${min} 到 ${max} 之间的有限数字`);
  }
}

function assertRevision(value, valuePath) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${valuePath} 必须是非负安全整数`);
}

function validateSchemaVersion(value) {
  if (value !== SCHEMA_VERSION) {
    fail(`schemaVersion 必须是 ${SCHEMA_VERSION}`, 'SCHEMA_VERSION_MISMATCH', 409);
  }
}

function validateDocumentRefs(value, valuePath) {
  if (value === undefined) return;
  if (!Array.isArray(value)) fail(`${valuePath} 必须是数组`);
  const refs = new Set();
  value.forEach((ref, index) => {
    assertStableId(ref, `${valuePath}[${index}]`);
    if (refs.has(ref)) fail(`${valuePath} 不得包含重复引用 ${ref}`);
    refs.add(ref);
  });
}

function validateNode(node, index, view) {
  const nodePath = `graph.nodes[${index}]`;
  assertObject(node, nodePath);
  assertKeys(node, new Set(['id', 'type', 'position', 'width', 'height', 'data']), nodePath);
  assertStableId(node.id, `${nodePath}.id`);
  if (node.type !== NODE_TYPE) fail(`${nodePath}.type 必须是 ${NODE_TYPE}`);
  assertObject(node.position, `${nodePath}.position`);
  assertKeys(node.position, new Set(['x', 'y']), `${nodePath}.position`);
  assertFiniteNumber(node.position.x, `${nodePath}.position.x`, -1000000, 1000000);
  assertFiniteNumber(node.position.y, `${nodePath}.position.y`, -1000000, 1000000);
  assertFiniteNumber(node.width, `${nodePath}.width`, 160, 720);
  assertFiniteNumber(node.height, `${nodePath}.height`, 96, 520);

  assertObject(node.data, `${nodePath}.data`);
  assertKeys(
    node.data,
    new Set([
      'name', 'group', 'purpose', 'technical', 'product', 'authorization',
      'horizon', 'focus', 'buildStrategy', 'humanConfirmed', 'confirmationNote',
      'confirmedAt', 'documentRefs', 'aiCollaboration', 'relatedDiagramId',
      'relatedNodeId',
    ]),
    `${nodePath}.data`,
  );
  assertText(node.data.name, `${nodePath}.data.name`, { max: 120 });
  assertText(node.data.group, `${nodePath}.data.group`, { max: 120 });
  assertText(node.data.purpose, `${nodePath}.data.purpose`);
  assertText(node.data.technical, `${nodePath}.data.technical`, { max: 240 });
  assertText(node.data.product, `${nodePath}.data.product`, { max: 240 });
  assertText(node.data.authorization, `${nodePath}.data.authorization`, { max: 300 });
  if (node.data.horizon !== undefined && !TARGET_HORIZONS.has(node.data.horizon)) {
    fail(`${nodePath}.data.horizon 必须是近期、后续或远期`);
  }
  if (view === 'target' && !TARGET_HORIZONS.has(node.data.horizon)) {
    fail(`${nodePath}.data.horizon 是目标架构必填字段`);
  }
  if (node.data.focus !== undefined && typeof node.data.focus !== 'boolean') {
    fail(`${nodePath}.data.focus 必须是布尔值`);
  }
  if (node.data.buildStrategy !== undefined && !BUILD_STRATEGIES.has(node.data.buildStrategy)) {
    fail(`${nodePath}.data.buildStrategy 必须是自建、现有自建、外部集成或待决定`);
  }
  if (node.data.humanConfirmed !== undefined && typeof node.data.humanConfirmed !== 'boolean') {
    fail(`${nodePath}.data.humanConfirmed 必须是布尔值`);
  }
  if (node.data.confirmationNote !== undefined) {
    assertText(node.data.confirmationNote, `${nodePath}.data.confirmationNote`, { max: 1000 });
  }
  if (node.data.confirmedAt !== undefined) {
    assertTimestamp(node.data.confirmedAt, `${nodePath}.data.confirmedAt`);
  }
  if (node.data.aiCollaboration !== undefined) {
    assertText(node.data.aiCollaboration, `${nodePath}.data.aiCollaboration`, { max: 80 });
  }
  if (node.data.relatedDiagramId !== undefined) {
    assertStableId(node.data.relatedDiagramId, `${nodePath}.data.relatedDiagramId`);
  }
  if (node.data.relatedNodeId !== undefined) {
    assertStableId(node.data.relatedNodeId, `${nodePath}.data.relatedNodeId`);
    if (node.data.relatedDiagramId === undefined) {
      fail(`${nodePath}.data.relatedNodeId 必须与 relatedDiagramId 一起使用`);
    }
  }
  if (node.data.humanConfirmed === true) {
    assertText(node.data.confirmationNote, `${nodePath}.data.confirmationNote`, { max: 1000 });
    assertTimestamp(node.data.confirmedAt, `${nodePath}.data.confirmedAt`);
  }
  validateDocumentRefs(node.data.documentRefs, `${nodePath}.data.documentRefs`);
}

function validateEdge(edge, index, nodeIds) {
  const edgePath = `graph.edges[${index}]`;
  assertObject(edge, edgePath);
  assertKeys(edge, new Set(['id', 'source', 'target', 'type', 'data']), edgePath);
  assertStableId(edge.id, `${edgePath}.id`);
  assertStableId(edge.source, `${edgePath}.source`);
  assertStableId(edge.target, `${edgePath}.target`);
  if (edge.source === edge.target) fail(`${edgePath} 不允许自连接`);
  if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) fail(`${edgePath} 引用了不存在的节点`);
  if (edge.type !== undefined) assertText(edge.type, `${edgePath}.type`, { max: 80 });
  assertObject(edge.data, `${edgePath}.data`);
  assertKeys(
    edge.data,
    new Set(['label', 'relationType', 'controlledBoundaryPosture', 'routingMode', 'sourcePort', 'targetPort', 'waypoints']),
    `${edgePath}.data`,
  );
  assertText(edge.data.label, `${edgePath}.data.label`, { max: 240 });
  if (!RELATION_TYPES.has(edge.data.relationType)) fail(`${edgePath}.data.relationType 不是受支持的关系类型`);
  if (!BOUNDARY_POSTURES.has(edge.data.controlledBoundaryPosture)) {
    fail(`${edgePath}.data.controlledBoundaryPosture 不是受支持的边界姿态`);
  }
  if (!ROUTING_MODES.has(edge.data.routingMode)) fail(`${edgePath}.data.routingMode 必须是 auto 或 manual`);
  if (edge.data.routingMode === 'auto') {
    if (edge.data.sourcePort !== undefined || edge.data.targetPort !== undefined || edge.data.waypoints !== undefined) {
      fail(`${edgePath}.data 自动路径不得锁定端口或转折点`);
    }
    return;
  }
  if (!ROUTING_PORTS.has(edge.data.sourcePort)) fail(`${edgePath}.data.sourcePort 不是四方向端口`);
  if (!ROUTING_PORTS.has(edge.data.targetPort)) fail(`${edgePath}.data.targetPort 不是四方向端口`);
  if (edge.data.waypoints === undefined) return;
  if (!Array.isArray(edge.data.waypoints)) fail(`${edgePath}.data.waypoints 必须是数组`);
  if (edge.data.waypoints.length > MAX_WAYPOINT_COUNT) {
    fail(`${edgePath}.data.waypoints 不得超过 ${MAX_WAYPOINT_COUNT} 个`);
  }
  edge.data.waypoints.forEach((point, pointIndex) => {
    const pointPath = `${edgePath}.data.waypoints[${pointIndex}]`;
    assertObject(point, pointPath);
    assertKeys(point, new Set(['x', 'y']), pointPath);
    assertFiniteNumber(point.x, `${pointPath}.x`, -1000000, 1000000);
    assertFiniteNumber(point.y, `${pointPath}.y`, -1000000, 1000000);
  });
}

function validateGraph(graph, view, { allowEmpty = false } = {}) {
  if (!['current', 'target'].includes(view)) fail('view 只能是 current 或 target', 'INVALID_VIEW', 400);
  assertObject(graph, 'graph');
  assertKeys(graph, new Set(['nodes', 'edges']), 'graph');
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) fail('graph.nodes 和 graph.edges 必须是数组');
  if ((!allowEmpty && graph.nodes.length < 1) || graph.nodes.length > MAX_NODE_COUNT) {
    fail(`主图节点必须为 ${allowEmpty ? '0' : '1'}–${MAX_NODE_COUNT} 个`);
  }
  if (graph.edges.length > MAX_EDGE_COUNT) fail(`主图关系不得超过 ${MAX_EDGE_COUNT} 条`);
  const nodeIds = new Set();
  graph.nodes.forEach((node, index) => {
    validateNode(node, index, view);
    if (nodeIds.has(node.id)) fail(`节点 ID ${node.id} 重复`);
    nodeIds.add(node.id);
  });
  const edgeIds = new Set();
  graph.edges.forEach((edge, index) => {
    validateEdge(edge, index, nodeIds);
    if (edgeIds.has(edge.id)) fail(`关系 ID ${edge.id} 重复`);
    edgeIds.add(edge.id);
  });
  return graph;
}

function validateRevisionSnapshot(revision, view, revisionPath = `${view}.published`) {
  assertObject(revision, revisionPath);
  assertKeys(
    revision,
    new Set([
      'revision', 'revisionId', 'parentRevisionId', 'origin', 'restoredFromRevisionId',
      'message', 'publishedAt', 'publishedBy', 'graph',
    ]),
    revisionPath,
  );
  assertRevision(revision.revision, `${revisionPath}.revision`);
  assertStableId(revision.revisionId, `${revisionPath}.revisionId`);
  assertStableId(revision.parentRevisionId, `${revisionPath}.parentRevisionId`, { nullable: true });
  if (!REVISION_ORIGINS.has(revision.origin)) fail(`${revisionPath}.origin 无效`);
  assertStableId(revision.restoredFromRevisionId, `${revisionPath}.restoredFromRevisionId`, { nullable: true });
  assertText(revision.message, `${revisionPath}.message`, { nullable: true, max: 500 });
  if (revision.origin === 'migration') {
    if (revision.message !== null) fail(`${revisionPath}.message 在 migration 版本中必须为 null`);
  } else if (revision.message === null) {
    fail(`${revisionPath}.message 是发布或恢复版本的必填字段`);
  }
  if (revision.origin === 'restore' && revision.restoredFromRevisionId === null) {
    fail(`${revisionPath}.restoredFromRevisionId 是恢复版本的必填字段`);
  }
  if (revision.origin !== 'restore' && revision.restoredFromRevisionId !== null) {
    fail(`${revisionPath}.restoredFromRevisionId 只能用于恢复版本`);
  }
  if (revision.revision === 0) {
    if (revision.origin !== 'migration') fail(`${revisionPath} 的 R0 基线必须来自 migration`);
    if (revision.publishedAt !== null || revision.publishedBy !== null || revision.parentRevisionId !== null) {
      fail(`${revisionPath} 的 R0 基线不得声称发布者、发布时间或父版本`);
    }
    validateGraph(revision.graph, view, { allowEmpty: true });
    if (revision.graph.nodes.length || revision.graph.edges.length) fail(`${revisionPath} 的 R0 基线必须为空`);
  } else {
    assertTimestamp(revision.publishedAt, `${revisionPath}.publishedAt`);
    if (revision.publishedBy !== 'user') fail(`${revisionPath}.publishedBy 必须是 user`);
    validateGraph(revision.graph, view, { allowEmpty: view === 'target' });
  }
}

function validateDraft(draft, published, view, draftPath = `${view}.draft`) {
  if (draft === null) return;
  assertObject(draft, draftPath);
  assertKeys(
    draft,
    new Set(['draftId', 'draftRevision', 'baseRevision', 'baseRevisionId', 'savedAt', 'graph']),
    draftPath,
  );
  assertStableId(draft.draftId, `${draftPath}.draftId`);
  assertRevision(draft.draftRevision, `${draftPath}.draftRevision`);
  if (draft.draftRevision < 1) fail(`${draftPath}.draftRevision 必须从 1 开始`);
  assertRevision(draft.baseRevision, `${draftPath}.baseRevision`);
  assertStableId(draft.baseRevisionId, `${draftPath}.baseRevisionId`);
  if (draft.baseRevision !== published.revision || draft.baseRevisionId !== published.revisionId) {
    fail(`${draftPath} 的正式版本基线与当前 head 不一致`);
  }
  assertTimestamp(draft.savedAt, `${draftPath}.savedAt`);
  validateGraph(draft.graph, view);
}

function validateLane(lane, view) {
  assertObject(lane, view);
  assertKeys(lane, new Set(['published', 'draft', 'history']), view);
  if (!Array.isArray(lane.history)) fail(`${view}.history 必须是数组`);
  const revisions = [...lane.history, lane.published];
  const ids = new Set();
  const numbers = new Set();
  const revisionsById = new Map();
  let prior = -1;
  revisions.forEach((revision, index) => {
    const revisionPath = index < lane.history.length ? `${view}.history[${index}]` : `${view}.published`;
    validateRevisionSnapshot(revision, view, revisionPath);
    if (ids.has(revision.revisionId)) fail(`${view} 中 revisionId ${revision.revisionId} 重复`);
    if (numbers.has(revision.revision)) fail(`${view} 中 revision ${revision.revision} 重复`);
    if (revision.revision <= prior) fail(`${view} 的版本必须严格递增`);
    ids.add(revision.revisionId);
    numbers.add(revision.revision);
    revisionsById.set(revision.revisionId, revision);
    prior = revision.revision;
  });
  revisions.forEach((revision) => {
    if (revision.parentRevisionId !== null && !ids.has(revision.parentRevisionId)) {
      fail(`${view} 版本 ${revision.revisionId} 的 parentRevisionId 不存在`);
    }
    if (
      revision.parentRevisionId !== null
      && revisionsById.get(revision.parentRevisionId).revision >= revision.revision
    ) {
      fail(`${view} 版本 ${revision.revisionId} 的 parentRevisionId 必须指向更早版本`);
    }
    if (revision.restoredFromRevisionId !== null && !ids.has(revision.restoredFromRevisionId)) {
      fail(`${view} 版本 ${revision.revisionId} 的 restoredFromRevisionId 不存在`);
    }
    if (
      revision.restoredFromRevisionId !== null
      && revisionsById.get(revision.restoredFromRevisionId).revision >= revision.revision
    ) {
      fail(`${view} 版本 ${revision.revisionId} 的 restoredFromRevisionId 必须指向更早版本`);
    }
  });
  validateDraft(lane.draft, lane.published, view);
}

function validateState(state) {
  assertObject(state, 'state');
  assertKeys(state, new Set(['schemaVersion', 'meta', 'current', 'target']), 'state');
  validateSchemaVersion(state.schemaVersion);
  assertObject(state.meta, 'meta');
  validateLane(state.current, 'current');
  validateLane(state.target, 'target');
  return state;
}

function validateLockFields(request) {
  assertRevision(request.expectedHeadRevision, 'request.expectedHeadRevision');
  assertStableId(request.expectedHeadRevisionId, 'request.expectedHeadRevisionId');
  if (request.expectedDraftId !== null) assertStableId(request.expectedDraftId, 'request.expectedDraftId');
  assertRevision(request.expectedDraftRevision, 'request.expectedDraftRevision');
  if (request.expectedDraftId === null && request.expectedDraftRevision !== 0) {
    fail('无草案锁必须使用 expectedDraftId=null 与 expectedDraftRevision=0');
  }
  if (request.expectedDraftId !== null && request.expectedDraftRevision < 1) {
    fail('现有草案锁的 expectedDraftRevision 必须至少为 1');
  }
}

function validateLockedRequest(request, allowedKeys) {
  assertObject(request, 'request');
  assertKeys(request, new Set([
    'schemaVersion', 'expectedHeadRevision', 'expectedHeadRevisionId',
    'expectedDraftId', 'expectedDraftRevision', ...allowedKeys,
  ]), 'request');
  validateSchemaVersion(request.schemaVersion);
  validateLockFields(request);
  return request;
}

function validateDraftRequest(request, view) {
  validateLockedRequest(request, ['graph', 'userConfirmedSemanticOverride']);
  if (
    request.userConfirmedSemanticOverride !== undefined
    && typeof request.userConfirmedSemanticOverride !== 'boolean'
  ) {
    fail('request.userConfirmedSemanticOverride 必须是布尔值');
  }
  validateGraph(request.graph, view);
  return request;
}

function validateRevisionRequest(request) {
  return validateLockedRequest(request, []);
}

function validateActionRequest(request, { restore = false } = {}) {
  validateLockedRequest(request, restore ? ['sourceRevisionId', 'message', 'userConfirmed'] : ['message', 'userConfirmed']);
  assertText(request.message, 'request.message', { max: 500 });
  if (request.userConfirmed !== true) {
    fail('正式架构只能在用户明确确认后发布或恢复', 'USER_CONFIRMATION_REQUIRED', 403);
  }
  if (restore) assertStableId(request.sourceRevisionId, 'request.sourceRevisionId');
  return request;
}

function legacyPosition(value, axis) {
  if (axis === 'x') return Number((value * 10 - DEFAULT_NODE_WIDTH / 2).toFixed(3));
  return Number((value - DEFAULT_NODE_HEIGHT / 2).toFixed(3));
}

function migrateNode(node, view) {
  if (node.position && node.data) return clone(node);
  const data = {
    name: node.name,
    group: node.group,
    purpose: node.purpose,
    technical: node.technical,
    product: node.product,
    authorization: node.authorization,
  };
  if (node.horizon !== undefined) data.horizon = node.horizon;
  if (node.focus !== undefined) data.focus = node.focus;
  if (node.documentRefs !== undefined) data.documentRefs = clone(node.documentRefs);
  return {
    id: node.id,
    type: NODE_TYPE,
    position: clone(MIGRATION_LAYOUTS[view]?.[node.id] || {
      x: legacyPosition(node.x, 'x'),
      y: legacyPosition(node.y, 'y'),
    }),
    width: DEFAULT_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT,
    data,
  };
}

function migrateEdgeData(data) {
  const migrated = clone(data || {});
  if (migrated.routingMode === 'manual') {
    migrated.sourcePort = ROUTING_PORTS.has(migrated.sourcePort) ? migrated.sourcePort : 'right';
    migrated.targetPort = ROUTING_PORTS.has(migrated.targetPort) ? migrated.targetPort : 'left';
    if (Array.isArray(migrated.waypoints) && !migrated.waypoints.length) delete migrated.waypoints;
    return migrated;
  }
  migrated.routingMode = 'auto';
  delete migrated.sourcePort;
  delete migrated.targetPort;
  delete migrated.waypoints;
  return migrated;
}

function migrateEdge(edge) {
  if (edge.source && edge.target && edge.data) {
    const migrated = clone(edge);
    migrated.data = migrateEdgeData(migrated.data);
    return migrated;
  }
  return {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    data: {
      label: edge.label,
      relationType: edge.style === 'support' ? 'support' : 'flow',
      controlledBoundaryPosture: edge.style === 'blocked' ? 'blocked' : 'none',
      routingMode: 'auto',
    },
  };
}

function migrateGraph(value, view) {
  const graph = value.graph || value;
  return {
    nodes: graph.nodes.map((node) => migrateNode(node, view)),
    edges: graph.edges.map(migrateEdge),
  };
}

function v2Published(value, view) {
  if (value.revision !== undefined && value.graph) return clone(value);
  return {
    revision: value.version,
    publishedAt: value.publishedAt,
    publishedBy: value.publishedBy,
    graph: migrateGraph(value, view),
  };
}

function v2Draft(value, view) {
  if (value === null) return null;
  if (value.baseRevision !== undefined && value.graph) return clone(value);
  return {
    baseRevision: value.baseVersion,
    savedAt: value.savedAt,
    graph: migrateGraph(value, view),
  };
}

function migrateLane(lane, view) {
  const snapshots = lane.history.map((entry) => v2Published(entry.snapshot, view));
  snapshots.push(v2Published(lane.published, view));
  snapshots.sort((left, right) => left.revision - right.revision);
  const revisions = snapshots.map((snapshot, index) => ({
    revision: snapshot.revision,
    revisionId: `${view}-r${snapshot.revision}`,
    parentRevisionId: index === 0 ? null : `${view}-r${snapshots[index - 1].revision}`,
    origin: 'migration',
    restoredFromRevisionId: null,
    message: null,
    publishedAt: snapshot.publishedAt,
    publishedBy: snapshot.publishedBy,
    graph: migrateGraph(snapshot, view),
  }));
  const published = revisions[revisions.length - 1];
  const legacyDraft = v2Draft(lane.draft, view);
  return {
    published,
    draft: legacyDraft === null ? null : {
      draftId: `${view}-draft-migrated-r${legacyDraft.baseRevision}`,
      draftRevision: 1,
      baseRevision: legacyDraft.baseRevision,
      baseRevisionId: published.revisionId,
      savedAt: legacyDraft.savedAt,
      graph: migrateGraph(legacyDraft, view),
    },
    history: revisions.slice(0, -1),
  };
}

function migrateLegacyState(legacy) {
  if (legacy && legacy.schemaVersion === SCHEMA_VERSION) {
    const canonical = clone(legacy);
    validateState(canonical);
    return canonical;
  }
  if (legacy && legacy.schemaVersion === PREVIOUS_CANONICAL_SCHEMA_VERSION) {
    const canonical = clone(legacy);
    canonical.schemaVersion = SCHEMA_VERSION;
    ['current', 'target'].forEach((view) => {
      const lane = canonical[view];
      lane.published.graph = migrateGraph(lane.published.graph, view);
      if (lane.draft) lane.draft.graph = migrateGraph(lane.draft.graph, view);
      lane.history.forEach((revision) => { revision.graph = migrateGraph(revision.graph, view); });
    });
    validateState(canonical);
    return canonical;
  }
  assertObject(legacy, 'legacy state');
  assertObject(legacy.meta, 'legacy state.meta');
  ['current', 'target'].forEach((view) => {
    assertObject(legacy[view], `legacy state.${view}`);
    assertObject(legacy[view].published, `legacy state.${view}.published`);
    if (!Array.isArray(legacy[view].history)) fail(`legacy state.${view}.history 必须是数组`);
  });
  if (legacy.schemaVersion && legacy.schemaVersion !== LEGACY_SCHEMA_VERSION) {
    fail(`无法从 schemaVersion ${legacy.schemaVersion} 迁移`, 'SCHEMA_VERSION_MISMATCH', 409);
  }
  const canonical = {
    schemaVersion: SCHEMA_VERSION,
    meta: clone(legacy.meta),
    current: migrateLane(legacy.current, 'current'),
    target: migrateLane(legacy.target, 'target'),
  };
  validateState(canonical);
  return canonical;
}

function semanticProjectionFromLegacy(legacy) {
  const nodeProjection = (node) => {
    if (node.data) return { id: node.id, ...clone(node.data) };
    const projected = {
      id: node.id,
      name: node.name,
      group: node.group,
      purpose: node.purpose,
      technical: node.technical,
      product: node.product,
      authorization: node.authorization,
    };
    if (node.horizon !== undefined) projected.horizon = node.horizon;
    if (node.focus !== undefined) projected.focus = node.focus;
    if (node.documentRefs !== undefined) projected.documentRefs = clone(node.documentRefs);
    return projected;
  };
  const graphProjection = (value) => {
    const graph = value.graph || value;
    return {
      nodes: graph.nodes.map(nodeProjection),
      edges: graph.edges.map((edge) => edge.data ? ({
        id: edge.id, source: edge.source, target: edge.target, ...migrateEdgeData(edge.data),
      }) : ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        relationType: edge.style === 'support' ? 'support' : 'flow',
        controlledBoundaryPosture: edge.style === 'blocked' ? 'blocked' : 'none',
        routingMode: 'auto',
      })),
    };
  };
  const laneProjection = (lane) => {
    const published = v2Published(lane.published, 'current');
    const draft = v2Draft(lane.draft, 'current');
    return {
      published: { revision: published.revision, ...graphProjection(published) },
      draft: draft === null ? null : { baseRevision: draft.baseRevision, ...graphProjection(draft) },
    };
  };
  return { current: laneProjection(legacy.current), target: laneProjection(legacy.target) };
}

function semanticProjectionFromCanonical(state) {
  const graphProjection = (graph) => ({
    nodes: graph.nodes.map((node) => ({ id: node.id, ...clone(node.data) })),
    edges: graph.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, ...clone(edge.data) })),
  });
  const laneProjection = (lane) => ({
    published: { revision: lane.published.revision, ...graphProjection(lane.published.graph) },
    draft: lane.draft === null ? null : { baseRevision: lane.draft.baseRevision, ...graphProjection(lane.draft.graph) },
  });
  return { current: laneProjection(state.current), target: laneProjection(state.target) };
}

function revisionSummary(revision, { isHead = false } = {}) {
  return {
    revision: revision.revision,
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId,
    origin: revision.origin,
    restoredFromRevisionId: revision.restoredFromRevisionId,
    message: revision.message,
    publishedAt: revision.publishedAt,
    publishedBy: revision.publishedBy,
    nodeCount: revision.graph.nodes.length,
    edgeCount: revision.graph.edges.length,
    isHead,
  };
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function diffGraphs(fromGraph, toGraph) {
  const fromNodes = new Map(fromGraph.nodes.map((node) => [node.id, node]));
  const toNodes = new Map(toGraph.nodes.map((node) => [node.id, node]));
  const fromEdges = new Map(fromGraph.edges.map((edge) => [edge.id, edge]));
  const toEdges = new Map(toGraph.edges.map((edge) => [edge.id, edge]));
  const structural = { addedNodeIds: [], removedNodeIds: [] };
  const layout = { changed: [] };
  const document = { changed: [] };
  const semantic = { changed: [] };
  const relationship = { addedEdgeIds: [], removedEdgeIds: [], changed: [] };

  for (const [id, node] of toNodes) {
    if (!fromNodes.has(id)) {
      structural.addedNodeIds.push(id);
      const refs = node.data.documentRefs || [];
      if (refs.length) document.changed.push({ nodeId: id, added: clone(refs), removed: [] });
    }
  }
  for (const [id, node] of fromNodes) {
    if (!toNodes.has(id)) {
      structural.removedNodeIds.push(id);
      const refs = node.data.documentRefs || [];
      if (refs.length) document.changed.push({ nodeId: id, added: [], removed: clone(refs) });
    }
  }
  for (const [id, before] of fromNodes) {
    const after = toNodes.get(id);
    if (!after) continue;
    const beforeLayout = { position: before.position, width: before.width, height: before.height };
    const afterLayout = { position: after.position, width: after.width, height: after.height };
    if (!valuesEqual(beforeLayout, afterLayout)) layout.changed.push({ nodeId: id, before: beforeLayout, after: afterLayout });
    const beforeRefs = before.data.documentRefs || [];
    const afterRefs = after.data.documentRefs || [];
    const added = afterRefs.filter((ref) => !beforeRefs.includes(ref));
    const removed = beforeRefs.filter((ref) => !afterRefs.includes(ref));
    if (added.length || removed.length) document.changed.push({ nodeId: id, added, removed });
    const beforeData = { ...before.data };
    const afterData = { ...after.data };
    delete beforeData.documentRefs;
    delete afterData.documentRefs;
    if (!valuesEqual(beforeData, afterData)) semantic.changed.push({ nodeId: id, before: beforeData, after: afterData });
  }
  for (const id of toEdges.keys()) if (!fromEdges.has(id)) relationship.addedEdgeIds.push(id);
  for (const id of fromEdges.keys()) if (!toEdges.has(id)) relationship.removedEdgeIds.push(id);
  for (const [id, before] of fromEdges) {
    const after = toEdges.get(id);
    if (after && !valuesEqual(before, after)) relationship.changed.push({ edgeId: id, before, after });
  }
  return {
    categories: { structural, layout, document, semantic, relationship },
    summary: {
      structural: structural.addedNodeIds.length + structural.removedNodeIds.length,
      layout: layout.changed.length,
      document: document.changed.length,
      semantic: semantic.changed.length,
      relationship: relationship.addedEdgeIds.length + relationship.removedEdgeIds.length + relationship.changed.length,
    },
  };
}

module.exports = {
  BOUNDARY_POSTURES,
  BUILD_STRATEGIES,
  ContractError,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  LEGACY_SCHEMA_VERSION,
  MAX_EDGE_COUNT,
  MAX_NODE_COUNT,
  MIGRATION_LAYOUTS,
  NODE_TYPE,
  RELATION_TYPES,
  REVISION_ORIGINS,
  SCHEMA_VERSION,
  clone,
  diffGraphs,
  migrateLegacyState,
  revisionSummary,
  semanticProjectionFromCanonical,
  semanticProjectionFromLegacy,
  validateActionRequest,
  validateDraftRequest,
  validateGraph,
  validateRevisionRequest,
  validateSchemaVersion,
  validateState,
};
