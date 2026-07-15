import { useEffect, useMemo, useState } from 'react';
import {
  documentAuthorityLabel,
  documentStatusLabel,
  documentTypeLabel,
  documentWarnings,
} from '../document-model.js';

const RELATION_LABELS = {
  flow: '主流程',
  support: '支持',
  reference: '引用',
  governance: '治理',
  handoff: '交接',
};

const POSTURE_LABELS = {
  none: '一般关系',
  controlled: '受控边界',
  blocked: '当前阻断',
};

function ViewerField({ label, value, multiline, tone, format = 'text' }) {
  const text = value === null || value === undefined || value === '' ? '未说明' : String(value);
  return (
    <div className={`viewer-field ${multiline ? 'is-multiline' : ''} ${tone ? `tone-${tone}` : ''}`}>
      <span>{label}</span>
      {format === 'tags' && Array.isArray(value)
        ? <p className="viewer-field-tags">{value.map((item) => <em key={item}>{item}</em>)}</p>
        : <p>{text}</p>}
    </div>
  );
}

function RelatedDocuments({ node, documents, onPreviewDocument }) {
  const refs = Array.isArray(node.data?.documentRefs) ? node.data.documentRefs : [];
  const index = useMemo(() => new Map(documents.map((document) => [document.id, document])), [documents]);
  const warnings = documentWarnings(refs, documents);

  return (
    <section className="related-documents">
      <div className="related-documents-summary">
        <strong>相关文档 {refs.length}</strong>
        <span>文档关系由 AI 随架构内容维护；你可以直接在这里阅读。</span>
      </div>
      {warnings.length > 0 && (
        <div className="module-document-warning">
          <strong>发现 {warnings.length} 项引用提示</strong>
          <ul>{warnings.map((warning, indexValue) => <li key={`${warning.documentId}-${warning.code}-${indexValue}`}>{warning.message}</li>)}</ul>
        </div>
      )}
      <div className="bound-document-list">
        {!refs.length && <p className="inspector-placeholder">这个模块暂未关联文档。</p>}
        {refs.map((ref) => {
          const document = index.get(ref);
          if (!document) {
            return (
              <article className="bound-document missing" key={ref}>
                <div className="bound-document-heading"><strong>{ref}</strong><span>引用失效</span></div>
                <p>登记册中没有找到这份文档。</p>
              </article>
            );
          }
          return (
            <article className={`bound-document status-${document.status}`} key={document.id}>
              <div className="bound-document-heading">
                <strong>{document.title}</strong>
                <span>{documentStatusLabel(document.status)}</span>
              </div>
              <code>{document.path}</code>
              <p>{documentTypeLabel(document.type)} · {documentAuthorityLabel(document.authority)}</p>
              {document.summary && <p>{document.summary}</p>}
              <div className="bound-document-actions">
                <button type="button" onClick={() => onPreviewDocument(document)}>打开文档</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function ViewerDetailPanel({
  selectedNode,
  selectedEdge,
  nodes,
  edges,
  documents,
  nodeFields,
  onSelectEdge,
  onPreviewDocument,
  childDiagram,
  relatedDiagram,
  onOpenChild,
  onOpenRelated,
  canCorrect,
  onCorrectNode,
}) {
  const [activeTab, setActiveTab] = useState('module');
  const nodeNames = useMemo(() => new Map(nodes.map((node) => [node.id, node.data?.name || node.id])), [nodes]);
  useEffect(() => { setActiveTab('module'); }, [selectedNode?.id]);

  if (selectedEdge) {
    return (
      <aside className="inspector" aria-label="关系详情">
        <div className="inspector-heading">
          <span className="aside-mark">↗</span>
          <div><p className="kicker">关系</p><h2>连接详情</h2></div>
        </div>
        <p className="relation-route">
          {nodeNames.get(selectedEdge.source) || selectedEdge.source}
          <span>→</span>
          {nodeNames.get(selectedEdge.target) || selectedEdge.target}
        </p>
        <ViewerField label="关系说明" value={selectedEdge.data?.label} multiline />
        <ViewerField label="关系类型" value={RELATION_LABELS[selectedEdge.data?.relationType] || selectedEdge.data?.relationType} />
        <ViewerField label="边界状态" value={POSTURE_LABELS[selectedEdge.data?.controlledBoundaryPosture] || selectedEdge.data?.controlledBoundaryPosture} />
        <p className="viewer-routing-note">连接端口和直角路径由查看器根据卡片位置自动计算。</p>
      </aside>
    );
  }

  if (selectedNode) {
    const relatedEdges = edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id);
    const fields = Array.isArray(nodeFields) ? nodeFields : [];
    return (
      <aside className="inspector" aria-label="模块详情">
        <div className="inspector-heading">
          <span className="aside-mark">◎</span>
          <div><p className="kicker">模块</p><h2>{selectedNode.data?.name || selectedNode.id}</h2></div>
        </div>
        {(childDiagram || relatedDiagram || canCorrect) && (
          <div className="viewer-node-actions">
            {childDiagram && (
              <button className="primary" type="button" onClick={() => onOpenChild(childDiagram.id)}>
                打开{childDiagram.title} <span aria-hidden="true">→</span>
              </button>
            )}
            {relatedDiagram && (
              <button className={childDiagram ? '' : 'primary'} type="button" onClick={() => onOpenRelated(relatedDiagram.id, selectedNode.data?.relatedNodeId)}>
                查看{relatedDiagram.title} <span aria-hidden="true">→</span>
              </button>
            )}
            {canCorrect && <button type="button" onClick={onCorrectNode}>纠正 AI 理解</button>}
          </div>
        )}
        <div className="inspector-tabs" role="tablist" aria-label="模块信息">
          <button type="button" role="tab" aria-selected={activeTab === 'module'} className={activeTab === 'module' ? 'active' : ''} onClick={() => setActiveTab('module')}>模块说明</button>
          <button type="button" role="tab" aria-selected={activeTab === 'documents'} className={activeTab === 'documents' ? 'active' : ''} onClick={() => setActiveTab('documents')}>
            相关文档 <span>{selectedNode.data?.documentRefs?.length || 0}</span>
          </button>
        </div>

        {activeTab === 'documents' ? (
          <RelatedDocuments node={selectedNode} documents={documents} onPreviewDocument={onPreviewDocument} />
        ) : (
          <>
            {selectedNode.data?.compareStatus && <ViewerField label="对比状态" value={selectedNode.data.compareStatus} />}
            {selectedNode.data?.humanConfirmed && (
              <section className="human-confirmation-card">
                <strong>人工已确认</strong>
                <p>{selectedNode.data.confirmationNote}</p>
                {selectedNode.data.confirmedAt && <time dateTime={selectedNode.data.confirmedAt}>{new Date(selectedNode.data.confirmedAt).toLocaleString('zh-CN')}</time>}
              </section>
            )}
            {fields
              .filter((field) => !field.optional || ![null, undefined, ''].includes(selectedNode.data?.[field.key]))
              .map((field) => (
              <ViewerField
                key={field.key}
                label={field.label}
                value={selectedNode.data?.[field.key]}
                multiline={field.multiline}
                tone={field.tone}
                format={field.format}
              />
              ))}
            <section className="relations-list">
              <h3>关联关系 <span>{relatedEdges.length}</span></h3>
              {!relatedEdges.length && <p className="inspector-placeholder">这个模块暂未连接其他模块。</p>}
              {relatedEdges.map((edge) => {
                const outgoing = edge.source === selectedNode.id;
                const otherId = outgoing ? edge.target : edge.source;
                return (
                  <button className="relation-row" type="button" key={edge.id} onClick={() => onSelectEdge(edge.id)}>
                    <span>{outgoing ? '→' : '←'} {nodeNames.get(otherId) || otherId}</span>
                    <small>{edge.data?.label || RELATION_LABELS[edge.data?.relationType] || '关联'}</small>
                  </button>
                );
              })}
            </section>
          </>
        )}
      </aside>
    );
  }

  return (
    <aside className="inspector inspector-empty" aria-label="架构说明">
      <span className="aside-mark">◎</span>
      <h2>选择一个模块</h2>
      <p>查看它在架构中的职责、状态、相关关系和绑定文档。</p>
    </aside>
  );
}
