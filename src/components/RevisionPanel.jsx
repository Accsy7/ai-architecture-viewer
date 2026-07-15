import { useI18n } from '../i18n.jsx';

function revisionNumber(revision, t) {
  if (typeof revision.revision === 'number') return `R${revision.revision}`;
  return String(revision.revision || revision.revisionId || t('revision.unknownVersion'));
}

function revisionScale(revision, t) {
  const nodeCount = revision.nodeCount ?? revision.graph?.nodes?.length;
  const edgeCount = revision.edgeCount ?? revision.graph?.edges?.length;
  if (nodeCount === undefined || edgeCount === undefined) return t('revision.scaleUnknown');
  return t('revision.scale', { nodes: nodeCount, edges: edgeCount });
}

function DiffSummary({ diff }) {
  const { t } = useI18n();
  if (!diff) return null;
  const categories = diff.summary || diff.categories || diff;
  const items = [
    [t('diff.structure'), categories.structural ?? categories.structure ?? 0],
    [t('diff.semantic'), categories.semantic ?? 0],
    [t('diff.layout'), categories.layout ?? 0],
    [t('diff.documents'), categories.document ?? categories.documentBindings ?? 0],
    [t('diff.relationships'), categories.relationship ?? categories.relations ?? 0],
  ];
  return (
    <div className="revision-diff" aria-label={t('revision.diffAria')}>
      <strong>{t('revision.compareFormal')}</strong>
      <div>{items.map(([label, value]) => <span key={label}>{label} {value}</span>)}</div>
    </div>
  );
}

export default function RevisionPanel({
  open,
  loading,
  revisions,
  headRevisionId,
  selectedRevisionId,
  activeDraft,
  diff,
  readOnly = false,
  onClose,
  onInspect,
  onRestore,
}) {
  const { t, formatDateTime } = useI18n();
  if (!open) return null;
  return (
    <div className="phase3-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="phase3-sheet revision-sheet" role="dialog" aria-modal="true" aria-labelledby="revision-title">
        <header className="sheet-heading">
          <div>
            <p className="kicker">{t('revision.kicker')}</p>
            <h2 id="revision-title">{t('revision.title')}</h2>
            <p>{t(readOnly ? 'revision.readOnlyDescription' : 'revision.description')}</p>
          </div>
          <button className="quiet sheet-close" type="button" onClick={onClose} aria-label={t('revision.close')}>{t('common.close')}</button>
        </header>

        {activeDraft && !readOnly && (
          <div className="sheet-notice warning">
            {t('revision.activeDraftWarning')}
          </div>
        )}

        <DiffSummary diff={diff} />

        <div className="revision-list" aria-busy={loading}>
          {loading && <p className="sheet-empty">{t('revision.loading')}</p>}
          {!loading && !revisions.length && <p className="sheet-empty">{t('revision.empty')}</p>}
          {revisions.map((revision) => {
            const isHead = revision.revisionId === headRevisionId;
            const selected = revision.revisionId === selectedRevisionId;
            return (
              <article className={`revision-card ${selected ? 'selected' : ''}`} key={revision.revisionId}>
                <div className="revision-card-heading">
                  <div>
                    <strong>{revisionNumber(revision, t)}</strong>
                    {isHead && <span className="head-badge">{t('revision.currentFormal')}</span>}
                  </div>
                  <span>{t(`revision.origin.${revision.origin || 'publish'}`, {}, revision.origin || t('revision.origin.publish'))}</span>
                </div>
                <p className="revision-message">{revision.message || t('revision.noMessage')}</p>
                <dl className="revision-meta">
                  <div><dt>{t('revision.time')}</dt><dd>{formatDateTime(revision.publishedAt)}</dd></div>
                  <div><dt>{t('revision.scaleLabel')}</dt><dd>{revisionScale(revision, t)}</dd></div>
                  <div><dt>{t('revision.parent')}</dt><dd>{revision.parentRevisionId || t('common.none')}</dd></div>
                  {revision.restoredFromRevisionId && (
                    <div><dt>{t('revision.restoreSource')}</dt><dd>{revision.restoredFromRevisionId}</dd></div>
                  )}
                </dl>
                <div className="revision-actions">
                  <button type="button" onClick={() => onInspect(revision)}>
                    {t(selected ? 'revision.inspecting' : 'revision.inspect')}
                  </button>
                  {!readOnly && !isHead && (
                    <button
                      className="primary"
                      type="button"
                      disabled={Boolean(activeDraft)}
                      onClick={() => onRestore(revision)}
                    >{t('revision.restore')}</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
