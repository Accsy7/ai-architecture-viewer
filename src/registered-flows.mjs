export function oneHopProjection(nodes = [], edges = [], focusedNodeId = null) {
  const knownNodeIds = new Set(nodes.map((node) => node.id));
  if (!focusedNodeId || !knownNodeIds.has(focusedNodeId)) {
    return { nodeIds: new Set(), edgeIds: new Set() };
  }
  const nodeIds = new Set([focusedNodeId]);
  const edgeIds = new Set();
  edges.forEach((edge) => {
    if (edge.source !== focusedNodeId && edge.target !== focusedNodeId) return;
    edgeIds.add(edge.id);
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  });
  return { nodeIds, edgeIds };
}

export function availableFlowsForFocus(flows = [], focusedNodeId = null) {
  if (!focusedNodeId) return [];
  return flows.filter((flow) => flow.focusNodeIds?.includes(focusedNodeId));
}

export function sourceNodeForProjection(flow, projectionNodeId) {
  return flow?.nodes?.find((node) => node.projectionNodeId === projectionNodeId) || null;
}

export function projectionNodeForSource(flow, sourceNodeId) {
  return flow?.nodes?.find((node) => node.sourceNodeId === sourceNodeId)?.projectionNodeId || null;
}

export function flowCanvasProjection(flow) {
  return {
    nodeSteps: new Map((flow?.nodes || [])
      .filter((node) => node.projectionNodeId)
      .map((node) => [node.projectionNodeId, node.step])),
    edgeIds: new Set(flow?.mappedEdgeIds || []),
  };
}
