import { useMemo, useState } from 'react';
import '../analysis.css';
import { useI18n } from '../i18n.jsx';
import SkillCatalog from './SkillCatalog.jsx';

const TABS = ['runs', 'reviews', 'skills'];

const TONES = {
  active: 'neutral',
  submitted: 'draft',
  reviewed: 'confirmed',
  failed: 'rejected',
  pending: 'neutral',
  'draft-applied': 'draft',
  accepted: 'confirmed',
  approved: 'confirmed',
  partially_accepted: 'draft',
  rejected: 'rejected',
};

const ARCHITECTURE_GATE_TONES = {
  aligned: 'draft',
  'explained-drift': 'draft',
  'unresolved-drift': 'rejected',
};

const AGENT_CLAIM_TONES = { complete: 'ai', partial: 'neutral', blocked: 'rejected' };
const CONTRACT_GATE_TONES = { satisfied: 'confirmed', 'criteria-unmet': 'rejected', 'claim-incomplete': 'draft' };
const CRITERION_TONES = { satisfied: 'confirmed', unsatisfied: 'rejected', unverified: 'neutral' };
const HUMAN_REVIEW_TONES = { accepted: 'confirmed', 'revision-requested': 'draft', rejected: 'rejected' };
const DRIFT_TONES = { missing: 'rejected', extra: 'ai', changed: 'draft', unverified: 'neutral' };

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function formatConfidence(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`;
}

function Badge({ tone = 'neutral', children }) {
  return <span className={`analysis-badge analysis-badge--${tone}`}>{children}</span>;
}

function EmptyState({ children }) {
  return <p className="analysis-empty">{children}</p>;
}

function runStatus(run, t) {
  const status = run.status || 'active';
  return <Badge tone={TONES[status] || 'neutral'}>{t(`workbench.runStatus.${status}`, {}, status)}</Badge>;
}

function artifactSummary(artifact, t) {
  const summary = artifact?.summary || {};
  if (artifact?.artifactType === 'evidence-manifest') return t('workbench.artifact.evidenceSummary', { count: summary.evidenceCount || 0 });
  if (artifact?.artifactType === 'architecture-snapshot') return t('workbench.artifact.snapshotSummary', {
    nodes: summary.nodeCount || 0,
    edges: summary.edgeCount || 0,
  });
  if (artifact?.artifactType === 'architecture-proposal') return t('workbench.artifact.patchSummary', {
    graph: summary.changeCount || 0,
    criteria: summary.contractChangeCount || 0,
  });
  if (artifact?.artifactType === 'implementation-report') return t('workbench.artifact.implementationSummary', {
    status: t(`workbench.agentClaim.${summary.status || 'unknown'}`),
    passed: summary.passedCheckCount || 0,
    drift: summary.driftCount || 0,
  });
  return t('workbench.artifact.submitted');
}

function ReconciliationElement({ label, element }) {
  const { t } = useI18n();
  if (!element) {
    return <div className="analysis-reconciliation-element is-empty"><span>{label}</span><p>{t('common.none')}</p></div>;
  }
  const isEdge = element.targetType === 'edge';
  return (
    <div className="analysis-reconciliation-element">
      <span>{label}</span>
      <strong>{isEdge ? `${element.source} → ${element.target}` : element.name}</strong>
      <p>{isEdge
        ? `${element.label || ''} · ${element.relationType || ''} · ${t('workbench.boundary')} ${element.controlledBoundaryPosture || ''}`
        : element.purpose}</p>
      {!isEdge && <small>{t('workbench.permissionBoundary')}：{element.authorization || t('common.notRecorded')}</small>}
      {asList(element.evidenceIds).length > 0 && <code>{element.evidenceIds.join(' · ')}</code>}
    </div>
  );
}

function ArchitectureGatePanel({ run, busy, onReviewImplementation }) {
  const { t, formatDateTime } = useI18n();
  const [reviewNote, setReviewNote] = useState('');
  const gate = run.architectureGate;
  if (!gate) return null;
  const contractGate = run.contractGate;
  const humanReview = run.humanReview;
  const contractReady = Boolean(contractGate?.readyForAcceptance);
  const acceptanceReady = Boolean(gate.readyForHumanReview && contractReady);
  const noteReady = Boolean(reviewNote.trim());
  const drift = asList(gate.drift);
  const unsupported = asList(gate.crossCheck?.unsupported);
  const criteria = asList(contractGate?.criteria);
  const counts = gate.counts || {};
  const submit = (decision) => {
    if (!noteReady || busy || humanReview) return;
    onReviewImplementation?.(run, decision, reviewNote.trim());
  };
  return (
    <section className={`analysis-reconciliation analysis-reconciliation--${gate.status || 'pending'}`}>
      <div className="analysis-reconciliation__heading">
        <div><span className="analysis-reconciliation__kicker">ARCHITECTURE + CONTRACT GATES · HUMAN REVIEW</span><strong>{t('workbench.implementationReview')}</strong></div>
        <Badge tone={ARCHITECTURE_GATE_TONES[gate.status] || 'neutral'}>{t(`workbench.architectureGate.${gate.status || 'pending'}`)}</Badge>
      </div>
      <p>{t(`workbench.architectureGateHelp.${gate.status || 'pending'}`)}</p>

      <div className="analysis-implementation-state">
        <div>
          <span>{t('workbench.agentClaimLabel')}</span>
          <Badge tone={AGENT_CLAIM_TONES[run.agentClaim?.status] || 'neutral'}>{t(`workbench.agentClaim.${run.agentClaim?.status || 'unknown'}`)}</Badge>
          <small>{t('workbench.agentClaimHelp')}</small>
        </div>
        <div>
          <span>{t('workbench.architectureGateLabel')}</span>
          <Badge tone={ARCHITECTURE_GATE_TONES[gate.status] || 'neutral'}>{t(`workbench.architectureGate.${gate.status || 'pending'}`)}</Badge>
          <small>{t(gate.readyForHumanReview ? 'workbench.readyForHumanReview' : 'workbench.resolveArchitectureGate')}</small>
        </div>
        <div>
          <span>{t('workbench.contractGateLabel')}</span>
          <Badge tone={CONTRACT_GATE_TONES[contractGate?.status] || 'neutral'}>{t(`workbench.contractGate.${contractGate?.status || 'missing'}`)}</Badge>
          <small>{t(contractReady
            ? 'workbench.contractReady'
            : contractGate ? 'workbench.contractNotReady' : 'workbench.legacyRunNoContract')}</small>
        </div>
        <div>
          <span>{t('workbench.humanReviewLabel')}</span>
          {humanReview
            ? <Badge tone={HUMAN_REVIEW_TONES[humanReview.decision] || 'neutral'}>{t(`workbench.humanReview.${humanReview.decision}`)}</Badge>
            : <Badge>{t('workbench.awaitingUser')}</Badge>}
          <small>{humanReview
            ? `${humanReview.reviewer} · ${formatDateTime(humanReview.reviewedAt)}`
            : t('workbench.agentCannotReview')}</small>
        </div>
      </div>

      <div className="analysis-reconciliation-counts" aria-label={t('workbench.driftCounts')}>
        {['missing', 'extra', 'changed', 'unverified'].map((kind) => (
          <span key={kind}><b>{counts[kind] || 0}</b>{t(`workbench.drift.${kind}`)}</span>
        ))}
        <span><b>{counts.unexplained || 0}</b>{t('workbench.unexplained')}</span>
      </div>

      {contractGate && (
        <section className={`analysis-contract-gate is-${contractGate.status}`}>
          <div className="analysis-contract-gate__heading">
            <div><span>FORMAL DEVELOPMENT CONTRACT</span><strong>{t('workbench.criteriaResults')}</strong></div>
            <Badge tone={CONTRACT_GATE_TONES[contractGate.status] || 'neutral'}>{t(`workbench.contractGate.${contractGate.status}`)}</Badge>
          </div>
          <p>{t('workbench.criteriaIntegrity')}</p>
          <div className="analysis-contract-gate__counts">
            {['satisfied', 'unsatisfied', 'unverified'].map((status) => (
              <span key={status}><b>{contractGate.counts?.[status] || 0}</b>{t(`workbench.criterion.${status}`)}</span>
            ))}
          </div>
          {criteria.length ? (
            <ol className="analysis-contract-criteria">
              {criteria.map((criterion) => (
                <li key={criterion.criterionId}>
                  <div><Badge tone={CRITERION_TONES[criterion.status] || 'neutral'}>{t(`workbench.criterion.${criterion.status}`)}</Badge><code>{criterion.criterionId}</code></div>
                  <strong>{criterion.statement}</strong>
                  <small>{t('workbench.architectureRefs')}：{asList(criterion.targetRefs).length
                    ? criterion.targetRefs.map((ref) => `${ref.targetType}:${ref.targetId}`).join(' · ')
                    : t('common.none')}</small>
                  <small>{t('workbench.implementationEvidence')}：{asList(criterion.evidenceIds).length ? criterion.evidenceIds.join(' · ') : t('common.none')}</small>
                </li>
              ))}
            </ol>
          ) : <small>{t('workbench.compactContract')}</small>}
        </section>
      )}

      {Array.isArray(gate.drift) ? (
        drift.length ? <div className="analysis-drift-list">
          {drift.map((item) => (
            <article className="analysis-drift-item" key={item.id}>
              <div className="analysis-drift-item__heading">
                <div><Badge tone={DRIFT_TONES[item.kind] || 'neutral'}>{t(`workbench.drift.${item.kind}`)}</Badge><strong>{t(item.targetType === 'edge' ? 'workbench.relationship' : 'workbench.module')} · {item.targetId}</strong></div>
                <code>{item.id}</code>
              </div>
              <p>{item.summary}</p>
              {asList(item.changedFields).length > 0 && <div className="analysis-drift-fields">{item.changedFields.map((field) => <span key={field}>{field}</span>)}</div>}
              <div className="analysis-reconciliation-elements">
                <ReconciliationElement label={t('workbench.formalTarget')} element={item.target} />
                <ReconciliationElement label={t('workbench.implementationSnapshot')} element={item.actual} />
              </div>
              <div className={`analysis-drift-explanation is-${item.explanation?.status || 'unexplained'}`}>
                <strong>{t(item.explanation?.status === 'agent-provided' ? 'workbench.agentExplanationPending' : 'workbench.noAgentExplanation')}</strong>
                <p>{item.explanation?.summary || t('workbench.reportDoesNotCover')}</p>
                {asList(item.explanation?.evidenceIds).length > 0 && <code>{item.explanation.evidenceIds.join(' · ')}</code>}
              </div>
            </article>
          ))}
        </div> : <p className="analysis-reconciliation__aligned-note">{t('workbench.noArchitectureDrift')}</p>
      ) : <small className="analysis-reconciliation__compact-note">{t('workbench.compactGate')}</small>}

      {unsupported.length > 0 && (
        <div className="analysis-reconciliation-unsupported">
          <strong>{t('workbench.unsupportedClaims', { count: unsupported.length })}</strong>
          {unsupported.map((item) => <p key={item.id}>{item.kind} · {item.targetId}：{item.summary}</p>)}
        </div>
      )}

      {humanReview ? (
        <div className={`analysis-human-review is-${humanReview.decision}`}>
          <div><strong>{t(`workbench.humanReview.${humanReview.decision}`)}</strong><span>{humanReview.reviewer} · {formatDateTime(humanReview.reviewedAt)}</span></div>
          <p>{humanReview.note}</p>
          {humanReview.decision === 'accepted' && gate.status === 'explained-drift' && <small>{t('workbench.acceptedDriftDoesNotChangeTarget')}</small>}
        </div>
      ) : (
        <div className="analysis-human-review-controls">
          <label>
            <span>{t('workbench.reviewNote')}</span>
            <textarea rows="3" value={reviewNote} disabled={busy} placeholder={t('workbench.reviewNotePlaceholder')} onChange={(event) => setReviewNote(event.target.value)} />
          </label>
          <div>
            <button className="primary" type="button" disabled={busy || !noteReady || !acceptanceReady} onClick={() => submit('accepted')}>{t('workbench.acceptImplementation')}</button>
            <button className="quiet" type="button" disabled={busy || !noteReady} onClick={() => submit('revision-requested')}>{t('workbench.requestRevision')}</button>
            <button className="danger" type="button" disabled={busy || !noteReady} onClick={() => submit('rejected')}>{t('workbench.rejectImplementation')}</button>
          </div>
          <small>{t('workbench.reviewDoesNotChangeTarget')}</small>
        </div>
      )}
    </section>
  );
}

function DraftWriteList({ writes }) {
  const { t, formatDateTime } = useI18n();
  if (!writes.length) return null;
  return (
    <div className="analysis-artifact-list" aria-label={t('workbench.draftWrites')}>
      {writes.map((write) => (
        <div className="analysis-artifact-item" key={write.id}>
          <strong>{t(write.application?.outcome === 'reverted-to-published'
            ? 'workbench.draftRevertedToPublished'
            : 'workbench.draftWrite')}</strong>
          <span>{write.summary || write.title || write.id}</span>
          <small>
            {t('workbench.draftRevision', { revision: write.application?.draftRevision || '?' })} · {formatDateTime(write.application?.appliedAt || write.createdAt)}
          </small>
          <small>{t(write.application?.outcome === 'reverted-to-published'
            ? 'workbench.draftRevertedHelp'
            : 'workbench.writeCounts', {
            graph: asList(write.changes).length,
            criteria: asList(write.contractPatch?.upsert).length + asList(write.contractPatch?.delete).length,
          })}</small>
        </div>
      ))}
    </div>
  );
}

function LegacyProposalHistory({ proposals, onOpenProposal }) {
  const { t, formatDateTime } = useI18n();
  const records = proposals.filter((proposal) => proposal.status !== 'draft-applied');
  if (!records.length) return null;
  return (
    <section className="analysis-legacy-history">
      <div className="analysis-section-heading">
        <div><h3>{t('workbench.legacyHistory')}</h3><p>{t('workbench.legacyHistoryHelp')}</p></div>
      </div>
      <div className="analysis-card-list">
        {records.map((proposal) => {
          const invalidPending = proposal.status === 'pending' && !proposal.laneLock;
          const retiredPending = proposal.status === 'pending' && proposal.laneLock;
          return (
            <article className="analysis-proposal-card" key={proposal.id}>
              <div className="analysis-card-heading">
                <div><strong>{proposal.title || t('proposal.defaultTitle')}</strong><small>{formatDateTime(proposal.createdAt)}</small></div>
                <Badge tone={TONES[proposal.status] || 'neutral'}>{t(`workbench.proposalStatus.${proposal.status || 'pending'}`)}</Badge>
              </div>
              {proposal.summary && <p>{proposal.summary}</p>}
              <div className="analysis-meta-row">
                <span>{t('workbench.graphChanges', { count: asList(proposal.changes).length })}</span>
                <span>{t('workbench.evidenceItems', { count: asList(proposal.evidenceIds).length })}</span>
                {invalidPending && <span>{t('workbench.legacyNeedsRebuild')}</span>}
                {retiredPending && <span>{t('workbench.retiredPending')}</span>}
              </div>
              <footer className="analysis-card-actions"><button className="quiet" type="button" onClick={() => onOpenProposal?.(proposal)}>{t('workbench.viewReadOnlyRecord')}</button></footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RunList({ runs, proposals, integration, busy, onRefresh, onCopyConnection, onOpenProposal, onReviewImplementation }) {
  const { t, formatDateTime } = useI18n();
  return (
    <>
      <div className="analysis-section-heading">
        <div><h3>{t('workbench.runsTitle')}</h3><p>{t('workbench.runsHelp')}</p></div>
        <button className="quiet" type="button" disabled={busy} onClick={onRefresh}>{t(busy ? 'common.refreshing' : 'common.refresh')}</button>
      </div>
      <div className="analysis-integration-card">
        <div>
          <Badge tone="ai">MCP · LOCAL</Badge>
          <strong>{t('workbench.noEmbeddedModel')}</strong>
          <p>{t('workbench.directDraftBoundary')}</p>
        </div>
        <div className="analysis-integration-commands">
          <code>{integration?.mcpCommand || 'npm run mcp'}</code>
          <code>{integration?.cliCommand || 'npm run agent --'}</code>
          <button className="primary" type="button" onClick={onCopyConnection}>{t('workbench.copyConnection')}</button>
        </div>
      </div>
      {!runs.length && <EmptyState>{t('workbench.noRuns')}</EmptyState>}
      <div className="analysis-card-list">
        {runs.map((run, index) => {
          const artifacts = asList(run.artifacts);
          const writes = proposals.filter((proposal) => proposal.status === 'draft-applied' && proposal.origin?.runId === run.id);
          return (
            <article className="analysis-run-card" key={run.id || `agent-run-${index}`}>
              <div className="analysis-card-heading">
                <div><strong>{run.agentName || t('workbench.unnamedAgent')}</strong><code>{run.id}</code></div>
                {runStatus(run, t)}
              </div>
              {run.summary && <p>{run.summary}</p>}
              {run.approvedTarget && (
                <div className="analysis-target-lock"><div><span>{t('workbench.formalTargetLock')}</span><strong>{run.approvedTarget.diagramId} · {run.approvedTarget.revisionId}</strong></div><code title={run.approvedTarget.semanticHash}>{run.approvedTarget.semanticHash?.slice(0, 12)}…</code></div>
              )}
              {run.laneLock?.draftId && (
                <div className="analysis-target-lock"><div><span>{t('workbench.draftLock')}</span><strong>{t(run.view === 'target' ? 'views.target.label' : 'views.current.label')} · {run.laneLock.draftId}</strong></div><code>draft r{run.laneLock.draftRevision}</code></div>
              )}
              <div className="analysis-meta-row">
                <span>{t(`workbench.task.${run.taskType}`, {}, run.taskType)}</span>
                <span>{run.agentClient || t('common.unknown')}</span>
                <span>{t(run.view === 'target' ? 'views.target.label' : 'views.current.label')} · r{run.baseRevision}</span>
                <span>{t('workbench.artifactCount', { count: artifacts.length })}</span>
                <span>{t('workbench.draftWriteCount', { count: writes.length })}</span>
              </div>
              {artifacts.length > 0 && (
                <div className="analysis-artifact-list" aria-label={t('workbench.artifacts')}>
                  {artifacts.map((artifact) => <div className="analysis-artifact-item" key={artifact.id}><strong>{t(`workbench.artifact.${artifact.artifactType}`, {}, artifact.artifactType)}</strong><span>{artifactSummary(artifact, t)}</span></div>)}
                </div>
              )}
              <DraftWriteList writes={writes} />
              <ArchitectureGatePanel run={run} busy={busy} onReviewImplementation={onReviewImplementation} />
              <small className="analysis-run-time">{t('workbench.updatedAt', { time: formatDateTime(run.updatedAt || run.createdAt) })}</small>
            </article>
          );
        })}
      </div>
      <LegacyProposalHistory proposals={proposals} onOpenProposal={onOpenProposal} />
    </>
  );
}

function ReviewCard({ review, onOpenProposal, onOpenRevisionHistory }) {
  const { t, formatDateTime } = useI18n();
  const implementation = review.kind === 'implementation';
  const publication = review.kind === 'publication';
  const decision = implementation || publication ? review.decision : review.status;
  const badgeKey = implementation
    ? `workbench.humanReview.${decision}`
    : publication ? `workbench.publication.${decision}` : `workbench.proposalStatus.${decision}`;
  const title = publication
    ? t(review.decision === 'restore' ? 'workbench.restoredRevision' : 'workbench.publishedRevision', { revision: review.revision })
    : implementation ? t('shell.implementationReviewTitle', { name: review.agentName }) : review.title;
  return (
    <article className={`analysis-review-card ${review.kind === 'legacy-proposal' ? 'is-legacy' : ''}`}>
      <div className="analysis-card-heading">
        <div><strong>{title || t('workbench.legacyProposalDecision')}</strong><small>{formatDateTime(review.reviewedAt)}</small></div>
        <Badge tone={implementation ? (HUMAN_REVIEW_TONES[decision] || 'neutral') : publication ? 'confirmed' : (TONES[decision] || 'neutral')}>
          {t(badgeKey)}
        </Badge>
      </div>
      {review.summary && <p>{review.summary}</p>}
      <div className="analysis-meta-row">
        <span>{t(implementation ? 'workbench.implementationReview' : publication ? 'workbench.formalPublicationReview' : 'workbench.legacyProposalHistory')}</span>
        {review.reviewer && <span>{review.reviewer}</span>}
        {review.revisionId && <code>{review.revisionId}</code>}
      </div>
      {publication && <footer className="analysis-card-actions"><button className="quiet" type="button" onClick={onOpenRevisionHistory}>{t('workbench.openRevisionHistory')}</button></footer>}
      {review.proposal && <footer className="analysis-card-actions"><button className="quiet" type="button" onClick={() => onOpenProposal?.(review.proposal)}>{t('workbench.viewReadOnlyRecord')}</button></footer>}
    </article>
  );
}

function ReviewList({ reviews, onOpenProposal, onOpenRevisionHistory }) {
  const { t } = useI18n();
  const currentReviews = reviews.filter((review) => review.kind !== 'legacy-proposal');
  const legacyReviews = reviews.filter((review) => review.kind === 'legacy-proposal');
  return (
    <>
      <div className="analysis-section-heading"><div><h3>{t('workbench.reviewsTitle')}</h3><p>{t('workbench.reviewsHelp')}</p></div></div>
      {!reviews.length && <EmptyState>{t('workbench.noReviews')}</EmptyState>}
      <div className="analysis-card-list">
        {currentReviews.map((review, index) => <ReviewCard key={review.id || `review-${index}`} review={review} onOpenRevisionHistory={onOpenRevisionHistory} />)}
      </div>
      {legacyReviews.length > 0 && (
        <section className="analysis-legacy-history">
          <div className="analysis-section-heading"><div><h3>{t('workbench.legacyReviewTitle')}</h3><p>{t('workbench.legacyReviewHelp')}</p></div></div>
          <div className="analysis-card-list">
            {legacyReviews.map((review, index) => <ReviewCard key={review.id || `legacy-review-${index}`} review={review} onOpenProposal={onOpenProposal} />)}
          </div>
        </section>
      )}
    </>
  );
}

export default function AnalysisWorkbench({
  open,
  runs = [],
  proposals = [],
  reviews = [],
  skills = [],
  activeTab,
  defaultTab = 'runs',
  busy = false,
  integration = null,
  onClose,
  onTabChange,
  onRefresh,
  onCopyConnection,
  onOpenProposal,
  onReviewImplementation,
  onCopySkillPrompt,
  onOpenRevisionHistory,
}) {
  const { t } = useI18n();
  const [internalTab, setInternalTab] = useState(defaultTab);
  const requestedTab = activeTab || internalTab;
  const selectedTab = TABS.includes(requestedTab) ? requestedTab : 'runs';
  const agentRuns = useMemo(() => asList(runs), [runs]);
  const history = useMemo(() => asList(proposals), [proposals]);
  const reviewRecords = useMemo(() => asList(reviews), [reviews]);
  const collaborationSkills = useMemo(() => asList(skills), [skills]);
  if (!open) return null;
  const changeTab = (tabId) => {
    if (!activeTab) setInternalTab(tabId);
    onTabChange?.(tabId);
  };
  return (
    <div className="phase3-backdrop analysis-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <aside className="phase3-sheet analysis-workbench" role="dialog" aria-modal="true" aria-labelledby="analysis-workbench-title">
        <header className="sheet-heading analysis-workbench__heading">
          <div><p className="kicker">AGENT ARCHITECTURE HANDOFF</p><h2 id="analysis-workbench-title">{t('workbench.title')}</h2><p>{t('workbench.description')}</p></div>
          <button className="quiet sheet-close" type="button" onClick={onClose} aria-label={t('workbench.close')}>{t('common.close')}</button>
        </header>
        <div className="analysis-tabs" role="tablist" aria-label={t('workbench.tabs')}>
          {TABS.map((tab) => <button key={tab} id={`analysis-tab-${tab}`} className={selectedTab === tab ? 'active' : ''} type="button" role="tab" aria-selected={selectedTab === tab} aria-controls={`analysis-panel-${tab}`} onClick={() => changeTab(tab)}>{t(`workbench.tab.${tab}`)}</button>)}
        </div>
        <section id={`analysis-panel-${selectedTab}`} role="tabpanel" aria-labelledby={`analysis-tab-${selectedTab}`} className="analysis-tab-panel">
          {selectedTab === 'runs' && <RunList runs={agentRuns} proposals={history} integration={integration} busy={busy} onRefresh={onRefresh} onCopyConnection={onCopyConnection} onOpenProposal={onOpenProposal} onReviewImplementation={onReviewImplementation} />}
          {selectedTab === 'reviews' && <ReviewList reviews={reviewRecords} onOpenProposal={onOpenProposal} onOpenRevisionHistory={onOpenRevisionHistory} />}
          {selectedTab === 'skills' && <SkillCatalog skills={collaborationSkills} onCopyPrompt={onCopySkillPrompt} />}
        </section>
      </aside>
    </div>
  );
}
