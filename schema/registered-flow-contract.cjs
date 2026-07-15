'use strict';

const crypto = require('crypto');
const { ContractError, clone } = require('./state-contract.cjs');

const REGISTERED_FLOW_SCHEMA_VERSION = '1.0.0';
const STABLE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function fail(message, details = {}) {
  throw new ContractError(message, 'REGISTERED_FLOW_INVALID', 500, details);
}

function assertObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} 必须是对象`, { field });
  return value;
}

function assertKeys(value, allowed, field) {
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length) fail(`${field} 包含未登记字段`, { field, extra });
}

function text(value, field, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    fail(`${field} 无效`, { field });
  }
  return value.trim();
}

function stableId(value, field) {
  const result = text(value, field, 120);
  if (!STABLE_ID.test(result)) fail(`${field} 不是稳定 ID`, { field });
  return result;
}

function unique(items, field) {
  const seen = new Set();
  items.forEach((item) => {
    if (seen.has(item)) fail(`${field} 包含重复 ID`, { field, id: item });
    seen.add(item);
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function revisionLock(value, field) {
  const raw = assertObject(value, field);
  assertKeys(raw, new Set(['kind', 'id', 'revision', 'canonicalSha256']), field);
  if (!['draft', 'published'].includes(raw.kind)) fail(`${field}.kind 无效`, { field: `${field}.kind` });
  const revision = Number(raw.revision);
  if (!Number.isInteger(revision) || revision < 0) fail(`${field}.revision 无效`, { field: `${field}.revision` });
  if (typeof raw.canonicalSha256 !== 'string' || !SHA256.test(raw.canonicalSha256)) {
    fail(`${field}.canonicalSha256 无效`, { field: `${field}.canonicalSha256` });
  }
  return {
    kind: raw.kind,
    id: stableId(raw.id, `${field}.id`),
    revision,
    canonicalSha256: raw.canonicalSha256,
  };
}

function endpoint(value, field) {
  const raw = assertObject(value, field);
  assertKeys(raw, new Set(['diagramId', 'view', 'revision']), field);
  if (!['current', 'target'].includes(raw.view)) fail(`${field}.view 无效`, { field: `${field}.view` });
  return {
    diagramId: stableId(raw.diagramId, `${field}.diagramId`),
    view: raw.view,
    revision: revisionLock(raw.revision, `${field}.revision`),
  };
}

function mappingList(value, field, sourceKey, projectionKey, maxLength) {
  if (!Array.isArray(value) || value.length > maxLength) fail(`${field} 无效`, { field });
  const result = value.map((entry, index) => {
    const item = assertObject(entry, `${field}[${index}]`);
    assertKeys(item, new Set([sourceKey, projectionKey]), `${field}[${index}]`);
    return {
      [sourceKey]: stableId(item[sourceKey], `${field}[${index}].${sourceKey}`),
      [projectionKey]: stableId(item[projectionKey], `${field}[${index}].${projectionKey}`),
    };
  });
  unique(result.map((entry) => entry[sourceKey]), `${field}.${sourceKey}`);
  unique(result.map((entry) => entry[projectionKey]), `${field}.${projectionKey}`);
  return result;
}

function idList(value, field, maxLength) {
  if (!Array.isArray(value) || value.length > maxLength) fail(`${field} 无效`, { field });
  const result = value.map((item, index) => stableId(item, `${field}[${index}]`));
  unique(result, field);
  return result;
}

function validateRegisteredFlowRegistry(raw) {
  const registry = assertObject(raw, 'registeredFlows');
  assertKeys(registry, new Set(['schemaVersion', 'flows']), 'registeredFlows');
  if (registry.schemaVersion !== REGISTERED_FLOW_SCHEMA_VERSION) {
    fail('登记业务流版本无效', { expected: REGISTERED_FLOW_SCHEMA_VERSION, actual: registry.schemaVersion });
  }
  if (!Array.isArray(registry.flows) || registry.flows.length > 20) fail('registeredFlows.flows 无效');
  const flows = registry.flows.map((entry, index) => {
    const field = `flows[${index}]`;
    const flow = assertObject(entry, field);
    assertKeys(flow, new Set([
      'id', 'title', 'description', 'source', 'projection', 'order',
      'nodeMappings', 'edgeMappings', 'sidebarOnlyNodeIds', 'sidebarOnlyEdgeIds',
    ]), field);
    if (flow.order !== 'topological-stages') fail(`${field}.order 无效`, { field: `${field}.order` });
    return {
      id: stableId(flow.id, `${field}.id`),
      title: text(flow.title, `${field}.title`, 120),
      description: text(flow.description, `${field}.description`, 480),
      source: endpoint(flow.source, `${field}.source`),
      projection: endpoint(flow.projection, `${field}.projection`),
      order: flow.order,
      nodeMappings: mappingList(flow.nodeMappings, `${field}.nodeMappings`, 'sourceNodeId', 'projectionNodeId', 100),
      edgeMappings: mappingList(flow.edgeMappings, `${field}.edgeMappings`, 'sourceEdgeId', 'projectionEdgeId', 200),
      sidebarOnlyNodeIds: idList(flow.sidebarOnlyNodeIds, `${field}.sidebarOnlyNodeIds`, 100),
      sidebarOnlyEdgeIds: idList(flow.sidebarOnlyEdgeIds, `${field}.sidebarOnlyEdgeIds`, 200),
    };
  });
  unique(flows.map((flow) => flow.id), 'flows.id');
  return { schemaVersion: REGISTERED_FLOW_SCHEMA_VERSION, flows };
}

function selectedRevision(state, endpointValue, flowId, role) {
  const lane = state?.[endpointValue.view];
  if (!lane) fail(`登记业务流 ${flowId} 的 ${role} 视图不存在`, { flowId, role });
  const lock = endpointValue.revision;
  const revision = lock.kind === 'draft' ? lane.draft : lane.published;
  const actualId = lock.kind === 'draft' ? revision?.draftId : revision?.revisionId;
  const actualRevision = lock.kind === 'draft' ? revision?.draftRevision : revision?.revision;
  const actualHash = revision ? canonicalSha256(revision) : null;
  if (!revision || actualId !== lock.id || actualRevision !== lock.revision || actualHash !== lock.canonicalSha256) {
    fail(`登记业务流 ${flowId} 的 ${role} 版本锁失配`, {
      flowId,
      role,
      expected: lock,
      actual: { kind: lock.kind, id: actualId || null, revision: actualRevision ?? null, canonicalSha256: actualHash },
    });
  }
  return revision;
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function topologicalStages(nodes, edges, flowId) {
  const index = new Map(nodes.map((node, order) => [node.id, order]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => {
    if (!incoming.has(edge.source) || !incoming.has(edge.target)) {
      fail(`登记业务流 ${flowId} 的源边引用未知节点`, { flowId, edgeId: edge.id });
    }
    incoming.set(edge.target, incoming.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
  });
  const stage = new Map(nodes.map((node) => [node.id, 1]));
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  let visited = 0;
  while (queue.length) {
    queue.sort((left, right) => index.get(left) - index.get(right));
    const id = queue.shift();
    visited += 1;
    outgoing.get(id).forEach((target) => {
      stage.set(target, Math.max(stage.get(target), stage.get(id) + 1));
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    });
  }
  if (visited !== nodes.length) fail(`登记业务流 ${flowId} 不是有向无环图`, { flowId });
  return stage;
}

function diagramById(catalog, id, flowId, role) {
  const diagram = catalog.diagrams.find((entry) => entry.id === id);
  if (!diagram) fail(`登记业务流 ${flowId} 的 ${role} 图不存在`, { flowId, role, diagramId: id });
  return diagram;
}

function resolveFlow(flow, catalog, readState) {
  const sourceDiagram = diagramById(catalog, flow.source.diagramId, flow.id, 'source');
  const projectionDiagram = diagramById(catalog, flow.projection.diagramId, flow.id, 'projection');
  const sourceRevision = selectedRevision(readState(sourceDiagram.statePath), flow.source, flow.id, 'source');
  const projectionRevision = selectedRevision(readState(projectionDiagram.statePath), flow.projection, flow.id, 'projection');
  const sourceNodes = sourceRevision.graph.nodes;
  const sourceEdges = sourceRevision.graph.edges;
  const projectionNodes = new Map(projectionRevision.graph.nodes.map((node) => [node.id, node]));
  const projectionEdges = new Map(projectionRevision.graph.edges.map((edge) => [edge.id, edge]));
  const sourceNodeMap = new Map(flow.nodeMappings.map((entry) => [entry.sourceNodeId, entry.projectionNodeId]));
  const projectionNodeMap = new Map(flow.nodeMappings.map((entry) => [entry.projectionNodeId, entry.sourceNodeId]));
  const sourceEdgeMap = new Map(flow.edgeMappings.map((entry) => [entry.sourceEdgeId, entry.projectionEdgeId]));
  const sidebarNodeIds = new Set(flow.sidebarOnlyNodeIds);
  const sidebarEdgeIds = new Set(flow.sidebarOnlyEdgeIds);
  const sourceNodeIds = new Set(sourceNodes.map((node) => node.id));
  const sourceEdgeIds = new Set(sourceEdges.map((edge) => edge.id));
  const coveredNodeIds = new Set([...sourceNodeMap.keys(), ...sidebarNodeIds]);
  const coveredEdgeIds = new Set([...sourceEdgeMap.keys(), ...sidebarEdgeIds]);
  if (!sameSet(sourceNodeIds, coveredNodeIds)) {
    fail(`登记业务流 ${flow.id} 未完整覆盖源节点`, { flowId: flow.id, sourceNodeIds: [...sourceNodeIds], coveredNodeIds: [...coveredNodeIds] });
  }
  if (!sameSet(sourceEdgeIds, coveredEdgeIds)) {
    fail(`登记业务流 ${flow.id} 未完整覆盖源边`, { flowId: flow.id, sourceEdgeIds: [...sourceEdgeIds], coveredEdgeIds: [...coveredEdgeIds] });
  }
  flow.nodeMappings.forEach(({ sourceNodeId, projectionNodeId }) => {
    if (!sourceNodeIds.has(sourceNodeId) || !projectionNodes.has(projectionNodeId)) {
      fail(`登记业务流 ${flow.id} 的节点映射失配`, { flowId: flow.id, sourceNodeId, projectionNodeId });
    }
  });
  flow.edgeMappings.forEach(({ sourceEdgeId, projectionEdgeId }) => {
    const sourceEdge = sourceEdges.find((edge) => edge.id === sourceEdgeId);
    const projectionEdge = projectionEdges.get(projectionEdgeId);
    if (!sourceEdge || !projectionEdge) {
      fail(`登记业务流 ${flow.id} 的边映射失配`, { flowId: flow.id, sourceEdgeId, projectionEdgeId });
    }
    const expectedSource = sourceNodeMap.get(sourceEdge.source);
    const expectedTarget = sourceNodeMap.get(sourceEdge.target);
    if (!expectedSource || !expectedTarget || projectionEdge.source !== expectedSource || projectionEdge.target !== expectedTarget) {
      fail(`登记业务流 ${flow.id} 的边方向或端点映射失配`, { flowId: flow.id, sourceEdgeId, projectionEdgeId });
    }
  });
  const stages = topologicalStages(sourceNodes, sourceEdges, flow.id);
  return {
    id: flow.id,
    title: flow.title,
    description: flow.description,
    order: flow.order,
    source: clone(flow.source),
    projection: clone(flow.projection),
    focusNodeIds: [...projectionNodeMap.keys()],
    mappedNodeIds: [...projectionNodeMap.keys()],
    mappedEdgeIds: [...sourceEdgeMap.values()],
    nodes: sourceNodes
      .map((node, sourceOrder) => ({
        sourceNodeId: node.id,
        projectionNodeId: sourceNodeMap.get(node.id) || null,
        step: stages.get(node.id),
        sourceOrder,
        name: node.data?.name || node.id,
        purpose: node.data?.purpose || '',
        sidebarOnly: sidebarNodeIds.has(node.id),
      }))
      .sort((left, right) => left.step - right.step || left.sourceOrder - right.sourceOrder)
      .map(({ sourceOrder, ...node }) => node),
    edges: sourceEdges.map((edge) => ({
      sourceEdgeId: edge.id,
      projectionEdgeId: sourceEdgeMap.get(edge.id) || null,
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      label: edge.data?.label || '',
      relationType: edge.data?.relationType || null,
      sidebarOnly: sidebarEdgeIds.has(edge.id),
    })),
  };
}

function resolveRegisteredFlowRegistry(raw, { catalog, diagramId, view, readState }) {
  const registry = validateRegisteredFlowRegistry(raw);
  if (!['current', 'target'].includes(view)) {
    return { schemaVersion: REGISTERED_FLOW_SCHEMA_VERSION, diagramId, view, flows: [] };
  }
  const flows = registry.flows
    .filter((flow) => flow.projection.diagramId === diagramId && flow.projection.view === view)
    .map((flow) => resolveFlow(flow, catalog, readState));
  return { schemaVersion: REGISTERED_FLOW_SCHEMA_VERSION, diagramId, view, flows };
}

module.exports = {
  REGISTERED_FLOW_SCHEMA_VERSION,
  canonicalSha256,
  resolveRegisteredFlowRegistry,
  validateRegisteredFlowRegistry,
};
