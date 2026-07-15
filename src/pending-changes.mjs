import semanticFields from '../schema/agent-semantic-fields.cjs';

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export const DRAFT_CHANGE_CATEGORIES = Object.freeze([
  'module-added',
  'module-changed',
  'module-removed',
  'relationship-changed',
]);

export const CONTRACT_CHANGE_CATEGORIES = Object.freeze([
  'criterion-added',
  'criterion-changed',
  'criterion-removed',
]);

const NODE_FIELDS = semanticFields.AGENT_NODE_DATA_FIELDS;
const EDGE_FIELDS = semanticFields.AGENT_EDGE_DATA_FIELDS;

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fieldValue(target, field) {
  if (!target) return undefined;
  if (target.id && !target.data && !('source' in target) && !('target' in target)) return target[field];
  if (field === 'source' || field === 'target') return target?.[field];
  return target?.data?.[field];
}

function appliedPatchFieldValue(patch, field) {
  const value = fieldValue(patch, field);
  return value === null ? undefined : value;
}

function changedFields(before, after, fields) {
  return fields.filter((field) => !sameValue(fieldValue(before, field), fieldValue(after, field)));
}

function proposalMatchesContext(proposal, diagramId, view, draft) {
  return proposal?.status === 'draft-applied'
    && proposal.diagramId === diagramId
    && proposal.view === view
    && proposal.application?.draftId === draft?.draftId
    && Number(proposal.application?.draftRevision) <= Number(draft?.draftRevision);
}

function evidenceForIds(proposal, evidenceCatalog, evidenceIds) {
  const ids = new Set(evidenceIds || []);
  const entries = proposal.evidence?.length ? proposal.evidence : evidenceCatalog;
  return clone((entries || []).filter((entry) => ids.has(entry.id)));
}

function sourceRecord(proposal, changeId, changeSummary, evidenceIds, evidenceCatalog) {
  return {
    proposalId: proposal.id,
    proposalTitle: proposal.title,
    proposalSummary: proposal.summary,
    changeId,
    changeSummary,
    application: clone(proposal.application),
    origin: clone(proposal.origin || null),
    evidence: evidenceForIds(proposal, evidenceCatalog, evidenceIds),
  };
}

function graphOperations(proposal, item, evidenceCatalog) {
  if (item.targetType === 'criterion') return [];
  const operations = [];
  for (const [index, change] of (proposal.changes || []).entries()) {
    if (change.targetType !== item.targetType || change.targetId !== item.targetId) continue;
    const source = sourceRecord(proposal, change.id, change.summary, change.evidenceIds, evidenceCatalog);
    if (item.kind === 'add' && change.kind === 'add') operations.push({ field: '__add', source, sequence: index });
    if (item.kind === 'remove' && change.kind === 'remove') operations.push({ field: '__remove', source, sequence: index });
    if (item.kind === 'remove' || change.kind === 'remove') continue;
    const fields = [
      ...(change.patch?.source !== undefined ? ['source'] : []),
      ...(change.patch?.target !== undefined ? ['target'] : []),
      ...Object.keys(change.patch?.data || {}),
    ];
    fields.forEach((field) => {
      if (!item.fields.includes(field)) return;
      if (sameValue(fieldValue(item.after, field), appliedPatchFieldValue(change.patch || {}, field))) {
        operations.push({ field, source, sequence: index });
      }
    });
  }
  return operations;
}

