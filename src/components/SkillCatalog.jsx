import { useI18n } from '../i18n.jsx';

export default function SkillCatalog({ skills = [], onCopyPrompt }) {
  const { t } = useI18n();
  return (
    <>
      <div className="analysis-section-heading">
        <div>
          <h3>{t('skills.title')}</h3>
          <p>{t('skills.description')}</p>
        </div>
        <span className="analysis-source-count">{t('skills.builtIn', { count: skills.length })}</span>
      </div>

      <p className="analysis-integration-note">
        {t('skills.boundary')}
      </p>

      {!skills.length && <p className="analysis-empty">{t('skills.empty')}</p>}

      <div className="analysis-card-list">
        {skills.map((skill) => (
          <article className="analysis-skill-card" key={skill.id}>
            <div className="analysis-card-heading">
              <div>
                <strong>{skill.displayName}</strong>
                <code>{skill.skillPath}</code>
              </div>
              <span className="analysis-badge analysis-badge--ai">{t(`skills.stage.${skill.stage}`, {}, skill.stage)}</span>
            </div>
            <p>{skill.description}</p>
            <div className="analysis-meta-row">
              {(skill.outputs || []).map((output) => <span key={output}>{output}</span>)}
            </div>
            <footer className="analysis-card-actions">
              <button className="primary" type="button" onClick={() => onCopyPrompt?.(skill)}>{t('skills.copyPrompt')}</button>
            </footer>
          </article>
        ))}
      </div>
    </>
  );
}
