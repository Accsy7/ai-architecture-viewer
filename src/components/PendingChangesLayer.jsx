import { useI18n } from '../i18n.jsx';
import { draftChangeFields } from '../pending-changes.mjs';
import '../pending-changes.css';

const CHANGE_GROUPS = [
  {
    id: 'modules',
    titleKey: 'pending.group.modules',
    categories: ['module-added', 'module-changed', 'module-removed'],
  },
  {
    id: 'relationships',
    titleKey: 'pending.group.relationships',
    categories: ['relationship-changed'],
  },
  {
    id: 'criteria',
    titleKey: 'pending.group.criteria',
    categories: ['criterion-added', 'criterion-changed', 'criterion-removed'],
  },
];

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

function CategorySummary({ items }) {
  const { t } = useI18n();
  const categories = [...new Set(items.map((item) => item.category))];
  return (
    <small>{categories.map((category) => t(`pending.count.${category}`, {
      count: items.filter((item) => item.category === category).length,
    })).join(' · ')}</small>
  );
}

function ChangeItem({ item, onLocateEvidence }) {
  const { t } = useI18n();
  const sourceLabel = item.agentAttributed
    ? t('pending.traceableAgent')
    : item.partiallyAgentAttributed ? t('pending.mixedSource') : t('pending.sourceUnknown');
  return (
    <details className="pending-change-item">
      <summary>
        <span className={`pending-kind is-${item.category}`}>{t(`pending.category.${item.displayCategory || item.category}`)}</span>
        <span className="pending-change-item__title">
          <strong>{item.label}</strong>
          <small>{sourceLabel}</small>
        </span>
      </summary>
      <div className="pending-change-detail">
        <code>{item.targetType}:{item.targetId}</code>
        {item.targetType === 'criterion' && (
          <div className="pending-contract-comparison">
            <div>
              <span>{t('pending.before')}</span>
              <p>{item.before?.statement || t('common.none')}</p>
              {item.before?.targetRefs?.length > 0 && <code>{item.before.targetRefs.map((ref) => `${ref.targetType}:${ref.targetId}`).join(' · ')}</code>}
            </div>
            <div>
              <span>{t('pending.after')}</span>
              <p>{item.after?.statement || t('common.none')}</p>
              {item.after?.targetRefs?.length > 0 && <code>{item.after.targetRefs.map((ref) => `${ref.targetType}:${ref.targetId}`).join(' · ')}</code>}
            </div>
          </div>
        )}
        <div className="pending-field-list">
          <span>{t('pending.fields')}</span>
          {draftChangeFields(item).length
            ? draftChangeFields(item).map((field) => <b key={field}>{t(`fields.${field}`, {}, field)}</b>)
            : <b>{t(`proposal.kind.${item.kind}`, {}, item.kind)}</b>}
        </div>
        <SourceSummary item={item} onLocateEvidence={onLocateEvidence} />
      </div>
    </details>
  );
}

export default function PendingChangesSummary({
  open,
  projection,
  view,
  onToggle,
  onPublish,
}) {
  const { t } = useI18n();
  if (!projection?.items?.length) return null;
  return (
    <div className="pending-change-notice" role="status">
      <strong className="pending-change-notice__summary">
        {t(view === 'target' ? 'pending.compactTarget' : 'pending.compactCurrent', { count: projection.totalCount })}
      </strong>
      <div className="pending-change-notice__actions">
        <button type="button" className="quiet" onClick={onToggle}>
          {open ? t('pending.hide') : t('pending.open')}
        </button>
        {onPublish && <button type="button" className="primary" onClick={onPublish}>{t('shell.reviewAndPublish')}</button>}
      </div>
    </div>
  );
}

export function PendingChangesInspector({ projection, onClose, onLocateEvidence }) {
  const { t } = useI18n();
  const items = projection?.items || [];
  const groups = CHANGE_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => group.categories.includes(item.category)),
  })).filter((group) => group.items.length);

  return (
    <aside className="inspector pending-changes-inspector" aria-label={t('pending.title')}>
      <header className="pending-changes-inspector__heading">
        <div>
          <p className="kicker">DRAFT VS PUBLISHED</p>
          <h2>{t('pending.title')}</h2>
        </div>
        <button type="button" className="quiet" onClick={onClose}>{t('common.close')}</button>
      </header>
      <p className="pending-changes-inspector__description">{t('pending.readOnlyDescription')}</p>
      <div className="pending-change-inspector-summary">
        <strong>{t('pending.noticeSplit', {
          graph: projection?.graphChangeCount || 0,
          criteria: projection?.criterionChangeCount || 0,
        })}</strong>
        <small>{projection?.agentAttributedCount === projection?.totalCount
          ? t('pending.noticeAllAgent', { count: projection.totalCount })
          : t('pending.noticeMixed', {
            total: projection?.totalCount || 0,
            agent: projection?.agentAttributedCount || 0,
            mixed: projection?.partiallyAgentAttributedCount || 0,
          })}</small>
        <small>{t('pending.safeBoundary')}</small>
      </div>
      <div className="pending-change-groups">
        {groups.map((group) => (
          <details className="pending-change-group" key={group.id}>
            <summary>
              <span>
                <strong>{t(group.titleKey)}</strong>
                <CategorySummary items={group.items} />
              </span>
              <b>{group.items.length}</b>
            </summary>
            <div className="pending-change-group__items">
              {group.items.map((item) => <ChangeItem key={item.id} item={item} onLocateEvidence={onLocateEvidence} />)}
            </div>
          </details>
        ))}
      </div>
      <footer className="pending-publication-boundary">
        <strong>{t('pending.publicationGate')}</strong>
        <small>{t('pending.publicationHelp')}</small>
      </footer>
    </aside>
  );
}
