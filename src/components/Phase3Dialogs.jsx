import { useEffect, useMemo, useState } from 'react';
import { diagnosticMessage } from '../document-model.js';
import { evaluateDraftContract, sensitiveDraftChanges } from '../development-contract-preview.mjs';
import { useI18n } from '../i18n.jsx';

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
  const { t } = useI18n();
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  if (!blocks.length) return <p className="sheet-empty">{t('preview.empty')}</p>;
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
  const { t } = useI18n();
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
            <p className="kicker">{t('preview.kicker')}</p>
            <h2 id="preview-title">{preview?.title || t('preview.reading')}</h2>
            {preview?.path && <code>{preview.path}</code>}
          </div>
          <button className="quiet" type="button" onClick={onClose}>{t('common.close')}</button>
        </header>
        {loading ? <p className="sheet-empty">{t('preview.explicitRead')}</p> : (
          <>
            {preview?.diagnostics?.length > 0 && (
              <ul className="document-diagnostics">
                {preview.diagnostics.map((item, index) => <li key={`${item?.code || 'preview'}-${index}`}>{t(`documents.diagnostic.${item?.code}`, {}, diagnosticMessage(item))}</li>)}
              </ul>
            )}
            <div className="viewer-mode-switch" role="tablist" aria-label={t('preview.modeAria')}>
              <button type="button" role="tab" aria-selected={mode === 'reading'} className={mode === 'reading' ? 'active' : ''} onClick={() => setMode('reading')}>{t('preview.readingMode')}</button>
              <button type="button" role="tab" aria-selected={mode === 'source'} className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}>{t('preview.sourceMode')}</button>
            </div>
            {mode === 'reading'
              ? <MarkdownDocument content={preview?.content} />
              : <pre className="document-preview-content">{preview?.content || t('preview.empty')}</pre>}
            <footer className="preview-footer">
              <span>{t('preview.bytes', { count: preview?.sizeBytes ?? 0 })}</span>
              {preview?.truncated && <strong>{t('preview.truncated')}</strong>}
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
  const { t } = useI18n();
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
      [t('correction.moduleName'), node.data?.name || '', form.name],
      [t('fields.group'), node.data?.group || '', form.group],
      [t('fields.purpose'), node.data?.purpose || '', form.purpose],
      [t('correction.productPosition'), node.data?.product || '', form.product],
      [t('fields.buildStrategy'), inferredBuildStrategy(node.data), form.buildStrategy],
    ].filter(([, before, after]) => String(before).trim() !== String(after).trim());
  }, [form, node, t]);

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
            <p className="kicker">{t('correction.kicker')}</p>
            <h2 id="correction-title">{t('correction.title', { name: node.data?.name || node.id })}</h2>
          </div>
          <button className="quiet" type="button" disabled={submitting} onClick={onCancel}>{t('common.close')}</button>
        </header>

        <div className="correction-grid">
          <div className="correction-fields">
            <label className="field"><span>{t('correction.moduleName')}</span><input value={form.name} onChange={(event) => setField('name', event.target.value)} /></label>
            <label className="field">
              <span>{t('fields.group')}</span>
              <select value={form.group} onChange={(event) => setField('group', event.target.value)}>
                {!groupOptions.includes(form.group) && <option value={form.group}>{form.group}</option>}
                {groupOptions.map((group) => <option value={group} key={group}>{group}</option>)}
              </select>
            </label>
            <label className="field"><span>{t('fields.purpose')}</span><textarea rows="5" value={form.purpose} onChange={(event) => setField('purpose', event.target.value)} /></label>
            <label className="field"><span>{t('correction.productLabel')}</span><textarea rows="3" value={form.product} onChange={(event) => setField('product', event.target.value)} /></label>
            <label className="field">
              <span>{t('fields.buildStrategy')}</span>
              <select value={form.buildStrategy} onChange={(event) => setField('buildStrategy', event.target.value)}>
                <option value="自建">{t('correction.strategy.selfBuilt')}</option>
                <option value="现有自建">{t('correction.strategy.existing')}</option>
                <option value="外部集成">{t('correction.strategy.external')}</option>
                <option value="待决定">{t('correction.strategy.pending')}</option>
              </select>
            </label>
            <label className="field correction-note">
              <span>{t('correction.reason')}</span>
              <textarea
                rows="4"
                value={form.confirmationNote}
                placeholder={t('correction.reasonPlaceholder')}
                onChange={(event) => setField('confirmationNote', event.target.value)}
              />
            </label>
          </div>

          <aside className="correction-review">
            <p className="kicker">{t('correction.reviewKicker')}</p>
            <h3>{t('correction.changeCount', { count: changes.length })}</h3>
            {!changes.length && <p>{t('correction.changeRequired')}</p>}
            {changes.map(([label, before, after]) => (
              <article key={label}>
                <strong>{label}</strong>
                <span className="before">{t('correction.before')}：{before || t('details.unspecified')}</span>
                <span className="after">{t('correction.after')}：{after || t('details.unspecified')}</span>
              </article>
            ))}
            <div className="correction-impact">
              <strong>{t('correction.impact')}</strong>
              <p>{t('correction.relationshipImpact', { count: relatedEdgeCount })}</p>
              <p>{t('correction.draftBoundary')}</p>
            </div>
          </aside>
        </div>

        <footer className="dialog-actions correction-actions">
          <button className="quiet" type="button" disabled={submitting} onClick={onCancel}>{t('common.cancel')}</button>
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
          }}>{t(submitting ? 'correction.saving' : 'correction.save')}</button>
        </footer>
      </section>
    </div>
  );
}

