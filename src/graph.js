import { MarkerType } from '@xyflow/react';
import { normalizeRoutingData } from './routing.mjs';

export const DEFAULT_NODE_WIDTH = 260;
export const DEFAULT_NODE_HEIGHT = 150;
export const NODE_MIN_WIDTH = 160;
export const NODE_MAX_WIDTH = 720;
export const NODE_MIN_HEIGHT = 96;
export const NODE_MAX_HEIGHT = 520;

const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const rounded = (value) => Math.round(value * 100) / 100;

const semanticData = (data = {}) => ({
  name: String(data.name || '未命名模块'),
  group: String(data.group || '待归类'),
  purpose: String(data.purpose || ''),
  technical: String(data.technical || '待确认'),
  product: String(data.product || '待你评审'),
  authorization: String(data.authorization || '仅设计'),
  ...(data.horizon ? { horizon: data.horizon } : {}),
  ...(typeof data.focus === 'boolean' ? { focus: data.focus } : {}),
  ...(data.buildStrategy ? { buildStrategy: String(data.buildStrategy) } : {}),
  ...(data.aiCollaboration ? { aiCollaboration: String(data.aiCollaboration) } : {}),
  ...(data.relatedDiagramId ? { relatedDiagramId: String(data.relatedDiagramId) } : {}),
  ...(data.relatedNodeId ? { relatedNodeId: String(data.relatedNodeId) } : {}),
  ...(typeof data.humanConfirmed === 'boolean' ? { humanConfirmed: data.humanConfirmed } : {}),
  ...(data.confirmationNote ? { confirmationNote: String(data.confirmationNote) } : {}),
  ...(data.confirmedAt ? { confirmedAt: String(data.confirmedAt) } : {}),
  ...(Array.isArray(data.documentRefs)
    ? { documentRefs: data.documentRefs.filter((item) => typeof item === 'string') }
    : {}),
});

export function canonicalNodeToFlow(node) {
  const width = clamp(finite(node.width, DEFAULT_NODE_WIDTH), NODE_MIN_WIDTH, NODE_MAX_WIDTH);
  const height = clamp(finite(node.height, DEFAULT_NODE_HEIGHT), NODE_MIN_HEIGHT, NODE_MAX_HEIGHT);
  return {
    id: node.id,
    type: 'architectureNode',
    position: {
      x: finite(node.position?.x, 0),
      y: finite(node.position?.y, 0),
    },
    width,
    height,
    style: { width, height },
    data: {
      ...semanticData(node.data),
      ...(node.data?.compareStatus ? { compareStatus: node.data.compareStatus } : {}),
      ...(node.data?.compareClass ? { compareClass: node.data.compareClass } : {}),
    },
  };
}

export function styleFlowEdge(edge) {
  const posture = edge.data?.controlledBoundaryPosture || 'none';
  const relationType = edge.data?.relationType || 'flow';
  const blocked = posture === 'blocked';
  const controlled = posture === 'controlled';
  const support = relationType === 'support' || relationType === 'reference';
  const color = blocked ? '#a44539' : controlled ? '#9a641a' : '#73847b';
  return {
    ...edge,
    type: 'architectureEdge',
    label: edge.data?.label || '关联',
    className: `architecture-edge edge-${relationType} edge-${posture}`,
    style: {
      stroke: color,
      strokeWidth: blocked ? 2 : 1.7,
      strokeDasharray: blocked ? '7 5' : support ? '5 5' : undefined,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    labelStyle: { fill: color, fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: '#fbfcf9', fillOpacity: 0.94 },
    labelBgPadding: [5, 3],
    labelBgBorderRadius: 5,
  };
}

export function canonicalEdgeToFlow(edge) {
  const routing = normalizeRoutingData(edge.data);
  return styleFlowEdge({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: {
      label: String(edge.data?.label || '关联'),
      relationType: edge.data?.relationType || 'flow',
      controlledBoundaryPosture: edge.data?.controlledBoundaryPosture || 'none',
      ...routing,
    },
  });
}

export function canonicalGraphToFlow(graph = { nodes: [], edges: [] }) {
  return {
    nodes: (graph.nodes || []).map(canonicalNodeToFlow),
    edges: (graph.edges || []).map(canonicalEdgeToFlow),
  };
}

function dimension(node, key, fallback) {
  const measured = node.measured?.[key];
  const styled = Number.parseFloat(node.style?.[key]);
  return finite(measured, finite(styled, finite(node[key], fallback)));
}

export function flowGraphToCanonical(nodes, edges) {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: 'architectureNode',
      position: {
        x: rounded(finite(node.position?.x, 0)),
        y: rounded(finite(node.position?.y, 0)),
      },
      width: rounded(clamp(dimension(node, 'width', DEFAULT_NODE_WIDTH), NODE_MIN_WIDTH, NODE_MAX_WIDTH)),
      height: rounded(clamp(dimension(node, 'height', DEFAULT_NODE_HEIGHT), NODE_MIN_HEIGHT, NODE_MAX_HEIGHT)),
      data: semanticData(node.data),
    })),
    edges: edges.map((edge) => {
      const routing = normalizeRoutingData(edge.data);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.type && !['smoothstep', 'architectureEdge'].includes(edge.type) ? { type: edge.type } : {}),
        data: {
          label: String(edge.data?.label || '关联'),
          relationType: edge.data?.relationType || 'flow',
          controlledBoundaryPosture: edge.data?.controlledBoundaryPosture || 'none',
          ...routing,
        },
      };
    }),
  };
}

