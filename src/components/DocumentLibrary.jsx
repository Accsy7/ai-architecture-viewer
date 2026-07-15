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
import { useI18n } from '../i18n.jsx';

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
  const { t } = useI18n();
  if (!diagnostics?.length) return null;
  const infoOnly = diagnostics.every((diagnostic) => diagnostic?.severity === 'info');
  return (
    <ul className={`document-diagnostics ${infoOnly ? 'info-only' : ''}`}>
      {diagnostics.map((diagnostic, index) => (
        <li key={`${diagnostic?.code || 'diagnostic'}-${index}`} className={`severity-${diagnostic?.severity || 'warning'}`}>
          {typeof diagnostic === 'object'
            ? t(`documents.diagnostic.${diagnostic?.code}`, {}, diagnosticMessage(diagnostic))
            : diagnosticMessage(diagnostic)}
          {diagnostic?.nodeId && (
            <small>（{t(diagnostic.view === 'target' ? 'documents.target' : 'documents.current')} · {diagnostic.nodeId}{diagnostic.scope ? ` · ${diagnostic.scope}` : ''}）</small>
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
  const { t } = useI18n();
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
            t(`documents.type.${document.type}`, {}, document.type),
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
            <p className="kicker">{t('documents.kicker')}</p>
            <h2 id="documents-title">{t('documents.title')}</h2>
            <p>{t(readOnly ? 'documents.readOnlyDescription' : 'documents.description')}</p>
          </div>
          <button className="quiet sheet-close" type="button" onClick={onClose} aria-label={t('documents.close')}>{t('common.close')}</button>
        </header>

        {bindingDiagnostics?.length > 0 && (
          <div className="sheet-notice warning">
            <strong>{t('documents.bindingWarnings', { count: bindingDiagnostics.length })}</strong>
            <Diagnostics diagnostics={bindingDiagnostics} />
          </div>
        )}

        <div className="document-toolbar">
          <label className="document-search">
            <span>{t('documents.search')}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('documents.searchPlaceholder')} />
          </label>
          {!readOnly && (
            <button className="primary" type="button" onClick={() => setShowRegister((value) => !value)}>
              {showRegister ? t('documents.hideRegister') : t('documents.register')}
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
            <h3>{t('documents.registerTitle')}</h3>
            <p>{t('documents.pathHelp')}</p>
            <div className="document-form-grid">
              <label className="field"><span>{t('documents.displayName')}</span><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
              <label className="field"><span>{t('documents.relativePath')}</span><input required value={form.path} placeholder="docs/example.md" onChange={(event) => setForm({ ...form, path: event.target.value })} /></label>
              <label className="field"><span>{t('documents.typeLabel')}</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{DOCUMENT_TYPES.map(([value, label]) => <option value={value} key={value}>{t(`documents.type.${value}`, {}, label)}</option>)}</select></label>
              <label className="field"><span>{t('documents.authorityLabel')}</span><select value={form.authority} onChange={(event) => setForm({ ...form, authority: event.target.value })}>{DOCUMENT_AUTHORITIES.map(([value, label]) => <option value={value} key={value}>{t(`documents.authority.${value}`, {}, label)}</option>)}</select></label>
              <label className="field"><span>{t('documents.statusLabel')}</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{DOCUMENT_STATUSES.slice(0, 2).map(([value, label]) => <option value={value} key={value}>{t(`documents.status.${value}`, {}, label)}</option>)}</select></label>
              <label className="field document-summary-field"><span>{t('documents.summary')}</span><textarea rows="3" required value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label>
            </div>
            <div className="dialog-actions"><button className="primary" type="submit" disabled={submitting}>{t(submitting ? 'documents.registering' : 'documents.confirmRegister')}</button></div>
          </form>
        )}

        <div className="document-list" aria-busy={loading}>
          {loading && <p className="sheet-empty">{t('documents.loading')}</p>}
          {!loading && !filtered.length && <p className="sheet-empty">{t('documents.empty')}</p>}
          {filtered.map((document) => (
            <article className="document-card" key={document.id}>
              <div className="document-card-heading">
                <div><strong>{document.title}</strong><code>{document.path}</code></div>
                <span className={`document-status status-${document.status}`}>{t(`documents.status.${document.status}`, {}, documentStatusLabel(document.status))}</span>
              </div>
              <div className="document-tags">
                <span>{t(`documents.type.${document.type}`, {}, documentTypeLabel(document.type))}</span>
                <span>{t(`documents.authority.${document.authority}`, {}, documentAuthorityLabel(document.authority))}</span>
              </div>
              <p>{document.summary}</p>
              <Diagnostics diagnostics={document.diagnostics} />
              <footer>
                <small>
                  {t('documents.referenceCounts', { active: document.referenceSummary?.activeCount || 0, historical: document.referenceSummary?.historicalCount || 0 })}
                </small>
                <button type="button" onClick={() => onPreview(document)}>{t('documents.open')}</button>
              </footer>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
