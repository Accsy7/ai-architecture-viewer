const STAGE_LABELS = {
  understand: '理解项目',
  plan: '规划变更',
  verify: '核验实施',
};

export default function SkillCatalog({ skills = [], onCopyPrompt }) {
  return (
    <>
      <div className="analysis-section-heading">
        <div>
          <h3>AI Coding 协作 Skill</h3>
          <p>让不同 Coding AI 使用同一套项目理解、架构规划和实施核验协议。</p>
        </div>
        <span className="analysis-source-count">内置 {skills.length}</span>
      </div>

      <p className="analysis-provider-note">
        Skill 只生成候选架构与实施报告，不会自动接受提案或发布正式版本。复制提示后，将它交给拥有当前代码仓库访问权限的 Coding AI。
      </p>

      {!skills.length && <p className="analysis-empty">暂时没有可用的协作 Skill。</p>}

      <div className="analysis-card-list">
        {skills.map((skill) => (
          <article className="analysis-skill-card" key={skill.id}>
            <div className="analysis-card-heading">
              <div>
                <strong>{skill.displayName}</strong>
                <code>{skill.skillPath}</code>
              </div>
              <span className="analysis-badge analysis-badge--ai">{STAGE_LABELS[skill.stage] || skill.stage}</span>
            </div>
            <p>{skill.description}</p>
            <div className="analysis-meta-row">
              {(skill.outputs || []).map((output) => <span key={output}>{output}</span>)}
            </div>
            <footer className="analysis-card-actions">
              <button className="primary" type="button" onClick={() => onCopyPrompt?.(skill)}>复制调用提示</button>
            </footer>
          </article>
        ))}
      </div>
    </>
  );
}
