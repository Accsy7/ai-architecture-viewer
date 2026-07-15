import { useMemo, useState } from 'react';
import '../analysis.css';
import SkillCatalog from './SkillCatalog.jsx';

const TABS = [
  { id: 'runs', label: '运行记录' },
  { id: 'proposals', label: '提案收件箱' },
  { id: 'reviews', label: '审阅记录' },
  { id: 'skills', label: '协作 Skill' },
];

const RUN_STATUS = {
  active: '等待提交',
  submitted: '已提交',
  reviewed: '已审阅',
  failed: '运行失败',
};

const TASK_TYPE = {
  'architecture-discovery': '项目架构理解',
  'architecture-change-plan': '架构变更规划',
  'implementation-reconcile': '实施结果核验',
};

const ARTIFACT_TYPE = {
  'evidence-manifest': '证据清单',
  'architecture-snapshot': '架构快照',
  'architecture-proposal': '变更提案',
  'implementation-report': '实施报告',
};

const PROPOSAL_STATUS = {
  pending: '待审阅',
  reviewing: '审阅中',
  draft: '草案',
  approved: '已确认',
  accepted: '已确认',
  partially_accepted: '部分确认',
  rejected: '已拒绝',
};

const ARCHITECTURE_GATE_STATUS = {
  aligned: { label: '自动架构核对未发现偏离', tone: 'draft' },
  'explained-drift': { label: '偏离已有智能体说明', tone: 'draft' },
  'unresolved-drift': { label: '存在未解决偏离', tone: 'rejected' },
};

const AGENT_CLAIM_STATUS = {
  complete: { label: '智能体声称完成', tone: 'ai' },
  partial: { label: '智能体声称部分完成', tone: 'neutral' },
  blocked: { label: '智能体声称受阻', tone: 'rejected' },
};

const HUMAN_REVIEW_STATUS = {
  accepted: { label: '人工已接受', tone: 'confirmed' },
  'revision-requested': { label: '人工要求修订', tone: 'draft' },
  rejected: { label: '人工已拒绝', tone: 'rejected' },
};

