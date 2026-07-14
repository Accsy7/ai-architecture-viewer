'use strict';

const LEGACY_LAYOUT_SCHEMA_VERSION = '1.0.0';
const LAYOUT_SCHEMA_VERSION = '1.1.0';
const MAX_LAYOUT_NODES = 200;
const MAX_LAYOUT_CONTAINERS = 50;
const MAX_COORDINATE = 1_000_000;
const MIN_CONTAINER_SIZE = 120;
const MAX_CONTAINER_SIZE = 100_000;
const NODE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;

class LayoutContractError extends Error {
  constructor(message, code = 'LAYOUT_INVALID', status = 422, details) {
    super(message);
    this.name = 'LayoutContractError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LayoutContractError(`${label} 必须是对象`);
  }
}

function validateNodeId(nodeId) {
  if (typeof nodeId !== 'string' || !NODE_ID_PATTERN.test(nodeId)) {
    throw new LayoutContractError('排版包含无效模块 ID', 'INVALID_LAYOUT_NODE_ID', 422, { nodeId });
  }
}

function validatePosition(position, nodeId) {
  assertPlainObject(position, `模块 ${nodeId} 的位置`);
  for (const axis of ['x', 'y']) {
    const value = position[axis];
    if (!Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
      throw new LayoutContractError(`模块 ${nodeId} 的 ${axis} 坐标无效`, 'INVALID_LAYOUT_POSITION', 422, {
        nodeId,
        axis,
        value,
      });
    }
  }
}

function validatePositions(positions, label = '排版位置') {
  assertPlainObject(positions, label);
  const entries = Object.entries(positions);
  if (entries.length > MAX_LAYOUT_NODES) {
    throw new LayoutContractError(`排版模块数量不得超过 ${MAX_LAYOUT_NODES}`, 'LAYOUT_NODE_LIMIT', 422);
  }
  entries.forEach(([nodeId, position]) => {
    validateNodeId(nodeId);
    validatePosition(position, nodeId);
  });
}

function validateContainer(container, containerId) {
  assertPlainObject(container, `分组容器 ${containerId} 的排版`);
  validatePosition(container, `分组容器 ${containerId}`);
  for (const axis of ['width', 'height']) {
    const value = container[axis];
    if (!Number.isFinite(value) || value < MIN_CONTAINER_SIZE || value > MAX_CONTAINER_SIZE) {
      throw new LayoutContractError(`分组容器 ${containerId} 的 ${axis} 无效`, 'INVALID_LAYOUT_CONTAINER_SIZE', 422, {
        containerId,
        axis,
        value,
      });
    }
  }
}

function validateContainers(containers, label = '分组容器排版') {
  assertPlainObject(containers, label);
  const entries = Object.entries(containers);
  if (entries.length > MAX_LAYOUT_CONTAINERS) {
    throw new LayoutContractError(`分组容器数量不得超过 ${MAX_LAYOUT_CONTAINERS}`, 'LAYOUT_CONTAINER_LIMIT', 422);
  }
  entries.forEach(([containerId, container]) => {
    validateNodeId(containerId);
    validateContainer(container, containerId);
  });
}

function normalizeLayout(layout) {
  assertPlainObject(layout, '查看器排版');
  const normalized = clone(layout);
  if (normalized.schemaVersion === LEGACY_LAYOUT_SCHEMA_VERSION) {
    normalized.schemaVersion = LAYOUT_SCHEMA_VERSION;
  }
  if (normalized.schemaVersion !== LAYOUT_SCHEMA_VERSION) {
    throw new LayoutContractError('查看器排版版本不受支持', 'LAYOUT_SCHEMA_MISMATCH', 409, {
      expected: LAYOUT_SCHEMA_VERSION,
      actual: normalized.schemaVersion,
    });
  }
  if (normalized.layouts && typeof normalized.layouts === 'object' && !Array.isArray(normalized.layouts)) {
    for (const view of ['current', 'target']) {
      if (normalized.layouts[view] && typeof normalized.layouts[view] === 'object' && !Array.isArray(normalized.layouts[view])) {
        normalized.layouts[view].containers ||= {};
      }
    }
  }
  return normalized;
}

function validateLayout(layout) {
  const normalized = normalizeLayout(layout);
  if (!Number.isInteger(normalized.baseRevision) || normalized.baseRevision < 0) {
    throw new LayoutContractError('查看器排版修订号无效');
  }
  if (normalized.lastUpdated !== null && typeof normalized.lastUpdated !== 'string') {
    throw new LayoutContractError('查看器排版更新时间无效');
  }
  assertPlainObject(normalized.layouts, '查看器排版集合');
  for (const view of ['current', 'target']) {
    assertPlainObject(normalized.layouts[view], `${view} 排版`);
    validatePositions(normalized.layouts[view].positions, `${view} 排版位置`);
    validateContainers(normalized.layouts[view].containers, `${view} 分组容器排版`);
  }
  return normalized;
}

