const ORIGIN_LABELS = {
  initial: '初始版本',
  migration: '迁移保留',
  publish: '发布',
  restore: '从历史恢复',
  legacy: '旧版迁移',
};

const formatTime = (value) => {
  if (!value) return '时间未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
};

function revisionNumber(revision) {
  if (typeof revision.revision === 'number') return `R${revision.revision}`;
  return String(revision.revision || revision.revisionId || '未知版本');
}

function revisionScale(revision) {
  const nodeCount = revision.nodeCount ?? revision.graph?.nodes?.length;
  const edgeCount = revision.edgeCount ?? revision.graph?.edges?.length;
  if (nodeCount === undefined || edgeCount === undefined) return '规模未记录';
  return `${nodeCount} 个模块 · ${edgeCount} 条关系`;
}

function DiffSummary({ diff }) {
  if (!diff) return null;
  const categories = diff.summary || diff.categories || diff;
  const items = [
    ['结构', categories.structural ?? categories.structure ?? 0],
    ['语义', categories.semantic ?? 0],
    ['布局', categories.layout ?? 0],
    ['文档绑定', categories.document ?? categories.documentBindings ?? 0],
    ['关系', categories.relationship ?? categories.relations ?? 0],
  ];
  return (
    <div className="revision-diff" aria-label="与当前正式版本的差异">
      <strong>与当前正式版本比较</strong>
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
  if (!open) return null;
  return (
    <div className="phase3-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="phase3-sheet revision-sheet" role="dialog" aria-modal="true" aria-labelledby="revision-title">
        <header className="sheet-heading">
          <div>
            <p className="kicker">正式架构记录</p>
            <h2 id="revision-title">版本历史</h2>
            <p>{readOnly ? '旧版本始终保留；此处只用于查看和比较。' : '旧版本始终保留；恢复会产生一个新的正式修订。'}</p>
          </div>
          <button className="quiet sheet-close" type="button" onClick={onClose} aria-label="关闭版本历史">关闭</button>
        </header>

        {activeDraft && !readOnly && (
          <div className="sheet-notice warning">
            当前有未发布草案。为避免覆盖你的工作，请先发布或放弃草案，再恢复历史版本。
          </div>
        )}

        <DiffSummary diff={diff} />

        <div className="revision-list" aria-busy={loading}>
          {loading && <p className="sheet-empty">正在读取本地版本目录…</p>}
          {!loading && !revisions.length && <p className="sheet-empty">暂无可显示的正式版本。</p>}
          {revisions.map((revision) => {
            const isHead = revision.revisionId === headRevisionId;
            const selected = revision.revisionId === selectedRevisionId;
            return (
              <article className={`revision-card ${selected ? 'selected' : ''}`} key={revision.revisionId}>
                <div className="revision-card-heading">
                  <div>
                    <strong>{revisionNumber(revision)}</strong>
                    {isHead && <span className="head-badge">当前正式版</span>}
                  </div>
                  <span>{ORIGIN_LABELS[revision.origin] || revision.origin || '发布'}</span>
                </div>
                <p className="revision-message">{revision.message || '迁移保留版本（无发布说明）'}</p>
                <dl className="revision-meta">
                  <div><dt>时间</dt><dd>{formatTime(revision.publishedAt)}</dd></div>
                  <div><dt>规模</dt><dd>{revisionScale(revision)}</dd></div>
                  <div><dt>父版本</dt><dd>{revision.parentRevisionId || '无'}</dd></div>
                  {revision.restoredFromRevisionId && (
                    <div><dt>恢复来源</dt><dd>{revision.restoredFromRevisionId}</dd></div>
                  )}
                </dl>
                <div className="revision-actions">
                  <button type="button" onClick={() => onInspect(revision)}>
                    {selected ? '正在查看' : '查看并比较'}
                  </button>
                  {!readOnly && !isHead && (
                    <button
                      className="primary"
                      type="button"
                      disabled={Boolean(activeDraft)}
                      onClick={() => onRestore(revision)}
                    >以此版本创建新修订</button>
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
