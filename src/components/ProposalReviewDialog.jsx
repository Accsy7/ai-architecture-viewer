import { useEffect, useMemo, useState } from 'react';
import '../analysis.css';
import { useI18n } from '../i18n.jsx';

const EVIDENCE_TONES = {
  'user-confirmed': 'user-confirmed',
  'design-document': 'design-document',
  'code-fact': 'code-fact',
  'agent-inference': 'agent-inference',
  fact: 'neutral',
  inference: 'agent-inference',
};

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function getChangeId(change, index) {
  return change?.id || change?.changeId || `change-${index}`;
}

function formatConfidence(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`;
}

function evidencePath(evidence, t) {
  if (evidence?.sourceKind === 'discussion') return evidence?.sourceLabel || t('proposal.discussionUnknown');
  if (evidence?.sourceKind === 'project-document') {
    return `document:${evidence.documentId || t('proposal.unregistered')}${evidence.section ? `#${evidence.section}` : ''}`;
  }
  return evidence?.relativePath || evidence?.path || evidence?.sourcePath || evidence?.location || evidence?.sourceLabel || t('proposal.sourceUnknown');
}

function evidenceLabel(evidence, t) {
  const lineStart = evidence?.lineStart ?? evidence?.startLine;
  const lineEnd = evidence?.lineEnd ?? evidence?.endLine;
  if (lineStart === undefined || lineStart === null) return evidencePath(evidence, t);
  return `${evidencePath(evidence, t)}:${lineStart}${lineEnd && lineEnd !== lineStart ? `–${lineEnd}` : ''}`;
}

function evidenceExcerpt(evidence, t) {
  return evidence?.excerpt || evidence?.content || evidence?.summary || t('proposal.noExcerpt');
}

function evidenceBasis(evidence, t) {
  return {
    label: t(`proposal.basis.${evidence?.basis}`, {}, evidence?.basis || t('proposal.basisUnknown')),
    tone: EVIDENCE_TONES[evidence?.basis] || 'neutral',
  };
}

function changeTitle(change, t) {
  return change?.title || change?.name || change?.label || change?.targetId || t('proposal.unnamedChange');
}

function changeDescription(change) {
  return change?.description || change?.rationale || change?.summary || '';
}

function changeStatus(change) {
  return change?.reviewStatus || change?.status || 'pending';
}

function isAccepted(status) {
  return ['accepted', 'approved', 'edited'].includes(status);
}

function changeEvidence(change, evidence) {
  const direct = asList(change?.evidence).filter(Boolean);
  if (direct.length) return direct;

  const refs = asList(change?.evidenceRefs || change?.evidenceIds).filter(Boolean);
  if (!refs.length) return evidence;
  const ids = new Set(refs.map((entry) => typeof entry === 'object' ? (entry.id || entry.evidenceId) : entry));
  return evidence.filter((entry) => ids.has(entry?.id) || ids.has(entry?.evidenceId));
}

function ChangeStatusBadge({ status }) {
  const { t } = useI18n();
  const tone = isAccepted(status) ? 'confirmed' : status === 'rejected' ? 'rejected' : status === 'edited' ? 'confirmed' : 'pending';
  return <span className={`analysis-badge analysis-badge--${tone}`}>{t(`proposal.status.${status || 'pending'}`, {}, status || t('proposal.status.pending'))}</span>;
}

function ChangeList({ changes, selectedChangeId, onSelect }) {
  const { t } = useI18n();
  return (
    <section className="analysis-review-column analysis-review-changes" aria-label={t('proposal.candidateChanges')}>
      <header className="analysis-review-column__heading">
        <div>
          <p className="kicker">AGENT CANDIDATES</p>
          <h3>{t('proposal.candidateChanges')}</h3>
        </div>
        <span>{t('common.items', { count: changes.length })}</span>
      </header>
      {!changes.length && <p className="analysis-empty">{t('proposal.noChanges')}</p>}
      <div className="analysis-change-list">
        {changes.map((change, index) => {
          const id = getChangeId(change, index);
          const status = changeStatus(change);
          const confidence = formatConfidence(change.confidence);
          return (
            <button
              key={id}
              className={`analysis-change-row ${selectedChangeId === id ? 'is-selected' : ''}`}
              type="button"
              onClick={() => onSelect(id)}
              aria-pressed={selectedChangeId === id}
            >
              <span className={`analysis-change-kind analysis-change-kind--${change.kind || change.type || 'update'}`}>{t(`proposal.kind.${change.kind || change.type}`, {}, t('proposal.change'))}</span>
              <span className="analysis-change-row__content">
                <strong>{changeTitle(change, t)}</strong>
                {changeDescription(change) && <small>{changeDescription(change)}</small>}
                <span className="analysis-change-row__meta">
                  <ChangeStatusBadge status={status} />
                  {confidence && <em>{t('proposal.confidence', { value: confidence })}</em>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function EvidencePanel({ change, evidence, onLocateEvidence }) {
  const { t } = useI18n();
  const before = change?.before ?? change?.previousValue;
  const after = change?.after ?? change?.nextValue;
  return (
    <aside className="analysis-review-column analysis-review-evidence" aria-label={t('proposal.architectureBasis')}>
      <header className="analysis-review-column__heading">
        <div>
          <p className="kicker">TRACEABLE BASIS</p>
          <h3>{t('proposal.basisAndImpact')}</h3>
        </div>
        <span>{t('proposal.evidenceCount', { count: evidence.length })}</span>
      </header>

      {!change && <p className="analysis-empty">{t('proposal.selectChange')}</p>}

      {change && (
        <>
          <article className="analysis-change-detail">
            <div className="analysis-change-detail__heading">
              <span className={`analysis-change-kind analysis-change-kind--${change.kind || change.type || 'update'}`}>{t(`proposal.kind.${change.kind || change.type}`, {}, t('proposal.change'))}</span>
              <ChangeStatusBadge status={changeStatus(change)} />
            </div>
            <h4>{changeTitle(change, t)}</h4>
            {changeDescription(change) && <p>{changeDescription(change)}</p>}
            {(before !== undefined || after !== undefined) && (
              <div className="analysis-before-after">
                <div><span>{t('proposal.before')}</span><p>{before === undefined || before === '' ? '—' : String(before)}</p></div>
                <div><span>{t('proposal.suggested')}</span><p>{after === undefined || after === '' ? '—' : String(after)}</p></div>
              </div>
            )}
          </article>

          {!evidence.length && (
            <div className="analysis-evidence-warning">
              <strong>{t('proposal.noReviewableEvidence')}</strong>
              <p>{t('proposal.noEvidenceHelp')}</p>
            </div>
          )}

          <div className="analysis-evidence-list">
            {evidence.map((item, index) => {
              const basis = evidenceBasis(item, t);
              const isDiscussion = item.sourceKind === 'discussion';
              const isProjectDocument = item.sourceKind === 'project-document';
              return (
              <article className="analysis-evidence-card" key={item.id || `${evidencePath(item, t)}-${index}`}>
                <div className="analysis-evidence-card__meta">
                  <span className="analysis-evidence-card__source">{t('proposal.evidenceIndex', { index: index + 1 })}</span>
                  <span className={`analysis-badge analysis-badge--${basis.tone}`}>{basis.label}</span>
                </div>
                <div>
                  <code>{evidenceLabel(item, t)}</code>
                </div>
                <pre>{evidenceExcerpt(item, t)}</pre>
                {onLocateEvidence && <button className="quiet" type="button" onClick={() => onLocateEvidence(item, change)}>
                  {t(isDiscussion ? 'proposal.viewDiscussion' : isProjectDocument ? 'proposal.viewDocumentExcerpt' : 'proposal.locateSource')}
                </button>}
              </article>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}

/** Read-only compatibility viewer for proposal records created before direct-draft writes. */
export default function ProposalReviewDialog({
  open,
  proposal,
  busy = false,
  onClose,
  onLocateEvidence,
  onSelectChange,
}) {
  const { t } = useI18n();
  const changes = useMemo(() => asList(proposal?.changes || proposal?.items), [proposal]);
  const evidenceRegistry = useMemo(() => asList(proposal?.evidence || proposal?.evidenceRegistry), [proposal]);
  const acceptanceCriteria = useMemo(() => asList(
    proposal?.acceptanceCriteria?.length ? proposal.acceptanceCriteria : proposal?.contractPatch?.upsert,
  ), [proposal]);
  const [selectedChangeId, setSelectedChangeId] = useState(null);

  useEffect(() => {
    setSelectedChangeId(changes.length ? getChangeId(changes[0], 0) : null);
  }, [proposal?.id, proposal?.proposalId, changes.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose, open]);

  const selectedChange = changes.find((change, index) => getChangeId(change, index) === selectedChangeId) || changes[0] || null;
  const selectedEvidence = useMemo(
    () => changeEvidence(selectedChange, evidenceRegistry),
    [selectedChange, evidenceRegistry],
  );

  if (!open || !proposal) return null;

  const chooseChange = (id) => {
    setSelectedChangeId(id);
    const selected = changes.find((change, index) => getChangeId(change, index) === id);
    onSelectChange?.(selected || null);
  };

  const hasLaneLock = proposal.laneLock !== undefined;

  return (
    <div className="phase3-backdrop top-layer analysis-review-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose?.();
    }}>
      <section className="analysis-review-dialog" role="dialog" aria-modal="true" aria-labelledby="proposal-review-title">
        <header className="analysis-review-dialog__heading">
          <div>
            <p className="kicker">{t('proposal.historyKicker')}</p>
            <h2 id="proposal-review-title">{proposal.title || proposal.name || t('proposal.defaultTitle')}</h2>
            <p>{proposal.summary || t('proposal.defaultSummary')}</p>
          </div>
          <button className="quiet sheet-close" type="button" disabled={busy} onClick={onClose} aria-label={t('proposal.closeReview')}>{t('common.close')}</button>
        </header>

        <div className="analysis-review-summary">
          <span className="analysis-badge analysis-badge--ai">{t('proposal.agentProposal')}</span>
          <span className={`analysis-badge analysis-badge--${proposal.view === 'target' ? 'draft' : 'neutral'}`}>
            {t(proposal.view === 'target' ? 'proposal.targetDesign' : 'proposal.currentImplementation')}
          </span>
          {proposal.origin?.agentName && <span>{proposal.origin.agentName}</span>}
          {proposal.origin?.agentClient && <span>{proposal.origin.agentClient}</span>}
          <span>{t('proposal.candidateCount', { count: changes.length })}</span>
          <span>{t('proposal.registeredEvidence', { count: evidenceRegistry.length })}</span>
          {formatConfidence(proposal.confidence) && <span>{t('proposal.overallConfidence', { value: formatConfidence(proposal.confidence) })}</span>}
        </div>

        {proposal.view === 'target' && (
          <section className={`analysis-contract-summary ${acceptanceCriteria.length ? '' : 'is-unbound'}`}>
            <div>
              <p className="kicker">DEVELOPMENT CONTRACT</p>
              <h3>{t(acceptanceCriteria.length ? 'proposal.criteriaTitle' : 'proposal.noCriteriaTitle')}</h3>
            </div>
            {acceptanceCriteria.length ? (
              <ol>
                {acceptanceCriteria.map((criterion) => (
                  <li key={criterion.id}>
                    <strong>{criterion.statement}</strong>
                    <code>{t('proposal.criterionRefs', { id: criterion.id, count: criterion.targetRefs?.length || 0 })}</code>
                  </li>
                ))}
              </ol>
            ) : <p>{t('proposal.noCriteriaHelp')}</p>}
          </section>
        )}

        <div className="analysis-review-grid">
          <ChangeList changes={changes} selectedChangeId={selectedChangeId} onSelect={chooseChange} />
          <EvidencePanel change={selectedChange} evidence={selectedEvidence} onLocateEvidence={onLocateEvidence} />
        </div>

        <footer className="analysis-review-dialog__footer">
          <div>
            {!hasLaneLock && <small>{t('proposal.legacyNeedsRebuild')}</small>}
            <small>{t('proposal.historyReadOnly')}</small>
          </div>
          <button className="quiet" type="button" onClick={onClose}>{t('common.close')}</button>
        </footer>
      </section>
    </div>
  );
}
