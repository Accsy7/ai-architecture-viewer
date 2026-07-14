import { useMemo, useState } from 'react';
import '../analysis.css';
import SkillCatalog from './SkillCatalog.jsx';

const TABS = [
  { id: 'sources', label: '资料来源' },
  { id: 'proposals', label: 'AI 提案' },
  { id: 'reviews', label: '审阅记录' },
  { id: 'skills', label: '协作 Skill' },
];

const SOURCE_STATUS = {
  ready: '可分析',
  processing: '处理中',
  failed: '读取失败',
  ignored: '已忽略',
  stale: '待更新',
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

function sourcePath(source) {
  return source.relativePath || source.path || source.location || '未提供路径';
}

function sourceTitle(source) {
  return source.title || source.name || sourcePath(source).split(/[\\/]/).pop() || '未命名资料';
}

function sourceEvidenceCount(source) {
  if (Number.isFinite(source.evidenceCount)) return source.evidenceCount;
  return asList(source.evidence).length;
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

function StatusBadge({ status, type = 'proposal' }) {
  const isSource = type === 'source';
  const label = isSource ? (SOURCE_STATUS[status] || status || '未标记') : (PROPOSAL_STATUS[status] || status || '待审阅');
  const tone = isSource
    ? (status === 'ready' ? 'confirmed' : status === 'failed' ? 'rejected' : status === 'stale' ? 'pending' : 'neutral')
    : proposalStatusClass(status);
  return <span className={`analysis-badge analysis-badge--${tone}`}>{label}</span>;
}

function EmptyState({ children }) {
  return <p className="analysis-empty">{children}</p>;
}

function SourceList({ sources, onToggleSource, onOpenSource }) {
  const selectedCount = sources.filter((source) => source.selected).length;
  return (
    <>
      <div className="analysis-section-heading">
        <div>
          <h3>可分析资料</h3>
          <p>只分析你明确加入的文件；敏感文件会在进入模型前由本地服务过滤。</p>
        </div>
        <span className="analysis-source-count">已选 {selectedCount} / {sources.length}</span>
      </div>

      <p className="analysis-provider-note">开始分析时，已选资料的证据摘录和当前架构视图会发送给当前配置的模型服务。请仅选择获准发送的内容。</p>

      {!sources.length && <EmptyState>还没有资料来源。添加 Markdown、项目配置或架构描述后即可开始分析。</EmptyState>}

      <div className="analysis-card-list">
        {sources.map((source, index) => {
          const evidenceCount = sourceEvidenceCount(source);
          return (
            <article className="analysis-source-card" key={source.id || `${sourcePath(source)}-${index}`}>
              <div className="analysis-card-heading">
                <div>
                  <strong>{sourceTitle(source)}</strong>
                  <code>{sourcePath(source)}</code>
                </div>
                <StatusBadge status={source.status || 'ready'} type="source" />
              </div>
              {source.summary && <p>{source.summary}</p>}
              <div className="analysis-meta-row">
                <span>{source.type || '文件'}</span>
                <span>提取 {evidenceCount} 条证据</span>
                {source.lastScannedAt && <span>更新于 {formatTime(source.lastScannedAt)}</span>}
              </div>
              {(onOpenSource || onToggleSource) && (
                <footer className="analysis-card-actions">
                  {onOpenSource && <button className="quiet" type="button" onClick={() => onOpenSource(source)}>查看资料</button>}
                  {onToggleSource && (
                    <button className={source.selected ? 'quiet danger' : 'primary'} type="button" onClick={() => onToggleSource(source)}>
                      {source.selected ? '移出分析' : '加入分析'}
                    </button>
                  )}
                </footer>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

function ProposalList({ proposals, analyzing, provider, onAnalyze, onOpenProposal }) {
  const pendingCount = proposals.filter((proposal) => ['pending', 'reviewing', 'draft'].includes(proposal.status || 'pending')).length;
  const providerConfigured = Boolean(provider?.configured);
  return (
    <>
      <div className="analysis-section-heading">
        <div>
          <h3>候选架构变更</h3>
          <p>AI 只能提出有证据的候选变更；正式架构仍需人工逐项确认。</p>
        </div>
        {onAnalyze && (
          <button className="analysis-ai-button" type="button" disabled={analyzing || !providerConfigured} onClick={onAnalyze}>
            {analyzing ? '正在生成提案…' : '✦ 分析资料'}
          </button>
        )}
      </div>

      <div className="analysis-summary-strip">
        <span className="analysis-badge analysis-badge--ai">AI 生成</span>
        <strong>{pendingCount} 项待人工审阅</strong>
        <span>提案不会直接改写正式架构</span>
      </div>

      {!providerConfigured && (
        <p className="analysis-provider-note">AI 服务尚未配置。浏览、审阅和草案功能仍可使用；配置服务端环境变量后才可生成新提案。</p>
      )}

      {!proposals.length && <EmptyState>{analyzing ? '正在从已选资料中整理结构化候选…' : '暂时没有 AI 提案。资料准备好后，可发起一次分析。'}</EmptyState>}

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
                    <span className="analysis-ai-mark" aria-hidden="true">✦</span>
                    <strong>{proposal.title || proposal.name || '未命名架构提案'}</strong>
                  </div>
                  {proposal.createdAt && <small>{formatTime(proposal.createdAt)}</small>}
                </div>
                <StatusBadge status={status} />
              </div>
              {proposal.summary && <p>{proposal.summary}</p>}
              <div className="analysis-meta-row">
                <span>{changeCount} 项变更</span>
                <span>{evidenceCount} 条证据</span>
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
 * A presentational workbench for explicitly selected source material, AI proposals,
 * and their human review trail. It deliberately does not fetch data on its own.
 */
export default function AnalysisWorkbench({
  open,
  sources = [],
  proposals = [],
  reviews = [],
  skills = [],
  activeTab,
  defaultTab = 'sources',
  analyzing = false,
  provider = null,
  onClose,
  onTabChange,
  onToggleSource,
  onOpenSource,
  onAnalyze,
  onOpenProposal,
  onCopySkillPrompt,
}) {
  const [internalTab, setInternalTab] = useState(defaultTab);
  const selectedTab = activeTab || internalTab;
  const selectedSources = useMemo(() => asList(sources), [sources]);
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
            <p className="kicker">EVIDENCE-LED AI</p>
            <h2 id="analysis-workbench-title">架构分析工作台</h2>
            <p>从明确选择的资料中生成候选架构，并将每一步交给人来确认。</p>
          </div>
          <button className="quiet sheet-close" type="button" onClick={onClose} aria-label="关闭架构分析工作台">关闭</button>
        </header>

        <div className="analysis-tabs" role="tablist" aria-label="架构分析工作台内容">
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
          {selectedTab === 'sources' && (
            <SourceList
              sources={selectedSources}
              onToggleSource={onToggleSource}
              onOpenSource={onOpenSource}
            />
          )}
          {selectedTab === 'proposals' && (
            <ProposalList
              proposals={candidateProposals}
              analyzing={analyzing}
              provider={provider}
              onAnalyze={onAnalyze}
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