function contractOperations(proposal, item, evidenceCatalog) {
  if (item.targetType !== 'criterion') return [];
  const operations = [];
  for (const criterion of proposal.contractPatch?.upsert || []) {
    if (criterion.id !== item.targetId || item.kind === 'remove') continue;
    const source = sourceRecord(proposal, `contract-upsert:${criterion.id}`, criterion.statement, criterion.evidenceIds, evidenceCatalog);
    if (item.kind === 'add') operations.push({ field: '__add', source, sequence: 0 });
    ['statement', 'targetRefs'].forEach((field) => {
      if (item.fields.includes(field) && sameValue(item.after?.[field], criterion[field])) {
        operations.push({ field, source, sequence: 0 });
      }
    });
  }
  for (const operation of proposal.contractPatch?.delete || []) {
    if (operation.id !== item.targetId || item.kind !== 'remove') continue;
    operations.push({
      field: '__remove',
      source: sourceRecord(proposal, `contract-delete:${operation.id}`, operation.summary || operation.id, operation.evidenceIds, evidenceCatalog),
      sequence: 0,
    });
  }
  for (const criterion of proposal.acceptanceCriteria || []) {
    if (criterion.id !== item.targetId || item.kind !== 'add') continue;
    const source = sourceRecord(proposal, `legacy-criterion-add:${criterion.id}`, criterion.statement, proposal.evidenceIds, evidenceCatalog);
    operations.push({ field: '__add', source, sequence: 0 });
    ['statement', 'targetRefs'].forEach((field) => {
      if (item.fields.includes(field) && sameValue(item.after?.[field], criterion[field])) operations.push({ field, source, sequence: 0 });
    });
  }
  return operations;
}

function provenanceForItem(item, proposals, evidenceCatalog, currentDraftRevision) {
  const coverageFields = item.kind === 'add'
    ? ['__add', ...item.fields]
    : item.kind === 'remove' ? ['__remove'] : item.fields;
  const operations = proposals.flatMap((proposal) => [
    ...graphOperations(proposal, item, evidenceCatalog),
    ...contractOperations(proposal, item, evidenceCatalog),
  ].map((operation) => ({
    ...operation,
    revision: Number(proposal.application?.draftRevision || 0),
  })));
  const knownAgentRevisions = new Set(proposals.map((proposal) => Number(proposal.application?.draftRevision || 0)));
  const fields = coverageFields.map((field) => {
    const candidates = operations
      .filter((operation) => operation.field === field)
      .sort((left, right) => right.revision - left.revision || right.sequence - left.sequence);
    const candidate = candidates[0] || null;
    const hasUnknownLaterRevision = candidate && !field.startsWith('__')
      ? Array.from(
        { length: Math.max(0, Number(currentDraftRevision || 0) - candidate.revision) },
        (_, index) => candidate.revision + index + 1,
      ).some((revision) => !knownAgentRevisions.has(revision))
      : false;
    return {
      field,
      source: hasUnknownLaterRevision ? null : candidate?.source || null,
      uncertainAfterRevision: hasUnknownLaterRevision ? candidate.revision : null,
    };
  });
  const grouped = new Map();
  fields.filter((entry) => entry.source).forEach((entry) => {
    const key = `${entry.source.proposalId}:${entry.source.changeId}`;
    if (!grouped.has(key)) grouped.set(key, { ...clone(entry.source), fields: [] });
    grouped.get(key).fields.push(entry.field);
  });
  const unattributedFields = fields.filter((entry) => !entry.source).map((entry) => entry.field);
  const sources = [...grouped.values()].sort((left, right) => (
    Number(right.application?.draftRevision || 0) - Number(left.application?.draftRevision || 0)
  ));
  return {
    status: sources.length === 0 ? 'unattributed' : unattributedFields.length ? 'mixed' : 'agent',
    fields,
    sources,
    unattributedFields,
  };
}

function itemLabel(item) {
  if (item.targetType === 'criterion') {
    return item.after?.statement || item.before?.statement || item.targetId;
  }
  return item.after?.data?.name
    || item.before?.data?.name
    || item.after?.data?.label
    || item.before?.data?.label
    || item.targetId;
}

function makeItem(targetType, targetId, kind, before, after, fields) {
  const category = targetType === 'edge'
    ? 'relationship-changed'
    : kind === 'add'
      ? 'module-added'
      : kind === 'remove'
        ? 'module-removed'
        : 'module-changed';
  const item = {
    id: `draft-diff:${targetType}:${targetId}`,
    targetType,
    targetId,
    kind,
    category,
    displayCategory: targetType === 'edge'
      ? kind === 'add'
        ? 'relationship-added'
        : kind === 'remove'
          ? 'relationship-removed'
          : fields.includes('controlledBoundaryPosture')
            ? 'boundary-changed'
            : 'relationship-changed'
      : category,
    fields,
    before: clone(before || null),
    after: clone(after || null),
  };
  item.label = itemLabel(item);
  return item;
}

