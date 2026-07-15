import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { draftChangeFields } from '../pending-changes.mjs';
import '../pending-changes.css';

function SourceSummary({ item, onLocateEvidence }) {
  const { t } = useI18n();
  const sources = item.agentSources || [];
  const unattributedFields = item.provenance?.unattributedFields || [];
  if (!sources.length) {
    return <p className="pending-unattributed">{t('pending.unattributed')}</p>;
  }
  return (
    <div className="pending-source-summary">
      {item.provenance?.status === 'mixed' && <p className="pending-mixed-warning">{t('pending.mixedAttribution')}</p>}
      {sources.map((source) => (
        <div className="pending-source-record" key={`${source.proposalId}:${source.changeId}`}>
          <span>{t('pending.source')}</span>
          <strong>{source.origin?.agentName || source.origin?.agentClient || t('common.unknown')}</strong>
          <code>{source.origin?.runId || source.proposalId}</code>
          <small>{source.changeSummary || source.proposalSummary}</small>
          <div className="pending-source-fields">
            {source.fields.map((field) => <b key={field}>{t(`fields.${field}`, {}, field)}</b>)}
          </div>
          <span>{t('pending.evidence')}</span>
          {source.evidence.length ? source.evidence.map((entry) => (
            <button className="pending-evidence-link" type="button" key={entry.id} onClick={() => onLocateEvidence?.(entry)}>
              <b>{t(`proposal.basis.${entry.basis}`, {}, entry.basis)}</b>
              <small>{entry.excerpt || entry.summary || entry.id}</small>
            </button>
          )) : <small>{t('pending.noEvidence')}</small>}
        </div>
      ))}
      {unattributedFields.length > 0 && (
        <div className="pending-unattributed-fields">
          <span>{t('pending.unattributedFields')}</span>
          <div>{unattributedFields.map((field) => <b key={field}>{t(`fields.${field}`, {}, field)}</b>)}</div>
        </div>
      )}
    </div>
  );
}

export default function PendingChangesLayer({
  open,
  projection,
  onToggle,
  onLocateEvidence,
}) {
  const { t } = useI18n();
  const items = projection?.items || [];
  const counts = projection?.counts || {};
  const criterionCounts = projection?.criterionCounts || {};
  const [selectedId, setSelectedId] = useState(null);
  const selected = items.find((item) => item.id === selectedId) || items[0] || null;
  useEffect(() => {
    if (!items.length) setSelectedId(null);
    else if (!items.some((item) => item.id === selectedId)) setSelectedId(items[0].id);
  }, [items, selectedId]);

  if (!items.length) return null;
  const allAgent = projection.agentAttributedCount === projection.totalCount;
  return (
    <>
      <div className="pending-change-notice" role="status">
        <div>
          <span className="pending-change-notice__mark" aria-hidden="true">△</span>
          <div>
            <strong>{t('pending.noticeSplit', {
              graph: projection.graphChangeCount || 0,
              criteria: projection.criterionChangeCount || 0,
            })}</strong>
            <span className="pending-attribution-summary">{allAgent
              ? t('pending.noticeAllAgent', { count: projection.totalCount })
              : t('pending.noticeMixed', {
                total: projection.totalCount,
                agent: projection.agentAttributedCount,
                mixed: projection.partiallyAgentAttributedCount || 0,
              })}</span>
            <small>{t('pending.safeBoundary')}</small>
          </div>
        </div>
        <div className="pending-change-counts" aria-label={t('pending.title')}>
          {['module-added', 'module-changed', 'module-removed', 'relationship-changed'].map((category) => (
            <span key={category}>{t(`pending.count.${category}`, { count: counts[category] || 0 })}</span>
          ))}
          {projection.criterionChangeCount > 0 && ['criterion-added', 'criterion-changed', 'criterion-removed'].map((category) => (
            <span key={category}>{t(`pending.count.${category}`, { count: criterionCounts[category] || 0 })}</span>
          ))}
        </div>
        <button type="button" className={open ? 'quiet' : 'primary'} onClick={onToggle}>
          {open ? t('pending.hide') : t('pending.open')}
        </button>
      </div>

      {open && selected && (
        <aside className="pending-change-panel" aria-label={t('pending.title')}>
          <header>
            <div>
              <p className="kicker">DRAFT VS PUBLISHED</p>
              <h3>{t('pending.title')}</h3>
              <small>{t('pending.readOnlyDescription')}</small>
            </div>
            <button className="quiet" type="button" onClick={onToggle} aria-label={t('common.close')}>×</button>
          </header>

          <div className="pending-change-list" role="listbox" aria-label={t('pending.title')}>
            {items.map((item) => (
              <button
                type="button"
                role="option"
                aria-selected={item.id === selected.id}
                className={item.id === selected.id ? 'selected' : ''}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <span className={`pending-kind is-${item.category}`}>{t(`pending.category.${item.displayCategory || item.category}`)}</span>
                <strong>{item.label}</strong>
                <small>{item.agentAttributed
                  ? t('pending.traceableAgent')
                  : item.partiallyAgentAttributed ? t('pending.mixedSource') : t('pending.sourceUnknown')}</small>
              </button>
            ))}
          </div>

          <section className="pending-change-detail">
            <div className="pending-change-detail__heading">
              <span className={`pending-kind is-${selected.category}`}>{t(`pending.category.${selected.displayCategory || selected.category}`)}</span>
              <code>{selected.targetType}:{selected.targetId}</code>
            </div>
            <h4>{selected.label}</h4>
            {selected.targetType === 'criterion' && (
              <div className="pending-contract-comparison">
                <div>
                  <span>{t('pending.before')}</span>
                  <p>{selected.before?.statement || t('common.none')}</p>
                  {selected.before?.targetRefs?.length > 0 && <code>{selected.before.targetRefs.map((ref) => `${ref.targetType}:${ref.targetId}`).join(' · ')}</code>}
                </div>
                <div>
                  <span>{t('pending.after')}</span>
                  <p>{selected.after?.statement || t('common.none')}</p>
                  {selected.after?.targetRefs?.length > 0 && <code>{selected.after.targetRefs.map((ref) => `${ref.targetType}:${ref.targetId}`).join(' · ')}</code>}
                </div>
              </div>
            )}
            <div className="pending-field-list">
              <span>{t('pending.fields')}</span>
              {draftChangeFields(selected).length
                ? draftChangeFields(selected).map((field) => <b key={field}>{t(`fields.${field}`, {}, field)}</b>)
                : <b>{t(`proposal.kind.${selected.kind}`, {}, selected.kind)}</b>}
            </div>
            <SourceSummary item={selected} onLocateEvidence={onLocateEvidence} />
          </section>

          <footer className="pending-publication-boundary">
            <strong>{t('pending.publicationGate')}</strong>
            <small>{t('pending.publicationHelp')}</small>
          </footer>
        </aside>
      )}
    </>
  );
}
