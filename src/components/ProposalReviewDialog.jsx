import { useEffect, useMemo, useState } from 'react';
import '../analysis.css';

const CHANGE_KIND = {
  add: '新增',
  update: '修改',
  remove: '移除',
  relationship: '关系',
  relation: '关系',
};

const CHANGE_STATUS = {
  pending: '待审',
  accepted: '已接受',
  approved: '已接受',
  rejected: '已拒绝',
  edited: '人工修订',
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

function evidencePath(evidence) {
  return evidence?.relativePath || evidence?.path || evidence?.sourcePath || evidence?.location || '来源路径未记录';
}

function evidenceLabel(evidence) {
  const lineStart = evidence?.lineStart ?? evidence?.startLine;
  const lineEnd = evidence?.lineEnd ?? evidence?.endLine;
  if (lineStart === undefined || lineStart === null) return evidencePath(evidence);
  return `${evidencePath(evidence)}:${lineStart}${lineEnd && lineEnd !== lineStart ? `–${lineEnd}` : ''}`;
}

function evidenceExcerpt(evidence) {
  return evidence?.excerpt || evidence?.content || evidence?.summary || '此证据未保存文本摘录。';
}

function changeTitle(change) {
  return change?.title || change?.name || change?.label || change?.targetId || '未命名变更';
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
  const tone = isAccepted(status) ? 'confirmed' : status === 'rejected' ? 'rejected' : status === 'edited' ? 'confirmed' : 'pending';
  return <span className={`analysis-badge analysis-badge--${tone}`}>{CHANGE_STATUS[status] || status || CHANGE_STATUS.pending}</span>;
}

function ChangeList({ changes, selectedChangeId, onSelect }) {
  return (
    <section className="analysis-review-column analysis-review-changes" aria-label="候选变更">
      <header className="analysis-review-column__heading">
        <div>
          <p className="kicker">AGENT CANDIDATES</p>
          <h3>候选变更</h3>
        </div>
        <span>{changes.length} 项</span>
      </header>
      {!changes.length && <p className="analysis-empty">这个提案暂时没有可审阅的变更。</p>}
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
              <span className={`analysis-change-kind analysis-change-kind--${change.kind || change.type || 'update'}`}>{CHANGE_KIND[change.kind || change.type] || '变更'}</span>
              <span className="analysis-change-row__content">
                <strong>{changeTitle(change)}</strong>
                {changeDescription(change) && <small>{changeDescription(change)}</small>}
                <span className="analysis-change-row__meta">
                  <ChangeStatusBadge status={status} />
                  {confidence && <em>置信度 {confidence}</em>}
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
  const before = change?.before ?? change?.previousValue;
  const after = change?.after ?? change?.nextValue;
  return (
    <aside className="analysis-review-column analysis-review-evidence" aria-label="变更证据">
      <header className="analysis-review-column__heading">
        <div>
          <p className="kicker">TRACEABLE EVIDENCE</p>
          <h3>依据与影响</h3>
        </div>
        <span>{evidence.length} 条</span>
      </header>

      {!change && <p className="analysis-empty">选择左侧的变更以查看其证据。</p>}

      {change && (
        <>
          <article className="analysis-change-detail">
            <div className="analysis-change-detail__heading">
              <span className={`analysis-change-kind analysis-change-kind--${change.kind || change.type || 'update'}`}>{CHANGE_KIND[change.kind || change.type] || '变更'}</span>
              <ChangeStatusBadge status={changeStatus(change)} />
            </div>
            <h4>{changeTitle(change)}</h4>
            {changeDescription(change) && <p>{changeDescription(change)}</p>}
            {(before !== undefined || after !== undefined) && (
              <div className="analysis-before-after">
                <div><span>变更前</span><p>{before === undefined || before === '' ? '—' : String(before)}</p></div>
                <div><span>建议值</span><p>{after === undefined || after === '' ? '—' : String(after)}</p></div>
              </div>
            )}
          </article>

          {!evidence.length && (
            <div className="analysis-evidence-warning">
              <strong>未找到可核验的证据</strong>
              <p>该建议不能直接接受；请补充资料或将其拒绝。</p>
            </div>
          )}

          <div className="analysis-evidence-list">
            {evidence.map((item, index) => (
              <article className="analysis-evidence-card" key={item.id || `${evidencePath(item)}-${index}`}>
                <div>
                  <span className="analysis-evidence-card__source">证据 {index + 1}</span>
                  <code>{evidenceLabel(item)}</code>
                </div>
                <pre>{evidenceExcerpt(item)}</pre>
                {onLocateEvidence && <button className="quiet" type="button" onClick={() => onLocateEvidence(item, change)}>定位原文</button>}
              </article>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * A controlled review dialog. It owns only the currently highlighted change;
 * acceptance, rejection, source navigation, and persistence remain with the parent.
 */
export default function ProposalReviewDialog({
  open,
  proposal,
  busy = false,
  allowEvidenceFreeAccept = false,
  onClose,
  onAcceptProposal,
  onRejectProposal,
  onLocateEvidence,
  onSelectChange,
}) {
  const changes = useMemo(() => asList(proposal?.changes || proposal?.items), [proposal]);
  const evidenceRegistry = useMemo(() => asList(proposal?.evidence || proposal?.evidenceRegistry), [proposal]);
  const [selectedChangeId, setSelectedChangeId] = useState(null);
  const [actionInFlight, setActionInFlight] = useState(null);

  useEffect(() => {
    setSelectedChangeId(changes.length ? getChangeId(changes[0], 0) : null);
    setActionInFlight(null);
  }, [proposal?.id, proposal?.proposalId, changes.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy && !actionInFlight) onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actionInFlight, busy, onClose, open]);

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

  const invokeAction = async (callback, action) => {
    if (!callback || !proposal || busy || actionInFlight) return;
    setActionInFlight(action);
    try {
      await callback(proposal);
    } finally {
      setActionInFlight(null);
    }
  };

  const status = selectedChange ? changeStatus(selectedChange) : 'pending';
  const proposalPending = proposal.status === 'pending';
  const evidenceComplete = changes.length > 0 && changes.every((change) => (
    allowEvidenceFreeAccept || changeEvidence(change, evidenceRegistry).length > 0
  ));
  const canAccept = proposalPending && evidenceComplete && !isAccepted(status) && status !== 'rejected';
  const canReject = proposalPending && Boolean(selectedChange) && !isAccepted(status) && status !== 'rejected';

  return (
    <div className="phase3-backdrop top-layer analysis-review-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy && !actionInFlight) onClose?.();
    }}>
      <section className="analysis-review-dialog" role="dialog" aria-modal="true" aria-labelledby="proposal-review-title">
        <header className="analysis-review-dialog__heading">
          <div>
            <p className="kicker">HUMAN REVIEW REQUIRED</p>
            <h2 id="proposal-review-title">{proposal.title || proposal.name || '架构变更提案'}</h2>
            <p>{proposal.summary || '逐项检查智能体提交的候选变更及其可追溯证据，再决定是否写入架构草案。'}</p>
          </div>
          <button className="quiet sheet-close" type="button" disabled={busy || Boolean(actionInFlight)} onClick={onClose} aria-label="关闭提案审阅">关闭</button>
        </header>

        <div className="analysis-review-summary">
          <span className="analysis-badge analysis-badge--ai">智能体提案</span>
          {proposal.origin?.agentName && <span>{proposal.origin.agentName}</span>}
          {proposal.origin?.agentClient && <span>{proposal.origin.agentClient}</span>}
          <span>{changes.length} 项候选变更</span>
          <span>{evidenceRegistry.length} 条已登记证据</span>
          {formatConfidence(proposal.confidence) && <span>整体置信度 {formatConfidence(proposal.confidence)}</span>}
        </div>

        <div className="analysis-review-grid">
          <ChangeList changes={changes} selectedChangeId={selectedChangeId} onSelect={chooseChange} />
          <EvidencePanel change={selectedChange} evidence={selectedEvidence} onLocateEvidence={onLocateEvidence} />
        </div>

        <footer className="analysis-review-dialog__footer">
          <div>
            {!evidenceComplete && !allowEvidenceFreeAccept && <small>提案中的每项变更都需要至少一条可定位证据。</small>}
          </div>
          <div className="dialog-actions">
            <button className="quiet" type="button" disabled={!canReject || busy || Boolean(actionInFlight)} onClick={() => invokeAction(onRejectProposal, 'reject')}>
              {actionInFlight === 'reject' ? '正在拒绝…' : '拒绝此提案'}
            </button>
            <button className="primary" type="button" disabled={!canAccept || busy || Boolean(actionInFlight)} onClick={() => invokeAction(onAcceptProposal, 'accept')}>
              {actionInFlight === 'accept' ? '正在写入草案…' : '接受提案并写入草案'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
