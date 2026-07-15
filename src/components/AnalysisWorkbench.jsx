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
    const status = { complete: '完成', partial: '部分完成', blocked: '受阻' }[summary.status] || '待核验';
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

function RunList({ runs, integration, busy, onRefresh, onCopyConnection }) {
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
          <p>保留接受、拒绝和人工修订的判断，为后续发布提供可追溯依据。</p>
        </div>
      </div>

      {!reviews.length && <EmptyState>尚无审阅记录。完成第一项提案审阅后，记录会显示在这里。</EmptyState>}

      <div className="analysis-card-list">
        {reviews.map((review, index) => {
          const acceptedCount = review.acceptedCount ?? review.accepted ?? 0;
          const rejectedCount = review.rejectedCount ?? review.rejected ?? 0;
          const status = review.status || (acceptedCount > 0 ? 'approved' : 'rejected');
          return (
            <article className="analysis-review-card" key={review.id || review.proposalId || `review-${index}`}>
              <div className="analysis-card-heading">
                <div>
                  <strong>{review.title || review.proposalTitle || '架构提案审阅'}</strong>
                  <small>{review.reviewedAt ? formatTime(review.reviewedAt) : '审阅时间未记录'}</small>
                </div>
                <span className="analysis-badge analysis-badge--confirmed">人工确认</span>
              </div>
              {review.summary && <p>{review.summary}</p>}
              <div className="analysis-meta-row">
                <span>接受 {acceptedCount}</span>
                <span>拒绝 {rejectedCount}</span>
                {review.reviewer && <span>{review.reviewer}</span>}
                <StatusBadge status={status} />
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
