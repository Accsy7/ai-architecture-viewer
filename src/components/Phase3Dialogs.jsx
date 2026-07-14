import { useEffect, useMemo, useState } from 'react';
import { diagnosticMessage } from '../document-model.js';

function renderInline(text) {
  return String(text || '').split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (token.startsWith('`') && token.endsWith('`')) return <code key={index}>{token.slice(1, -1)}</code>;
    return <span key={index}>{token}</span>;
  });
}

function parseMarkdown(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^```\s*([^\s]*)/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language: fence[1], text: code.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*+]\s+/, ''));
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+[.)]\s+/, ''));
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', text: quote.join(' ') });
      continue;
    }

    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim()
      && !/^(#{1,6})\s+/.test(lines[index])
      && !/^```/.test(lines[index])
      && !/^\s*[-*+]\s+/.test(lines[index])
      && !/^\s*\d+[.)]\s+/.test(lines[index])
      && !/^>\s?/.test(lines[index])) {
      paragraph.push(lines[index++].trim());
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}

function MarkdownDocument({ content }) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  if (!blocks.length) return <p className="sheet-empty">文档没有可查看的文字。</p>;
  return (
    <article className="markdown-document">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Heading = `h${block.level}`;
          return <Heading key={index}>{renderInline(block.text)}</Heading>;
        }
        if (block.type === 'code') return <pre key={index}><code>{block.text}</code></pre>;
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</List>;
        }
        if (block.type === 'quote') return <blockquote key={index}>{renderInline(block.text)}</blockquote>;
        if (block.type === 'rule') return <hr key={index} />;
        return <p key={index}>{renderInline(block.text)}</p>;
      })}
    </article>
  );
}

export function DocumentPreviewDialog({ preview, loading, onClose }) {
  const [mode, setMode] = useState('reading');
  useEffect(() => { setMode('reading'); }, [preview?.path]);
  if (!preview && !loading) return null;
  return (
    <div className="phase3-backdrop top-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title">
        <header className="sheet-heading">
          <div>
            <p className="kicker">内置文档查看器</p>
            <h2 id="preview-title">{preview?.title || '正在读取文档…'}</h2>
            {preview?.path && <code>{preview.path}</code>}
          </div>
          <button className="quiet" type="button" onClick={onClose}>关闭</button>
        </header>
        {loading ? <p className="sheet-empty">仅在你明确点击后读取这个文件…</p> : (
          <>
            {preview?.diagnostics?.length > 0 && (
              <ul className="document-diagnostics">
                {preview.diagnostics.map((item, index) => <li key={`${item?.code || 'preview'}-${index}`}>{diagnosticMessage(item)}</li>)}
              </ul>
            )}
            <div className="viewer-mode-switch" role="tablist" aria-label="文档查看模式">
              <button type="button" role="tab" aria-selected={mode === 'reading'} className={mode === 'reading' ? 'active' : ''} onClick={() => setMode('reading')}>阅读视图</button>
              <button type="button" role="tab" aria-selected={mode === 'source'} className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}>纯文本</button>
            </div>
            {mode === 'reading'
              ? <MarkdownDocument content={preview?.content} />
              : <pre className="document-preview-content">{preview?.content || '文档没有可查看的文字。'}</pre>}
            <footer className="preview-footer">
              <span>{preview?.sizeBytes ?? 0} 字节</span>
              {preview?.truncated && <strong>内容较长，此处只显示安全截断的片段。</strong>}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

const inferredBuildStrategy = (data = {}) => {
  if (data.buildStrategy) return data.buildStrategy;
  if (String(data.product || '').includes('外部')) return '外部集成';
  if (String(data.product || '').includes('现有')) return '现有自建';
  return '自建';
};

export function ArchitectureCorrectionDialog({
  node,
  groupOptions = [],
  relatedEdgeCount = 0,
  onCancel,
  onConfirm,
}) {
  const [form, setForm] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!node) {
      setForm(null);
      return;
    }
    setForm({
      name: node.data?.name || '',
      group: node.data?.group || '',
      purpose: node.data?.purpose || '',
      product: node.data?.product || '',
      buildStrategy: inferredBuildStrategy(node.data),
      confirmationNote: '',
    });
  }, [node]);

  const changes = useMemo(() => {
    if (!node || !form) return [];
    return [
      ['模块名称', node.data?.name || '', form.name],
      ['所属分组', node.data?.group || '', form.group],
      ['主要作用', node.data?.purpose || '', form.purpose],
      ['产品定位', node.data?.product || '', form.product],
      ['建设方式', inferredBuildStrategy(node.data), form.buildStrategy],
    ].filter(([, before, after]) => String(before).trim() !== String(after).trim());
  }, [form, node]);

  if (!node || !form) return null;
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const canSubmit = form.name.trim()
    && form.group.trim()
    && form.purpose.trim()
    && form.product.trim()
    && form.confirmationNote.trim()
    && changes.length > 0;

  return (
    <div className="phase3-backdrop top-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onCancel();
    }}>
      <section className="architecture-correction-dialog" role="dialog" aria-modal="true" aria-labelledby="correction-title">
        <header className="sheet-heading">
          <div>
            <p className="kicker">人工纠正 AI 理解</p>
            <h2 id="correction-title">修订“{node.data?.name || node.id}”</h2>
          </div>
          <button className="quiet" type="button" disabled={submitting} onClick={onCancel}>关闭</button>
        </header>

        <div className="correction-grid">
          <div className="correction-fields">
            <label className="field"><span>模块名称</span><input value={form.name} onChange={(event) => setField('name', event.target.value)} /></label>
            <label className="field">
              <span>所属分组</span>
              <select value={form.group} onChange={(event) => setField('group', event.target.value)}>
                {!groupOptions.includes(form.group) && <option value={form.group}>{form.group}</option>}
                {groupOptions.map((group) => <option value={group} key={group}>{group}</option>)}
              </select>
            </label>
            <label className="field"><span>主要作用</span><textarea rows="5" value={form.purpose} onChange={(event) => setField('purpose', event.target.value)} /></label>
            <label className="field"><span>产品定位 / 当前口径</span><textarea rows="3" value={form.product} onChange={(event) => setField('product', event.target.value)} /></label>
            <label className="field">
              <span>建设方式</span>
              <select value={form.buildStrategy} onChange={(event) => setField('buildStrategy', event.target.value)}>
                <option value="自建">自建</option>
                <option value="现有自建">现有自建</option>
                <option value="外部集成">外部集成</option>
                <option value="待决定">待决定</option>
              </select>
            </label>
            <label className="field correction-note">
              <span>为什么需要纠正（必填）</span>
              <textarea
                rows="4"
                value={form.confirmationNote}
                placeholder="用自然语言说明 AI 原先理解错在哪里，以及正确理解是什么"
                onChange={(event) => setField('confirmationNote', event.target.value)}
              />
            </label>
          </div>

          <aside className="correction-review">
            <p className="kicker">提交前核对</p>
            <h3>本次会改变 {changes.length} 个字段</h3>
            {!changes.length && <p>请先修改至少一个字段。</p>}
            {changes.map(([label, before, after]) => (
              <article key={label}>
                <strong>{label}</strong>
                <span className="before">原理解：{before || '未说明'}</span>
                <span className="after">你的纠正：{after || '未说明'}</span>
              </article>
            ))}
            <div className="correction-impact">
              <strong>影响范围</strong>
              <p>该模块现有 {relatedEdgeCount} 条关系。关系不会自动改写；如需调整关系，请继续用自然语言告诉 AI。</p>
              <p>确认后只写入草案，并标记为“人工已确认”。正式架构必须再经过发布确认。</p>
            </div>
          </aside>
        </div>

        <footer className="dialog-actions correction-actions">
          <button className="quiet" type="button" disabled={submitting} onClick={onCancel}>取消</button>
          <button className="primary" type="button" disabled={!canSubmit || submitting} onClick={async () => {
            setSubmitting(true);
            try {
              await onConfirm({
                name: form.name.trim(),
                group: form.group.trim(),
                purpose: form.purpose.trim(),
                product: form.product.trim(),
                buildStrategy: form.buildStrategy,
                humanConfirmed: true,
                confirmationNote: form.confirmationNote.trim(),
                confirmedAt: new Date().toISOString(),
              });
            } catch {
              // 父级保留对话框并通过页面状态提示冲突或校验结果。
            } finally {
              setSubmitting(false);
            }
          }}>{submitting ? '正在写入草案…' : '确认并写入草案'}</button>
        </footer>
      </section>
    </div>
  );
}