function visibleValue(value, emptyLabel) {
  if (value === null || value === undefined || value === '') return emptyLabel;
  if (Array.isArray(value)) return value.join(' · ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function PublishDraftDialog({
  diagramTitle,
  viewLabel,
  diff,
  draftGraph,
  developmentContract,
  changeProjection,
  onCancel,
  onConfirm,
  onRefreshDocuments,
}) {
  const { t, translateError } = useI18n();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshingDocuments, setRefreshingDocuments] = useState(false);
  const [publicationError, setPublicationError] = useState(null);
  const items = [
    [t('diff.structure'), diff?.structural || 0],
    [t('diff.semantic'), diff?.semantic || 0],
    [t('diff.layout'), diff?.layout || 0],
    [t('diff.documents'), diff?.document || 0],
    [t('diff.relationships'), diff?.relationship || 0],
  ];
  const criteria = Array.isArray(developmentContract?.acceptanceCriteria)
    ? developmentContract.acceptanceCriteria
    : [];
  const documents = Array.isArray(developmentContract?.documents) ? developmentContract.documents : [];
  const criterionChanges = (changeProjection?.items || []).filter((item) => item.targetType === 'criterion');
  const graphChanges = (changeProjection?.items || []).filter((item) => item.targetType !== 'criterion');
  const sensitiveChanges = sensitiveDraftChanges(graphChanges);
  const contractPreview = evaluateDraftContract(criteria, draftGraph);
  const hasExecutableCriteria = contractPreview.executable;
  return (
    <div className="phase3-backdrop top-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onCancel();
    }}>
      <section className="confirm-dialog publish-draft-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title">
        <p className="kicker">{t('publish.kicker')}</p>
        <h2 id="publish-title">{t('publish.title', { diagram: diagramTitle, view: viewLabel })}</h2>
        <p>{t('publish.description')}</p>
        <div className="publish-net-change-summary">
          <strong>{t('publish.netChanges')}</strong>
          <span>{t('publish.graphChanges', { count: changeProjection?.graphChangeCount || 0 })}</span>
          <span>{t('publish.criterionChanges', { count: changeProjection?.criterionChangeCount || 0 })}</span>
        </div>
        <div className="publish-diff-summary">{items.map(([label, value]) => <span key={label}>{label} {value}</span>)}</div>
        {graphChanges.length > 0 && (
          <details className="publish-graph-changes" open>
            <summary>{t('publish.structureChangeTitle', { count: graphChanges.length })}</summary>
            <ol>
              {graphChanges.map((item) => (
                <li key={item.id}>
                  <span className={`pending-kind is-${item.category}`}>{t(`proposal.kind.${item.kind}`)}</span>
                  <strong>{item.label}</strong>
                  <code>{item.targetType}:{item.targetId}</code>
                </li>
              ))}
            </ol>
          </details>
        )}
        {sensitiveChanges.length > 0 && (
          <section className="publish-sensitive-changes">
            <strong>{t('publish.sensitiveChanges')}</strong>
            <p>{t('publish.sensitiveChangesHelp')}</p>
            <ol>
              {sensitiveChanges.map(({ item, field, before, after }) => (
                <li key={`${item.id}:${field}`}>
                  <code>{item.targetType}:{item.targetId} · {t(`fields.${field}`)}</code>
                  <span>{visibleValue(before, t('common.none'))} → {visibleValue(after, t('common.none'))}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {developmentContract && (
          <section className={`publish-contract-preview ${hasExecutableCriteria ? '' : 'is-unbound'}`}>
            <div className="publish-contract-preview__heading">
              <strong>{t('publish.contractTitle')}</strong>
              <span>{hasExecutableCriteria ? t('publish.criteriaCount', { count: criteria.length }) : t('publish.notExecutable')}</span>
            </div>
            <p>
              {hasExecutableCriteria
                ? t('publish.contractDescription', { boundaries: developmentContract.boundaryRefs?.length || 0, documents: documents.length })
                : criteria.length ? t('publish.invalidReferencesDescription') : t('publish.unboundDescription')}
            </p>
            {contractPreview.missingReferences.length > 0 && (
              <div className="publish-contract-invalid-refs">
                <strong>{t('publish.invalidReferencesTitle')}</strong>
                {contractPreview.missingReferences.map((entry) => (
                  <p key={entry.criterionId}>
                    <code>{entry.criterionId}</code>
                    <span>{entry.missingTargetRefs.map((reference) => `${reference.targetType}:${reference.targetId}`).join(' · ')}</span>
                  </p>
                ))}
              </div>
            )}
            {criteria.length > 0 && (
              <ol className="publish-contract-list">
                {criteria.map((criterion) => (
                  <li key={criterion.id}>
                    <strong>{criterion.statement}</strong>
                    <code>{t('publish.criterionRefs', { id: criterion.id, count: criterion.targetRefs?.length || 0 })}</code>
                    <small>{(criterion.targetRefs || []).map((reference) => `${reference.targetType}:${reference.targetId}`).join(' · ') || t('common.none')}</small>
                  </li>
                ))}
              </ol>
            )}
            {criterionChanges.length > 0 && (
              <section className="publish-contract-changes">
                <strong>{t('publish.criterionChangeTitle')}</strong>
                <ol>
                  {criterionChanges.map((item) => (
                    <li key={item.id}>
                      <span className={`pending-kind is-${item.category}`}>{t(`pending.category.${item.category}`)}</span>
                      <code>{item.targetId}</code>
                      {item.before?.statement && <small>{t('pending.before')}：{item.before.statement}</small>}
                      {item.after?.statement && <small>{t('pending.after')}：{item.after.statement}</small>}
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {documents.length > 0 && (
              <div className="publish-contract-documents" aria-label={t('publish.boundDocuments')}>
                {documents.map((document) => (
                  <article key={document.id}>
                    <strong>{document.title}</strong>
                    <code>{document.id} · {document.path}</code>
                    <small>{t(`documents.status.${document.status}`, {}, document.status)} · {t(`documents.authority.${document.authority}`, {}, document.authority)}</small>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
        <p className="publish-entire-draft-note">{t('publish.entireDraftNote')}</p>
        {publicationError && (
          <div className="publish-error" role="alert">
            <strong>{translateError(publicationError)}</strong>
            {publicationError.code === 'DRAFT_BOUND_DOCUMENT_STALE' && onRefreshDocuments && (
              <>
                <small>{t('publish.documentRefreshHelp')}</small>
                <button className="quiet" type="button" disabled={refreshingDocuments} onClick={async () => {
                  setRefreshingDocuments(true);
                  try {
                    await onRefreshDocuments();
                  } catch (error) {
                    setPublicationError(error);
                  } finally {
                    setRefreshingDocuments(false);
                  }
                }}>{t(refreshingDocuments ? 'publish.refreshingDocuments' : 'publish.refreshDocuments')}</button>
              </>
            )}
          </div>
        )}
        <label className="field"><span>{t('publish.note')}</span><textarea rows="4" value={message} placeholder={t('publish.notePlaceholder')} onChange={(event) => setMessage(event.target.value)} /></label>
        <div className="dialog-actions">
          <button className="quiet" type="button" disabled={submitting} onClick={onCancel}>{t('publish.keepDraft')}</button>
          <button className="primary" type="button" disabled={!message.trim() || submitting} onClick={async () => {
            setSubmitting(true);
            setPublicationError(null);
            try {
              await onConfirm(message.trim());
            } catch (error) {
              setPublicationError(error);
            } finally {
              setSubmitting(false);
            }
          }}>{t(submitting ? 'publish.publishing' : 'publish.confirm')}</button>
        </div>
      </section>
    </div>
  );
}

export function RevisionRestoreDialog({ revision, onCancel, onConfirm }) {
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setMessage(''); }, [revision?.revisionId]);

  if (!revision) return null;
  return (
    <div className="phase3-backdrop top-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onCancel();
    }}>
      <section className="confirm-dialog restore-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title">
        <h2 id="restore-title">{t('restore.title')}</h2>
        <p>
          {t('restore.description', { revision: revision.revision })}
        </p>
        <label className="field restore-message">
          <span>{t('restore.note')}</span>
          <textarea
            rows="4"
            autoFocus
            required
            value={message}
            placeholder={t('restore.notePlaceholder')}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button className="quiet" type="button" disabled={submitting} onClick={onCancel}>{t('common.cancel')}</button>
          <button className="primary" type="button" disabled={!message.trim() || submitting} onClick={async () => {
            setSubmitting(true);
            try {
              await onConfirm(message.trim());
            } catch {
              // 父级保留对话框并显示后端返回的冲突或校验信息。
            } finally {
              setSubmitting(false);
            }
          }}>{t(submitting ? 'restore.creating' : 'restore.confirm')}</button>
        </div>
      </section>
    </div>
  );
}