export function createFlowNode(position, view, index) {
  const suffix = `${Date.now().toString(36)}-${index.toString(36)}`;
  return canonicalNodeToFlow({
    id: `node-${suffix}`.slice(0, 80),
    type: 'architectureNode',
    position,
    width: DEFAULT_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT,
    data: {
      name: `新模块 ${index}`,
      group: '待归类',
      purpose: '请在右侧补充这个模块的职责与边界。',
      technical: view === 'target' ? '目标能力，尚未实现' : '设计目标',
      product: '待你评审',
      authorization: '仅设计',
      ...(view === 'target' ? { horizon: '近期' } : {}),
      documentRefs: [],
    },
  });
}

export function createFlowEdge(connection, index) {
  const manualPorts = connection.sourceHandle && connection.targetHandle
    ? {
      routingMode: 'manual',
      sourcePort: connection.sourceHandle,
      targetPort: connection.targetHandle,
    }
    : { routingMode: 'auto' };
  return styleFlowEdge({
    id: `edge-${Date.now().toString(36)}-${index.toString(36)}`.slice(0, 80),
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    data: {
      label: '关联',
      relationType: 'flow',
      controlledBoundaryPosture: 'none',
      ...normalizeRoutingData(manualPorts),
    },
  });
}

export function visibleGraph(lane) {
  return lane?.draft?.graph || lane?.published?.graph || { nodes: [], edges: [] };
}

export function diffSummary(publishedGraph, draftGraph) {
  const published = publishedGraph || { nodes: [], edges: [] };
  const draft = draftGraph || { nodes: [], edges: [] };
  const previousNodes = new Map(published.nodes.map((node) => [node.id, node]));
  const nextNodes = new Map(draft.nodes.map((node) => [node.id, node]));
  let layout = 0;
  let structural = 0;
  let semantic = 0;
  let documentBindings = 0;

  const withoutDocumentRefs = (data = {}) => {
    const copy = { ...data };
    delete copy.documentRefs;
    return copy;
  };

  const documentSignature = (data = {}) => JSON.stringify(
    [...(Array.isArray(data.documentRefs) ? data.documentRefs : [])].sort(),
  );

  nextNodes.forEach((node, id) => {
    const previous = previousNodes.get(id);
    if (!previous) {
      structural += 1;
      return;
    }
    if (
      previous.position?.x !== node.position?.x ||
      previous.position?.y !== node.position?.y ||
      previous.width !== node.width ||
      previous.height !== node.height
    ) layout += 1;
    if (JSON.stringify(withoutDocumentRefs(previous.data)) !== JSON.stringify(withoutDocumentRefs(node.data))) semantic += 1;
    if (documentSignature(previous.data) !== documentSignature(node.data)) documentBindings += 1;
  });
  previousNodes.forEach((_, id) => {
    if (!nextNodes.has(id)) structural += 1;
  });

  const signature = (edge) => `${edge.source}>${edge.target}:${JSON.stringify(edge.data || {})}`;
  const previousEdges = new Set(published.edges.map(signature));
  const nextEdges = new Set(draft.edges.map(signature));
  let relationship = 0;
  nextEdges.forEach((value) => { if (!previousEdges.has(value)) relationship += 1; });
  previousEdges.forEach((value) => { if (!nextEdges.has(value)) relationship += 1; });
  return {
    structural,
    semantic,
    layout,
    document: documentBindings,
    relationship,
  };
}