export function PublishDraftDialog({ diagramTitle, viewLabel, diff, onCancel, onConfirm }) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const items = [
    ['结构', diff?.structural || 0],
    ['说明', diff?.semantic || 0],
    ['布局', diff?.layout || 0],
    ['文档', diff?.document || 0],
    ['关系', diff?.relationship || 0],
  ];
  return (
    <div className="phase3-backdrop top-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onCancel();
    }}>
      <section className="confirm-dialog publish-draft-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title">
        <p className="kicker">发布前最终确认</p>
        <h2 id="publish-title">发布{diagramTitle}的{viewLabel}修订</h2>
        <p>这会把当前完整草案变成新的正式版本，不只是发布最后一次字段修改。旧版本会完整保留。</p>
        <div className="publish-diff-summary">{items.map(([label, value]) => <span key={label}>{label} {value}</span>)}</div>
        <label className="field"><span>本次修订说明（必填）</span><textarea rows="4" value={message} placeholder="说明本次确认了哪些结构、边界或产品判断" onChange={(event) => setMessage(event.target.value)} /></label>
        <div className="dialog-actions">
          <button className="quiet" type="button" disabled={submitting} onClick={onCancel}>继续保留草案</button>
          <button className="primary" type="button" disabled={!message.trim() || submitting} onClick={async () => {
            setSubmitting(true);
            try {
              await onConfirm(message.trim());
            } catch {
              // 父级保留对话框并通过页面状态提示冲突或校验结果。
            } finally {
              setSubmitting(false);
            }
          }}>{submitting ? '正在发布…' : '确认发布为正式版本'}</button>
        </div>
      </section>
    </div>
  );
}

export function RevisionRestoreDialog({ revision, onCancel, onConfirm }) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setMessage(''); }, [revision?.revisionId]);

  if (!revision) return null;
  return (
    <div className="phase3-backdrop top-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onCancel();
    }}>
      <section className="confirm-dialog restore-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title">
        <h2 id="restore-title">以此版本创建新修订</h2>
        <p>
          将 R{revision.revision} 的完整架构作为新的正式版本发布。当前正式版与全部历史记录都会保留。
        </p>
        <label className="field restore-message">
          <span>修订说明（必填）</span>
          <textarea
            rows="4"
            autoFocus
            required
            value={message}
            placeholder="说明为什么需要恢复这个版本，以及本次修订要解决什么问题"
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button className="quiet" type="button" disabled={submitting} onClick={onCancel}>取消</button>
          <button className="primary" type="button" disabled={!message.trim() || submitting} onClick={async () => {
            setSubmitting(true);
            try {
              await onConfirm(message.trim());
            } catch {
              // 父级保留对话框并显示后端返回的冲突或校验信息。
            } finally {
              setSubmitting(false);
            }
          }}>{submitting ? '正在创建…' : '确认创建新修订'}</button>
        </div>
      </section>
    </div>
  );
}
