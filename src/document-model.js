export const DOCUMENT_TYPES = [
  ['current_fact', '当前事实'],
  ['target_design', '目标设计'],
  ['technical_spec', '技术说明'],
  ['decision', '决策记录'],
  ['work_package', '工作包'],
  ['acceptance_evidence', '验收证据'],
  ['risk_question', '风险与问题'],
  ['other', '其他'],
];

export const DOCUMENT_AUTHORITIES = [
  ['source_of_truth', '事实依据'],
  ['supporting', '支撑材料'],
  ['reference', '参考资料'],
  ['candidate', '候选材料'],
];

export const DOCUMENT_STATUSES = [
  ['active', '有效'],
  ['draft', '草稿'],
  ['superseded', '已被替代'],
  ['archived', '已归档'],
];

const labels = (entries) => new Map(entries);
const typeLabels = labels(DOCUMENT_TYPES);
const authorityLabels = labels(DOCUMENT_AUTHORITIES);
const statusLabels = labels(DOCUMENT_STATUSES);

export const documentTypeLabel = (value) => typeLabels.get(value) || value || '未分类';
export const documentAuthorityLabel = (value) => authorityLabels.get(value) || value || '未标注';
export const documentStatusLabel = (value) => statusLabels.get(value) || value || '未标注';

export function diagnosticMessage(diagnostic) {
  if (typeof diagnostic === 'string') return diagnostic;
  return diagnostic?.message || diagnostic?.code || '文档状态需要检查';
}

export function isBlockingDocument(document) {
  if (!document) return true;
  if (['archived', 'superseded'].includes(document.status)) return true;
  return (document.diagnostics || []).some((item) => {
    if (typeof item !== 'object') return false;
    if (item.severity === 'error') return true;
    return /broken|missing|invalid|unsafe|escape|symlink|junction/i.test(item.code || '');
  });
}

export function documentWarnings(documentRefs, documents) {
  const index = new Map(documents.map((document) => [document.id, document]));
  return (documentRefs || []).flatMap((documentId) => {
    const document = index.get(documentId);
    if (!document) return [{ documentId, code: 'missing', message: '绑定的文档登记项不存在' }];
    const statusWarning = ['archived', 'superseded'].includes(document.status)
      ? [{ documentId, code: document.status, message: `文档${documentStatusLabel(document.status)}` }]
      : [];
    const candidates = [
      ...statusWarning,
      ...(document.diagnostics || [])
        .filter((item) => (
          typeof item !== 'object'
          || (item.code !== 'orphaned' && ['warning', 'error'].includes(item.severity))
        ))
        .map((item) => ({
          documentId,
          code: typeof item === 'object' ? item.code : 'diagnostic',
          message: diagnosticMessage(item),
        })),
    ];
    const seen = new Set();
    return candidates.filter((item) => {
      const key = String(item.code || item.message).toLocaleLowerCase('zh-CN');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}

export function enrichNodesWithDocuments(nodes, documents) {
  return nodes.map((node) => {
    const documentRefs = Array.isArray(node.data?.documentRefs) ? node.data.documentRefs : [];
    return {
      ...node,
      data: {
        ...node.data,
        documentCount: documentRefs.length,
        documentWarningCount: documentWarnings(documentRefs, documents).length,
      },
    };
  });
}