function makeCriterionItem(targetId, kind, before, after, fields) {
  const item = {
    id: `draft-diff:criterion:${targetId}`,
    targetType: 'criterion',
    targetId,
    kind,
    category: `criterion-${kind === 'update' ? 'changed' : kind === 'remove' ? 'removed' : 'added'}`,
    displayCategory: `criterion-${kind === 'update' ? 'changed' : kind === 'remove' ? 'removed' : 'added'}`,
    fields,
    before: clone(before || null),
    after: clone(after || null),
  };
  item.label = itemLabel(item);
  return item;
}

export function buildDraftChangeProjection({
  publishedGraph,
  publishedContract = null,
  draft,
  proposals = [],
  evidence = [],
  diagramId,
  view,
}) {
  const draftGraph = draft?.graph;
  if (!publishedGraph || !draftGraph) {
    return {
      totalCount: 0,
      graphChangeCount: 0,
      criterionChangeCount: 0,
      agentAttributedCount: 0,
      partiallyAgentAttributedCount: 0,
      traceableItemCount: 0,
      counts: Object.fromEntries(DRAFT_CHANGE_CATEGORIES.map((category) => [category, 0])),
      criterionCounts: Object.fromEntries(CONTRACT_CHANGE_CATEGORIES.map((category) => [category, 0])),
      items: [],
    };
  }
  const items = [];
  const publishedNodes = new Map((publishedGraph.nodes || []).map((node) => [node.id, node]));
  const draftNodes = new Map((draftGraph.nodes || []).map((node) => [node.id, node]));
  const publishedEdges = new Map((publishedGraph.edges || []).map((edge) => [edge.id, edge]));
  const draftEdges = new Map((draftGraph.edges || []).map((edge) => [edge.id, edge]));

  for (const [id, node] of draftNodes) {
    const before = publishedNodes.get(id);
    if (!before) items.push(makeItem('node', id, 'add', null, node, NODE_FIELDS.filter((field) => fieldValue(node, field) !== undefined)));
    else {
      const fields = changedFields(before, node, NODE_FIELDS);
      if (fields.length) items.push(makeItem('node', id, 'update', before, node, fields));
    }
  }
  for (const [id, node] of publishedNodes) {
    if (!draftNodes.has(id)) items.push(makeItem('node', id, 'remove', node, null, []));
  }
  for (const [id, edge] of draftEdges) {
    const before = publishedEdges.get(id);
    if (!before) items.push(makeItem('edge', id, 'add', null, edge, ['source', 'target', ...EDGE_FIELDS.filter((field) => fieldValue(edge, field) !== undefined)]));
    else {
      const fields = changedFields(before, edge, ['source', 'target', ...EDGE_FIELDS]);
      if (fields.length) items.push(makeItem('edge', id, 'update', before, edge, fields));
    }
  }
  for (const [id, edge] of publishedEdges) {
    if (!draftEdges.has(id)) items.push(makeItem('edge', id, 'remove', edge, null, []));
  }

  if (view === 'target' && draft.developmentContract) {
    const publishedCriteria = new Map((publishedContract?.acceptanceCriteria || []).map((criterion) => [criterion.id, criterion]));
    const draftCriteria = new Map((draft.developmentContract.acceptanceCriteria || []).map((criterion) => [criterion.id, criterion]));
    for (const [id, criterion] of draftCriteria) {
      const before = publishedCriteria.get(id);
      if (!before) items.push(makeCriterionItem(id, 'add', null, criterion, ['statement', 'targetRefs']));
      else {
        const fields = ['statement', 'targetRefs'].filter((field) => !sameValue(before[field], criterion[field]));
        if (fields.length) items.push(makeCriterionItem(id, 'update', before, criterion, fields));
      }
    }
    for (const [id, criterion] of publishedCriteria) {
      if (!draftCriteria.has(id)) items.push(makeCriterionItem(id, 'remove', criterion, null, []));
    }
  }

  const relevantProposals = proposals.filter((proposal) => proposalMatchesContext(proposal, diagramId, view, draft));
  items.forEach((item) => {
    item.provenance = provenanceForItem(item, relevantProposals, evidence, draft.draftRevision);
    item.agentSources = item.provenance.sources;
    item.agentSource = item.agentSources[0] || null;
    item.agentAttributed = item.provenance.status === 'agent';
    item.partiallyAgentAttributed = item.provenance.status === 'mixed';
  });
  const categories = [...DRAFT_CHANGE_CATEGORIES, ...CONTRACT_CHANGE_CATEGORIES];
  items.sort((left, right) => (
    categories.indexOf(left.category) - categories.indexOf(right.category)
    || left.targetId.localeCompare(right.targetId)
  ));
  const counts = Object.fromEntries(DRAFT_CHANGE_CATEGORIES.map((category) => [category, 0]));
  const criterionCounts = Object.fromEntries(CONTRACT_CHANGE_CATEGORIES.map((category) => [category, 0]));
  items.forEach((item) => {
    if (item.targetType === 'criterion') criterionCounts[item.category] += 1;
    else counts[item.category] += 1;
  });
  const graphChangeCount = items.filter((item) => item.targetType !== 'criterion').length;
  const criterionChangeCount = items.length - graphChangeCount;
  const agentAttributedCount = items.filter((item) => item.agentAttributed).length;
  const partiallyAgentAttributedCount = items.filter((item) => item.partiallyAgentAttributed).length;
  return {
    totalCount: items.length,
    graphChangeCount,
    criterionChangeCount,
    agentAttributedCount,
    partiallyAgentAttributedCount,
    traceableItemCount: agentAttributedCount + partiallyAgentAttributedCount,
    counts,
    criterionCounts,
    items,
  };
}

