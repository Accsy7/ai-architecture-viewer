export function evaluateDraftContract(criteria = [], graph = { nodes: [], edges: [] }) {
  const available = new Set([
    ...(graph?.nodes || []).map((node) => `node:${node.id}`),
    ...(graph?.edges || []).map((edge) => `edge:${edge.id}`),
  ]);
  const missingReferences = criteria.flatMap((criterion) => {
    const missingTargetRefs = (criterion.targetRefs || [])
      .filter((reference) => !available.has(`${reference.targetType}:${reference.targetId}`));
    return missingTargetRefs.length ? [{
      criterionId: criterion.id,
      statement: criterion.statement,
      missingTargetRefs,
    }] : [];
  });
  return {
    executable: criteria.length > 0 && missingReferences.length === 0,
    missingReferences,
  };
}

function semanticValue(item, field, side) {
  const target = item?.[side];
  if (!target) return null;
  if (field === 'source' || field === 'target') return target[field] ?? null;
  return target.data?.[field] ?? null;
}

export function sensitiveDraftChanges(items = []) {
  return items.flatMap((item) => {
    const fields = item.targetType === 'node'
      ? ['authorization']
      : item.targetType === 'edge'
        ? ['controlledBoundaryPosture', 'source', 'target']
        : [];
    return fields.filter((field) => {
      if (item.fields?.includes(field)) return true;
      if (item.kind === 'add') return semanticValue(item, field, 'after') !== null;
      if (item.kind === 'remove') return semanticValue(item, field, 'before') !== null;
      return false;
    }).map((field) => ({
      item,
      field,
      before: semanticValue(item, field, 'before'),
      after: semanticValue(item, field, 'after'),
    }));
  });
}