const DRIFT_KIND = {
  missing: { label: '缺失', tone: 'rejected' },
  extra: { label: '额外', tone: 'ai' },
  changed: { label: '已改变', tone: 'draft' },
  unverified: { label: '未核验', tone: 'neutral' },
};

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function formatTime(value) {
  if (!value) return '时间未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}

function formatConfidence(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`;
}

function proposalChangeCount(proposal) {
  if (Number.isFinite(proposal.changeCount)) return proposal.changeCount;
  return asList(proposal.changes || proposal.items).length;
}

function proposalEvidenceCount(proposal) {
  if (Number.isFinite(proposal.evidenceCount)) return proposal.evidenceCount;
  return asList(proposal.evidence).length;
}

function proposalStatusClass(status) {
  if (['approved', 'accepted', 'partially_accepted'].includes(status)) return 'confirmed';
  if (status === 'rejected') return 'rejected';
  if (status === 'draft') return 'draft';
  return 'pending';
}

function artifactSummary(artifact) {
  const summary = artifact?.summary || {};
  if (artifact?.artifactType === 'evidence-manifest') return `${summary.evidenceCount || 0} 条依据`;
  if (artifact?.artifactType === 'architecture-snapshot') {
    return `${summary.nodeCount || 0} 个节点 · ${summary.edgeCount || 0} 条关系`;
  }
  if (artifact?.artifactType === 'architecture-proposal') return `${summary.changeCount || 0} 项变更`;
  if (artifact?.artifactType === 'implementation-report') {
    const status = {
      complete: '智能体声称完成',
      partial: '智能体声称部分完成',
      blocked: '智能体声称受阻',
    }[summary.status] || '等待智能体声明';
    return `${status} · 检查通过 ${summary.passedCheckCount || 0} · 偏离 ${summary.driftCount || 0}`;
  }
  return '已提交';
}

function StatusBadge({ status, type = 'proposal' }) {
  const isRun = type === 'run';
  const label = isRun ? (RUN_STATUS[status] || status || '未标记') : (PROPOSAL_STATUS[status] || status || '待审阅');
  const tone = isRun
    ? (status === 'reviewed' ? 'confirmed' : status === 'failed' ? 'rejected' : status === 'submitted' ? 'draft' : 'neutral')
    : proposalStatusClass(status);
  return <span className={`analysis-badge analysis-badge--${tone}`}>{label}</span>;
}

function EmptyState({ children }) {
  return <p className="analysis-empty">{children}</p>;
}

function ReconciliationElement({ label, element }) {
  if (!element) {
    return (
      <div className="analysis-reconciliation-element is-empty">
        <span>{label}</span>
        <p>无</p>
      </div>
    );
  }
  const isEdge = element.targetType === 'edge';
  return (
    <div className="analysis-reconciliation-element">
      <span>{label}</span>
      <strong>{isEdge ? `${element.source} → ${element.target}` : element.name}</strong>
      <p>{isEdge
        ? `${element.label} · ${element.relationType} · 边界 ${element.controlledBoundaryPosture}`
        : element.purpose}</p>
      {!isEdge && <small>权限边界：{element.authorization}</small>}
      {asList(element.evidenceIds).length > 0 && (
        <code>{element.evidenceIds.join(' · ')}</code>
      )}
    </div>
  );
}

function ArchitectureGatePanel({ run, busy, onReviewImplementation }) {
  const [reviewNote, setReviewNote] = useState('');
  const gate = run.architectureGate;
  if (!gate) return null;
  const status = ARCHITECTURE_GATE_STATUS[gate.status] || {
    label: gate.status || '等待自动核验',
    tone: 'neutral',
  };
  const claim = AGENT_CLAIM_STATUS[run.agentClaim?.status] || {
    label: run.agentClaim?.status || '智能体未声明结果',
    tone: 'neutral',
  };
  const humanReview = run.humanReview;
  const reviewStatus = humanReview
    ? (HUMAN_REVIEW_STATUS[humanReview.decision] || { label: humanReview.decision, tone: 'neutral' })
    : null;
  const counts = gate.counts || {};
  const drift = asList(gate.drift);
  const unsupported = asList(gate.crossCheck?.unsupported);
  const hasDetails = Array.isArray(gate.drift);
  const noteReady = Boolean(reviewNote.trim());
  const submitReview = (decision) => {
    if (!noteReady || busy || humanReview) return;
    onReviewImplementation?.(run, decision, reviewNote.trim());
  };
  return (
    <section className={`analysis-reconciliation analysis-reconciliation--${gate.status || 'pending'}`}>
      <div className="analysis-reconciliation__heading">
        <div>
          <span className="analysis-reconciliation__kicker">ARCHITECTURE GATE · HUMAN REVIEW</span>
          <strong>实施结果验收</strong>
        </div>
        <span className={`analysis-badge analysis-badge--${status.tone}`}>{status.label}</span>
      </div>
      <p>
        {gate.status === 'aligned' && '自动架构核对未发现偏离（仍需人工验收）。'}
        {gate.status === 'explained-drift' && '智能体已为偏离提供逐项说明，服务端只确认条目能够对应；说明是否合理仍待人工判断。'}
        {gate.status === 'unresolved-drift' && '仍有未说明、未报告或未核验项，尚不能进入人工接受。'}
      </p>
      <div className="analysis-implementation-state">
        <div>
          <span>智能体声明</span>
          <strong className={`analysis-badge analysis-badge--${claim.tone}`}>{claim.label}</strong>
          <small>这是智能体自报，不是最终结论。</small>
        </div>
        <div>
          <span>自动架构门禁</span>
          <strong className={`analysis-badge analysis-badge--${status.tone}`}>{status.label}</strong>
          <small>{gate.readyForHumanReview ? '可提交给用户验收' : '需先解决自动核对问题'}</small>
        </div>
        <div>
          <span>人工验收</span>
          {reviewStatus
            ? <strong className={`analysis-badge analysis-badge--${reviewStatus.tone}`}>{reviewStatus.label}</strong>
            : <strong className="analysis-badge analysis-badge--neutral">等待用户判断</strong>}
          <small>{humanReview ? `${humanReview.reviewer} · ${formatTime(humanReview.reviewedAt)}` : '智能体不能代替用户验收'}</small>
        </div>
      </div>
      <div className="analysis-reconciliation-counts" aria-label="实施偏离分类统计">
        {Object.entries(DRIFT_KIND).map(([kind, meta]) => (
          <span key={kind}><b>{counts[kind] || 0}</b>{meta.label}</span>
        ))}
        <span><b>{counts.unexplained || 0}</b>未解释</span>
      </div>
      {!hasDetails && <small className="analysis-reconciliation__compact-note">当前为精简摘要；按需读取核验详情可查看逐项证据。</small>}
      {hasDetails && drift.length > 0 && (
        <div className="analysis-drift-list">
          {drift.map((item) => {
            const kind = DRIFT_KIND[item.kind] || { label: item.kind, tone: 'neutral' };
            return (
              <article className="analysis-drift-item" key={item.id}>
                <div className="analysis-drift-item__heading">
                  <div>
                    <span className={`analysis-badge analysis-badge--${kind.tone}`}>{kind.label}</span>
                    <strong>{item.targetType === 'edge' ? '关系' : '模块'} · {item.targetId}</strong>
                  </div>
                  <code>{item.id}</code>
                </div>
                <p>{item.summary}</p>
                {asList(item.changedFields).length > 0 && (
                  <div className="analysis-drift-fields">
                    {item.changedFields.map((field) => <span key={field}>{field}</span>)}
                  </div>
                )}
                <div className="analysis-reconciliation-elements">
                  <ReconciliationElement label="正式目标" element={item.target} />
                  <ReconciliationElement label="实施快照" element={item.actual} />
                </div>
                <div className={`analysis-drift-explanation is-${item.explanation?.status || 'unexplained'}`}>
                  <strong>{item.explanation?.status === 'agent-provided' ? '智能体已提供解释，待人工判断' : '智能体尚未说明'}</strong>
                  <p>{item.explanation?.summary || '实施报告没有覆盖这项服务端计算出的偏离。'}</p>
                  {asList(item.explanation?.evidenceIds).length > 0 && (
                    <code>{item.explanation.evidenceIds.join(' · ')}</code>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {hasDetails && !drift.length && <p className="analysis-reconciliation__aligned-note">没有检测到模块、职责、权限或关系边界偏离。</p>}
      {unsupported.length > 0 && (
        <div className="analysis-reconciliation-unsupported">
          <strong>报告中有 {unsupported.length} 项声明无法由快照对比支持</strong>
          {unsupported.map((item) => <p key={item.id}>{item.kind} · {item.targetId}：{item.summary}</p>)}
        </div>
      )}
      {humanReview ? (
        <div className={`analysis-human-review is-${humanReview.decision}`}>
          <div>
            <strong>{reviewStatus.label}</strong>
            <span>{humanReview.reviewer} · {formatTime(humanReview.reviewedAt)}</span>
          </div>
          <p>{humanReview.note}</p>
          {humanReview.decision === 'accepted' && gate.status === 'explained-drift' && (
            <small>本次接受只表示用户知情接受这些实施偏离，不会修改正式目标。</small>
          )}
        </div>
      ) : (
        <div className="analysis-human-review-controls">
          <label>
            <span>人工验收备注（必填）</span>
            <textarea
              rows="3"
              value={reviewNote}
              disabled={busy}
              placeholder="记录为什么接受、拒绝或要求修订；该备注会与验收时间和结论一起保存。"
              onChange={(event) => setReviewNote(event.target.value)}
            />
          </label>
          <div>
            <button
              className="primary"
              type="button"
              disabled={busy || !noteReady || !gate.readyForHumanReview}
              title={gate.readyForHumanReview ? '' : '自动架构门禁尚未达到可人工接受状态'}
              onClick={() => submitReview('accepted')}
            >人工接受</button>
            <button className="quiet" type="button" disabled={busy || !noteReady} onClick={() => submitReview('revision-requested')}>要求修订</button>
            <button className="danger" type="button" disabled={busy || !noteReady} onClick={() => submitReview('rejected')}>拒绝结果</button>
          </div>
          <small>接受实施结果不会修改正式目标；目标变更仍须经过独立提案、接受草案与人工发布。</small>
        </div>
      )}
    </section>
  );
}

function RunList({ runs, integration, busy, onRefresh, onCopyConnection, onReviewImplementation }) {
  return (
    <>
      <div className="analysis-section-heading">
        <div>
          <h3>外部智能体运行</h3>
          <p>Codex、Claude Code 等智能体可从代码仓库、设计文档或用户确认的讨论结论形成结构化结果，再交给这里审阅。</p>
        </div>
        <button className="quiet" type="button" disabled={busy} onClick={onRefresh}>{busy ? '正在刷新…' : '刷新收件箱'}</button>
      </div>

      <div className="analysis-integration-card">
        <div>
          <span className="analysis-badge analysis-badge--ai">MCP · LOCAL</span>
          <strong>查看器不内嵌模型，也不会自动扫描仓库</strong>
          <p>概念项目无需代码仓库即可提交目标提案；代码项目则用代码事实描述当前架构。人工仍是唯一的接受与发布者。</p>
        </div>
        <div className="analysis-integration-commands">
          <code>{integration?.mcpCommand || 'npm run mcp'}</code>
          <code>{integration?.cliCommand || 'npm run agent --'}</code>
          <button className="primary" type="button" onClick={onCopyConnection}>复制接入说明</button>
        </div>
      </div>

      {!runs.length && <EmptyState>还没有智能体运行。连接 MCP 后，让智能体先调用 create_agent_run。</EmptyState>}

      <div className="analysis-card-list">
        {runs.map((run, index) => {
          const artifacts = asList(run.artifacts);
          return (
            <article className="analysis-run-card" key={run.id || `agent-run-${index}`}>
              <div className="analysis-card-heading">
                <div>
                  <strong>{run.agentName || '未命名智能体'}</strong>
                  <code>{run.id}</code>
                </div>
                <StatusBadge status={run.status || 'active'} type="run" />
              </div>
              {run.summary && <p>{run.summary}</p>}
              {run.approvedTarget && (
                <div className="analysis-target-lock">
                  <div>
                    <span>已锁定正式目标</span>
                    <strong>{run.approvedTarget.diagramId} · {run.approvedTarget.revisionId}</strong>
                  </div>
                  <code title={run.approvedTarget.semanticHash}>{run.approvedTarget.semanticHash.slice(0, 12)}…</code>
                </div>
              )}
              <div className="analysis-meta-row">
                <span>{TASK_TYPE[run.taskType] || run.taskType}</span>
                <span>{run.agentClient || '未知客户端'}</span>
                <span>{run.view === 'target' ? '目标架构' : '当前架构'} · r{run.baseRevision}</span>
                <span>{artifacts.length} 个工件</span>
                <span>{run.pendingProposalCount || 0} 项待审</span>
              </div>
              {artifacts.length > 0 && (
                <div className="analysis-artifact-list" aria-label="本次运行提交的工件">
                  {artifacts.map((artifact) => (
                    <div className="analysis-artifact-item" key={artifact.id}>
                      <strong>{ARTIFACT_TYPE[artifact.artifactType] || artifact.artifactType}</strong>
                      <span>{artifactSummary(artifact)}</span>
                    </div>
                  ))}
                </div>
              )}
              <ArchitectureGatePanel run={run} busy={busy} onReviewImplementation={onReviewImplementation} />
              <small className="analysis-run-time">更新于 {formatTime(run.updatedAt || run.createdAt)}</small>
            </article>
          );
        })}
      </div>
    </>
  );
}

function ProposalList({ proposals, busy, onRefresh, onOpenProposal }) {
  const pendingCount = proposals.filter((proposal) => ['pending', 'reviewing', 'draft'].includes(proposal.status || 'pending')).length;
  return (
    <>
      <div className="analysis-section-heading">
        <div>
          <h3>候选架构变更</h3>
          <p>这里只接收外部智能体提交的结构化差异；正式架构仍需人工逐项确认。</p>
        </div>
        <button className="quiet" type="button" disabled={busy} onClick={onRefresh}>{busy ? '正在刷新…' : '刷新'}</button>
      </div>

      <div className="analysis-summary-strip">
        <span className="analysis-badge analysis-badge--ai">智能体提交</span>
        <strong>{pendingCount} 项待人工审阅</strong>
        <span>提案不会直接改写正式架构</span>
      </div>

      {!proposals.length && <EmptyState>暂时没有待审提案。智能体提交架构快照或变更方案后，会出现在这里。</EmptyState>}

      <div className="analysis-card-list">
        {proposals.map((proposal, index) => {
          const confidence = formatConfidence(proposal.confidence);
          const changeCount = proposalChangeCount(proposal);
          const evidenceCount = proposalEvidenceCount(proposal);
          const status = proposal.status || 'pending';
          return (
            <article className="analysis-proposal-card" key={proposal.id || `proposal-${index}`}>
              <div className="analysis-card-heading">
                <div>
                  <div className="analysis-title-with-mark">
                    <span className="analysis-ai-mark" aria-hidden="true">↗</span>
                    <strong>{proposal.title || proposal.name || '未命名架构提案'}</strong>
                  </div>
                  {proposal.createdAt && <small>{formatTime(proposal.createdAt)}</small>}
                </div>
                <StatusBadge status={status} />
              </div>
              {proposal.summary && <p>{proposal.summary}</p>}
              <div className="analysis-meta-row">
                <span>{changeCount} 项变更</span>
                <span>{evidenceCount} 条依据</span>
                {proposal.origin?.agentName && <span>{proposal.origin.agentName}</span>}
                {proposal.origin?.agentClient && <span>{proposal.origin.agentClient}</span>}
                {confidence && <span>置信度 {confidence}</span>}
              </div>
              {onOpenProposal && (
                <footer className="analysis-card-actions">
                  <button className={['approved', 'accepted', 'rejected'].includes(status) ? 'quiet' : 'primary'} type="button" onClick={() => onOpenProposal(proposal)}>
                    {['approved', 'accepted', 'rejected'].includes(status) ? '查看审阅结果' : '开始审阅'}
                  </button>
                </footer>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

function ReviewList({ reviews, onOpenProposal }) {
  return (
    <>
      <div className="analysis-section-heading">
        <div>
          <h3>人工审阅记录</h3>
          <p>保留架构提案与实施结果的接受、拒绝和要求修订记录，供后续追溯。</p>
        </div>
      </div>

      {!reviews.length && <EmptyState>尚无审阅记录。完成提案审阅或实施结果验收后，记录会显示在这里。</EmptyState>}

      <div className="analysis-card-list">
        {reviews.map((review, index) => {
          const isImplementation = review.kind === 'implementation';
          const acceptedCount = review.acceptedCount ?? review.accepted ?? 0;
          const rejectedCount = review.rejectedCount ?? review.rejected ?? 0;
          const status = review.status || (acceptedCount > 0 ? 'approved' : 'rejected');
          const implementationStatus = isImplementation
            ? (HUMAN_REVIEW_STATUS[review.decision] || { label: review.decision, tone: 'neutral' })
            : null;
          return (
            <article className="analysis-review-card" key={review.id || review.proposalId || `review-${index}`}>
              <div className="analysis-card-heading">
                <div>
                  <strong>{review.title || review.proposalTitle || '架构提案审阅'}</strong>
                  <small>{review.reviewedAt ? formatTime(review.reviewedAt) : '审阅时间未记录'}</small>
                </div>
                <span className={`analysis-badge analysis-badge--${implementationStatus?.tone || 'confirmed'}`}>
                  {implementationStatus?.label || '人工确认'}
                </span>
              </div>
              {review.summary && <p>{review.summary}</p>}
              <div className="analysis-meta-row">
                {isImplementation ? <span>实施结果验收</span> : <span>接受 {acceptedCount}</span>}
                {!isImplementation && <span>拒绝 {rejectedCount}</span>}
                {review.reviewer && <span>{review.reviewer}</span>}
                {!isImplementation && <StatusBadge status={status} />}
              </div>
              {onOpenProposal && review.proposal && (
                <footer className="analysis-card-actions">
                  <button className="quiet" type="button" onClick={() => onOpenProposal(review.proposal)}>回看提案</button>
                </footer>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

/**
 * A presentational inbox for external coding-agent runs, proposals, and human review.
 * It deliberately does not fetch data on its own.
 */
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
}) {
  const [internalTab, setInternalTab] = useState(defaultTab);
  const selectedTab = activeTab || internalTab;
  const agentRuns = useMemo(() => asList(runs), [runs]);
  const candidateProposals = useMemo(() => asList(proposals), [proposals]);
  const reviewRecords = useMemo(() => asList(reviews), [reviews]);
  const collaborationSkills = useMemo(() => asList(skills), [skills]);

  if (!open) return null;

  const changeTab = (tabId) => {
    if (!activeTab) setInternalTab(tabId);
    onTabChange?.(tabId);
  };

  return (
    <div className="phase3-backdrop analysis-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <aside className="phase3-sheet analysis-workbench" role="dialog" aria-modal="true" aria-labelledby="analysis-workbench-title">
        <header className="sheet-heading analysis-workbench__heading">
          <div>
            <p className="kicker">AGENT ARCHITECTURE HANDOFF</p>
            <h2 id="analysis-workbench-title">智能体架构工作台</h2>
            <p>让外部编码智能体提交它对项目的架构理解，再由人审阅、修订和发布。</p>
          </div>
          <button className="quiet sheet-close" type="button" onClick={onClose} aria-label="关闭智能体架构工作台">关闭</button>
        </header>

        <div className="analysis-tabs" role="tablist" aria-label="智能体架构工作台内容">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              id={`analysis-tab-${tab.id}`}
              className={selectedTab === tab.id ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={selectedTab === tab.id}
              aria-controls={`analysis-panel-${tab.id}`}
              onClick={() => changeTab(tab.id)}
            >{tab.label}</button>
          ))}
        </div>

        <section id={`analysis-panel-${selectedTab}`} role="tabpanel" aria-labelledby={`analysis-tab-${selectedTab}`} className="analysis-tab-panel">
          {selectedTab === 'runs' && (
            <RunList
              runs={agentRuns}
              integration={integration}
              busy={busy}
              onRefresh={onRefresh}
              onCopyConnection={onCopyConnection}
              onReviewImplementation={onReviewImplementation}
            />
          )}
          {selectedTab === 'proposals' && (
            <ProposalList
              proposals={candidateProposals}
              busy={busy}
              onRefresh={onRefresh}
              onOpenProposal={onOpenProposal}
            />
          )}
          {selectedTab === 'reviews' && <ReviewList reviews={reviewRecords} onOpenProposal={onOpenProposal} />}
          {selectedTab === 'skills' && <SkillCatalog skills={collaborationSkills} onCopyPrompt={onCopySkillPrompt} />}
        </section>
      </aside>
    </div>
  );
}