function positionsFromGraph(graph) {
  const positions = {};
  for (const node of graph?.nodes || []) {
    if (!NODE_ID_PATTERN.test(String(node.id || ''))) continue;
    const x = Number(node.position?.x);
    const y = Number(node.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    positions[node.id] = { x, y };
  }
  return positions;
}

function containersFromState(state) {
  const containers = {};
  for (const group of state?.meta?.groups || []) {
    if (!NODE_ID_PATTERN.test(String(group?.id || ''))) continue;
    const x = Number(group.position?.x);
    const y = Number(group.position?.y);
    const width = Number(group.width);
    const height = Number(group.height);
    if (![x, y, width, height].every(Number.isFinite)) continue;
    if (width < MIN_CONTAINER_SIZE || height < MIN_CONTAINER_SIZE) continue;
    containers[group.id] = { x, y, width, height };
  }
  return containers;
}

function createInitialLayout(state, now = new Date().toISOString()) {
  const layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    baseRevision: 0,
    lastUpdated: now,
    layouts: {
      current: {
        positions: positionsFromGraph(state?.current?.draft?.graph || state?.current?.published?.graph),
        containers: containersFromState(state),
      },
      target: {
        positions: positionsFromGraph(state?.target?.draft?.graph || state?.target?.published?.graph),
        containers: containersFromState(state),
      },
    },
  };
  return validateLayout(layout);
}

function validateLayoutWriteRequest(incoming, view) {
  assertPlainObject(incoming, '排版保存请求');
  if (![LEGACY_LAYOUT_SCHEMA_VERSION, LAYOUT_SCHEMA_VERSION].includes(incoming.schemaVersion)) {
    throw new LayoutContractError('查看器排版版本不一致', 'LAYOUT_SCHEMA_MISMATCH', 409, {
      expected: LAYOUT_SCHEMA_VERSION,
      actual: incoming.schemaVersion,
    });
  }
  if (!['current', 'target'].includes(view)) {
    throw new LayoutContractError('排版只支持 current 或 target', 'INVALID_LAYOUT_VIEW', 400);
  }
  if (!Number.isInteger(incoming.expectedRevision) || incoming.expectedRevision < 0) {
    throw new LayoutContractError('必须提供有效的排版修订号', 'INVALID_LAYOUT_REVISION', 422);
  }
  validatePositions(incoming.positions);
  if (incoming.containers !== undefined) validateContainers(incoming.containers);
  return incoming;
}

function knownNodeIds(state, view) {
  const ids = new Set();
  const lane = state?.[view];
  for (const graph of [lane?.published?.graph, lane?.draft?.graph]) {
    for (const node of graph?.nodes || []) ids.add(node.id);
  }
  return ids;
}

function knownContainerIds(state) {
  return new Set((state?.meta?.groups || []).map((group) => group?.id).filter(Boolean));
}

function mergeLayout(layout, state, view, incoming) {
  const normalized = validateLayout(layout);
  validateLayoutWriteRequest(incoming, view);
  if (incoming.expectedRevision !== normalized.baseRevision) {
    throw new LayoutContractError('排版已在其他页面发生变化，请刷新后重试', 'STALE_LAYOUT', 409, {
      baseRevision: normalized.baseRevision,
    });
  }
  const known = knownNodeIds(state, view);
  for (const nodeId of Object.keys(incoming.positions)) {
    if (!known.has(nodeId)) {
      throw new LayoutContractError('不能保存当前架构中不存在的模块位置', 'UNKNOWN_LAYOUT_NODE', 409, {
        view,
        nodeId,
      });
    }
  }

  const next = clone(normalized);
  const retained = {};
  for (const [nodeId, position] of Object.entries(next.layouts[view].positions)) {
    if (known.has(nodeId)) retained[nodeId] = position;
  }
  next.layouts[view].positions = { ...retained, ...clone(incoming.positions) };
  if (incoming.containers !== undefined) {
    const knownContainers = knownContainerIds(state);
    for (const containerId of Object.keys(incoming.containers)) {
      if (!knownContainers.has(containerId)) {
        throw new LayoutContractError('不能保存当前架构中不存在的分组容器排版', 'UNKNOWN_LAYOUT_CONTAINER', 409, {
          view,
          containerId,
        });
      }
    }
    const retainedContainers = {};
    for (const [containerId, container] of Object.entries(next.layouts[view].containers)) {
      if (knownContainers.has(containerId)) retainedContainers[containerId] = container;
    }
    next.layouts[view].containers = { ...retainedContainers, ...clone(incoming.containers) };
  }
  return next;
}

module.exports = {
  LAYOUT_SCHEMA_VERSION,
  LayoutContractError,
  createInitialLayout,
  containersFromState,
  mergeLayout,
  normalizeLayout,
  positionsFromGraph,
  validateLayout,
  validateLayoutWriteRequest,
};
