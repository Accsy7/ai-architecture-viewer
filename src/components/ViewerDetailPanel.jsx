import { useEffect, useMemo, useState } from 'react';
import {
  documentAuthorityLabel,
  documentStatusLabel,
  documentTypeLabel,
  documentWarnings,
} from '../document-model.js';
import { partitionInspectorFields, understandingEvidence } from '../inspector-presentation.mjs';
import { useI18n } from '../i18n.jsx';

function ViewerField({ label, value, multiline, tone, format = 'text', variant }) {
  const { t } = useI18n();
  const text = value === null || value === undefined || value === '' ? t('details.unspecified') : String(value);
  return (
    <div className={`viewer-field ${multiline ? 'is-multiline' : ''} ${tone ? `tone-${tone}` : ''} ${variant ? `is-${variant}` : ''}`}>
      <span>{label}</span>
      {format === 'tags' && Array.isArray(value)
        ? <p className="viewer-field-tags">{value.map((item) => <em key={item}>{item}</em>)}</p>
        : <p>{text}</p>}
    </div>
  );
}

function RelatedDocuments({ node, documents, onPreviewDocument }) {
  const { t } = useI18n();
  const refs = Array.isArray(node.data?.documentRefs) ? node.data.documentRefs : [];
  const index = useMemo(() => new Map(documents.map((document) => [document.id, document])), [documents]);
  const warnings = documentWarnings(refs, documents);

  return (
    <section className="related-documents">
      <div className="related-documents-summary">
        <strong>{t('details.relatedDocuments', { count: refs.length })}</strong>
        <span>{t('details.documentBoundary')}</span>
      </div>
      {warnings.length > 0 && (
        <div className="module-document-warning">
          <strong>{t('details.referenceWarnings', { count: warnings.length })}</strong>
          <ul>{warnings.map((warning, indexValue) => <li key={`${warning.documentId}-${warning.code}-${indexValue}`}>{warning.message}</li>)}</ul>
        </div>
      )}
      <div className="bound-document-list">
        {!refs.length && <p className="inspector-placeholder">{t('details.noDocuments')}</p>}
        {refs.map((ref) => {
          const document = index.get(ref);
          if (!document) {
            return (
              <article className="bound-document missing" key={ref}>
                <div className="bound-document-heading"><strong>{ref}</strong><span>{t('details.invalidReference')}</span></div>
                <p>{t('details.documentMissing')}</p>
              </article>
            );
          }
          return (
            <article className={`bound-document status-${document.status}`} key={document.id}>
              <div className="bound-document-heading">
                <strong>{document.title}</strong>
                <span>{t(`documents.status.${document.status}`, {}, documentStatusLabel(document.status))}</span>
              </div>
              <code>{document.path}</code>
              <p>{t(`documents.type.${document.type}`, {}, documentTypeLabel(document.type))} · {t(`documents.authority.${document.authority}`, {}, documentAuthorityLabel(document.authority))}</p>
              {document.summary && <p>{document.summary}</p>}
              <div className="bound-document-actions">
                <button type="button" onClick={() => onPreviewDocument(document)}>{t('documents.open')}</button>
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
  relationshipFocused = false,
  availableFlows = [],
  onStartFlow,
}) {
  const { t, formatDateTime } = useI18n();
  const [activeTab, setActiveTab] = useState('module');
  const nodeNames = useMemo(() => new Map(nodes.map((node) => [node.id, node.data?.name || node.id])), [nodes]);
  useEffect(() => { setActiveTab('module'); }, [selectedNode?.id]);

  if (selectedEdge) {
    return (
      <aside className="inspector" aria-label={t('details.relationshipAria')}>
        <div className="inspector-heading">
          <span className="aside-mark">↗</span>
          <div><p className="kicker">{t('details.relationship')}</p><h2>{t('details.connectionDetails')}</h2></div>
        </div>
        <p className="relation-route">
          {nodeNames.get(selectedEdge.source) || selectedEdge.source}
          <span>→</span>
          {nodeNames.get(selectedEdge.target) || selectedEdge.target}
        </p>
        <ViewerField label={t('fields.label')} value={selectedEdge.data?.label} multiline />
        <ViewerField label={t('fields.relationType')} value={t(`relation.${selectedEdge.data?.relationType}`, {}, selectedEdge.data?.relationType)} />
        <ViewerField label={t('details.boundaryState')} value={t(`posture.${selectedEdge.data?.controlledBoundaryPosture}`, {}, selectedEdge.data?.controlledBoundaryPosture)} />
        <p className="viewer-routing-note">{t('details.routingNote')}</p>
      </aside>
    );
  }

  if (selectedNode) {
    const relatedEdges = edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id);
    const fields = Array.isArray(nodeFields) ? nodeFields : [];
    const presentation = partitionInspectorFields(fields, selectedNode.data);
    const evidence = understandingEvidence(selectedNode.data);
    const documentCount = selectedNode.data?.documentRefs?.length || 0;
    const renderConfiguredField = (field, label, variant) => field && (
      <ViewerField
        key={field.key}
        label={label || field.label}
        value={selectedNode.data?.[field.key]}
        multiline={field.multiline}
        tone={field.tone}
        format={field.format}
        variant={variant}
      />
    );
    return (
      <aside className="inspector" aria-label={t('details.moduleAria')}>
        <div className="inspector-heading">
          <span className="aside-mark">◎</span>
          <div>
            <p className="kicker">{t('details.module')}</p>
            <h2>{selectedNode.data?.name || selectedNode.id}</h2>
            {presentation.group && <p className="inspector-group">{selectedNode.data?.group || t('details.unspecified')}</p>}
          </div>
        </div>
        {renderConfiguredField(presentation.purpose, t('details.whatItDoes'), 'core')}
        {(childDiagram || relatedDiagram || canCorrect) && (
          <div className="viewer-node-actions">
            {childDiagram && (
              <button className="primary" type="button" onClick={() => onOpenChild(childDiagram.id)}>
                {t('details.openDiagram', { title: childDiagram.title })} <span aria-hidden="true">→</span>
              </button>
            )}
            {relatedDiagram && (
              <button className={childDiagram ? '' : 'primary'} type="button" onClick={() => onOpenRelated(relatedDiagram.id, selectedNode.data?.relatedNodeId)}>
                {t('details.viewDiagram', { title: relatedDiagram.title })} <span aria-hidden="true">→</span>
              </button>
            )}
            {canCorrect && <button type="button" onClick={onCorrectNode}>{t('details.correctAi')}</button>}
          </div>
        )}
        {relationshipFocused && (
          <p className="relationship-focus-summary">
            {t('focus.oneHopSummary', { count: relatedEdges.length })}
          </p>
        )}
        {relationshipFocused && availableFlows.length > 0 && (
          <section className="registered-flow-entry" aria-label={t('flow.available')}>
            <h3>{t('flow.available')} <span>{availableFlows.length}</span></h3>
            <p>{t('flow.entryHelp')}</p>
            {availableFlows.map((flow) => (
              <button type="button" key={flow.id} onClick={() => onStartFlow(flow.id)}>
                <strong>{flow.title}</strong>
                <small>{t('flow.enter')}</small>
              </button>
            ))}
          </section>
        )}
        <div className="inspector-tabs" role="tablist" aria-label={t('details.moduleInfo')}>
          <button type="button" role="tab" aria-selected={activeTab === 'module'} className={activeTab === 'module' ? 'active' : ''} onClick={() => setActiveTab('module')}>{t('details.overview')}</button>
          <button type="button" role="tab" aria-selected={activeTab === 'documents'} className={activeTab === 'documents' ? 'active' : ''} onClick={() => setActiveTab('documents')}>
            {t('details.documentsTab')} <span>{documentCount}</span>
          </button>
        </div>

        {activeTab === 'documents' ? (
          <RelatedDocuments node={selectedNode} documents={documents} onPreviewDocument={onPreviewDocument} />
        ) : (
          <>
            <details className="inspector-disclosure relationship-disclosure">
              <summary><span>{t('details.directRelationships')}</span><strong>{relatedEdges.length}</strong></summary>
              <section className="relations-list">
                {!relatedEdges.length && <p className="inspector-placeholder">{t('details.noRelationships')}</p>}
                {relatedEdges.map((edge) => {
                  const outgoing = edge.source === selectedNode.id;
                  const otherId = outgoing ? edge.target : edge.source;
                  return (
                    <button className="relation-row" type="button" key={edge.id} onClick={() => onSelectEdge(edge.id)}>
                      <span>{outgoing ? '→' : '←'} {nodeNames.get(otherId) || otherId}</span>
                      <small>{edge.data?.label || t(`relation.${edge.data?.relationType}`, {}, t('details.related'))}</small>
                    </button>
                  );
                })}
              </section>
            </details>

            <section className="inspector-core-status">
              {renderConfiguredField(presentation.progress, t('details.currentProgress'), 'core')}
              {renderConfiguredField(presentation.boundary, t('details.cannotDo'), 'core')}
            </section>

            {(presentation.secondary.length > 0 || selectedNode.data?.compareStatus) && (
              <details className="inspector-disclosure inspector-more">
                <summary><span>{t('details.moreInformation')}</span><strong>{presentation.secondary.length + (selectedNode.data?.compareStatus ? 1 : 0)}</strong></summary>
                <div className="inspector-disclosure-content">
                  {selectedNode.data?.compareStatus && <ViewerField label={t('details.compareStatus')} value={t(`compare.${selectedNode.data.compareStatus}`, {}, selectedNode.data.compareStatus)} />}
                  {presentation.secondary.map((field) => renderConfiguredField(field))}
                </div>
              </details>
            )}

            {evidence.length > 0 && (
              <details className="inspector-disclosure understanding-evidence">
                <summary><span>{t('details.understandingEvidence')}</span><strong>{evidence.length}</strong></summary>
                <div className="understanding-evidence-list">
                  {evidence.map((record, index) => (
                    <article key={`${record.recordedAt || 'undated'}-${index}`}>
                      <div className="understanding-evidence-source">
                        <strong>{t('details.historicalMigrationRecord')}</strong>
                        <span>{t('details.sourceNotRecorded')}</span>
                      </div>
                      <dl>
                        <div><dt>{t('details.retainedConclusion')}</dt><dd>{record.retainedConclusion || t('details.unspecified')}</dd></div>
                        <div><dt>{t('details.affectedUnderstanding')}</dt><dd>{t('details.moduleUnderstanding', { name: record.affectedModuleName || selectedNode.id })}</dd></div>
                        <div>
                          <dt>{t('details.recordedAt')}</dt>
                          <dd>{record.recordedAt ? <time dateTime={record.recordedAt}>{formatDateTime(record.recordedAt)}</time> : t('details.recordedAtUnknown')}</dd>
                        </div>
                      </dl>
                      <small>{t('node.correctionNotPublication')}</small>
                    </article>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </aside>
    );
  }

  return (
    <aside className="inspector inspector-empty" aria-label={t('details.architectureAria')}>
      <span className="aside-mark">◎</span>
      <h2>{t('details.selectModule')}</h2>
      <p>{t('details.selectModuleHelp')}</p>
    </aside>
  );
}
