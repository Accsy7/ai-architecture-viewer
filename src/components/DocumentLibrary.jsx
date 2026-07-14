import { useMemo, useState } from 'react';
import {
  diagnosticMessage,
  DOCUMENT_AUTHORITIES,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  documentAuthorityLabel,
  documentStatusLabel,
  documentTypeLabel,
} from '../document-model.js';

const EMPTY_FORM = {
  title: '',
  path: '',
  type: 'technical_spec',
  status: 'active',
  authority: 'supporting',
  summary: '',
};

function makeDocument(form) {
  return {
    id: `doc-${Date.now().toString(36)}`,
    title: form.title.trim(),
    type: form.type,
    status: form.status,
    authority: form.authority,
    path: form.path.trim(),
    summary: form.summary.trim(),
    supersedes: null,
    lastVerifiedAt: new Date().toISOString(),
  };
}

function Diagnostics({ diagnostics }) {
  if (!diagnostics?.length) return null;
  const infoOnly = diagnostics.every((diagnostic) => diagnostic?.severity === 'info');
  return (
    <ul className={`document-diagnostics ${infoOnly ? 'info-only' : ''}`}>
      {diagnostics.map((diagnostic, index) => (
        <li key={`${diagnostic?.code || 'diagnostic'}-${index}`} className={`severity-${diagnostic?.severity || 'warning'}`}>
          {diagnosticMessage(diagnostic)}
          {diagnostic?.nodeId && (
            <small>（{diagnostic.view === 'target' ? '目标' : '当前'} · {diagnostic.nodeId}{diagnostic.scope ? ` · ${diagnostic.scope}` : ''}）</small>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function DocumentLibrary({
  open,
  loading,
  documents,
  bindingDiagnostics,
  readOnly = false,
  onClose,
  onPreview,
  onRegister,
}) {
  const [query, setQuery] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN');
    if (!needle) return documents;
    return documents.filter((document) => [
      document.title,
      document.path,
      document.summary,
      documentTypeLabel(document.type),
    ].some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(needle)));
  }, [documents, query]);

  if (!open) return null;
  return (
    <div className="phase3-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="phase3-sheet document-sheet" role="dialog" aria-modal="true" aria-labelledby="documents-title">
        <header className="sheet-heading">
          <div>
            <p className="kicker">本地登记册</p>
            <h2 id="documents-title">项目文档</h2>
            <p>{readOnly ? '查看与架构模块关联的本地 Markdown 文档。' : '这里只登记明确选择的 Markdown 文件；不会自动扫描或读取整个项目。'}</p>
          </div>
          <button className="quiet sheet-close" type="button" onClick={onClose} aria-label="关闭项目文档">关闭</button>
        </header>

        {bindingDiagnostics?.length > 0 && (
          <div className="sheet-notice warning">
            <strong>绑定检查发现 {bindingDiagnostics.length} 项需要关注</strong>
            <Diagnostics diagnostics={bindingDiagnostics} />
          </div>
        )}

        <div className="document-toolbar">
          <label className="document-search">
            <span>搜索文档</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、路径或用途" />
          </label>
          {!readOnly && (
            <button className="primary" type="button" onClick={() => setShowRegister((value) => !value)}>
              {showRegister ? '收起登记表' : '＋ 登记文档'}
            </button>
          )}
        </div>

        {!readOnly && showRegister && (
          <form className="document-register" onSubmit={async (event) => {
            event.preventDefault();
            setSubmitting(true);
            try {
              await onRegister(makeDocument(form));
              setForm(EMPTY_FORM);
              setShowRegister(false);
            } catch {
              // 父级已显示具体的本地校验错误，保留表单便于修正。
            } finally {
              setSubmitting(false);
            }
          }}>
            <h3>登记一个本地 Markdown 文档</h3>
            <p>路径必须相对于当前项目文档根目录，例如 `docs/architecture.md`。</p>
            <div className="document-form-grid">
              <label className="field"><span>显示名称</span><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
              <label className="field"><span>相对路径</span><input required value={form.path} placeholder="docs/example.md" onChange={(event) => setForm({ ...form, path: event.target.value })} /></label>
              <label className="field"><span>文档类型</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{DOCUMENT_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label className="field"><span>权威程度</span><select value={form.authority} onChange={(event) => setForm({ ...form, authority: event.target.value })}>{DOCUMENT_AUTHORITIES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label className="field"><span>文档状态</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{DOCUMENT_STATUSES.slice(0, 2).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label className="field document-summary-field"><span>一句话说明</span><textarea rows="3" required value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label>
            </div>
            <div className="dialog-actions"><button className="primary" type="submit" disabled={submitting}>{submitting ? '正在登记…' : '确认登记'}</button></div>
          </form>
        )}

        <div className="document-list" aria-busy={loading}>
          {loading && <p className="sheet-empty">正在读取本地文档登记册…</p>}
          {!loading && !filtered.length && <p className="sheet-empty">没有匹配的文档。</p>}
          {filtered.map((document) => (
            <article className="document-card" key={document.id}>
              <div className="document-card-heading">
                <div><strong>{document.title}</strong><code>{document.path}</code></div>
                <span className={`document-status status-${document.status}`}>{documentStatusLabel(document.status)}</span>
              </div>
              <div className="document-tags">
                <span>{documentTypeLabel(document.type)}</span>
                <span>{documentAuthorityLabel(document.authority)}</span>
              </div>
              <p>{document.summary}</p>
              <Diagnostics diagnostics={document.diagnostics} />
              <footer>
                <small>
                  当前绑定 {document.referenceSummary?.activeCount || 0} · 历史引用 {document.referenceSummary?.historicalCount || 0}
                </small>
                <button type="button" onClick={() => onPreview(document)}>打开文档</button>
              </footer>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
