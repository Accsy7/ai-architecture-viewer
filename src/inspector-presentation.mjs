const CORE_FIELD_KEYS = new Set(['group', 'purpose', 'technical', 'authorization']);

const hasDisplayValue = (value) => value !== null && value !== undefined && value !== '';

export function partitionInspectorFields(nodeFields = [], data = {}) {
  const visibleFields = (Array.isArray(nodeFields) ? nodeFields : [])
    .filter((field) => field && typeof field.key === 'string')
    .filter((field) => !field.optional || hasDisplayValue(data[field.key]));
  const byKey = new Map(visibleFields.map((field) => [field.key, field]));

  return {
    group: byKey.get('group') || null,
    purpose: byKey.get('purpose') || null,
    progress: byKey.get('technical') || null,
    boundary: byKey.get('authorization') || null,
    secondary: visibleFields.filter((field) => !CORE_FIELD_KEYS.has(field.key)),
  };
}

export function understandingEvidence(data = {}) {
  if (!data.humanConfirmed) return [];
  return [{
    sourceKind: 'historical-migration',
    retainedConclusion: typeof data.confirmationNote === 'string' ? data.confirmationNote : '',
    recordedAt: typeof data.confirmedAt === 'string' ? data.confirmedAt : '',
    affectedModuleName: typeof data.name === 'string' ? data.name : '',
  }];
}