function marker(item) {
  return {
    id: item.id,
    category: item.category,
    kind: item.kind,
    targetType: item.targetType,
    targetId: item.targetId,
    fields: clone(item.fields),
    agentAttributed: item.agentAttributed,
    provenanceStatus: item.provenance?.status || 'unattributed',
  };
}

export function decorateFlowWithDraftChanges(
  draftNodes = [],
  draftEdges = [],
  publishedNodes = [],
  publishedEdges = [],
  items = [],
) {
  const nodes = draftNodes.map((node) => ({ ...node, data: { ...node.data } }));
  const edges = draftEdges.map((edge) => ({ ...edge, data: { ...edge.data } }));
  const publishedNodeMap = new Map(publishedNodes.map((node) => [node.id, node]));
  const publishedEdgeMap = new Map(publishedEdges.map((edge) => [edge.id, edge]));

  items.forEach((item) => {
    if (item.targetType === 'criterion') return;
    const draftMarker = marker(item);
    if (item.targetType === 'node') {
      let index = nodes.findIndex((node) => node.id === item.targetId);
      if (index < 0 && item.kind === 'remove' && publishedNodeMap.has(item.targetId)) {
        const source = publishedNodeMap.get(item.targetId);
        nodes.push({ ...clone(source), draggable: false, data: { ...clone(source.data), __draftRemoval: true, __draftChanges: [draftMarker] } });
        return;
      }
      if (index < 0) return;
      nodes[index] = {
        ...nodes[index],
        data: {
          ...nodes[index].data,
          __draftAddition: item.kind === 'add',
          __draftChanges: [...(nodes[index].data?.__draftChanges || []), draftMarker],
        },
      };
      return;
    }
    let index = edges.findIndex((edge) => edge.id === item.targetId);
    if (index < 0 && item.kind === 'remove' && publishedEdgeMap.has(item.targetId)) {
      const source = publishedEdgeMap.get(item.targetId);
      edges.push({ ...clone(source), data: { ...clone(source.data), __draftRemoval: true, __draftChanges: [draftMarker] } });
      return;
    }
    if (index < 0) return;
    edges[index] = {
      ...edges[index],
      data: {
        ...edges[index].data,
        __draftAddition: item.kind === 'add',
        __draftChanges: [...(edges[index].data?.__draftChanges || []), draftMarker],
      },
    };
  });
  return { nodes, edges };
}

export function draftChangeFields(item) {
  return clone(item?.fields || []);
}
