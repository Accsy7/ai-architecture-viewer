import { useMemo } from 'react';
import { useI18n } from '../i18n.jsx';

export default function BusinessFlowPanel({
  flow,
  originNodeName,
  selectedSourceNodeId,
  onSelectSourceNode,
  onExit,
}) {
  const { t } = useI18n();
  const selectedStep = flow.nodes.find((node) => node.sourceNodeId === selectedSourceNodeId)
    || flow.nodes[0]
    || null;
  const transitions = useMemo(() => (selectedStep ? flow.edges.filter((edge) => (
    edge.sourceNodeId === selectedStep.sourceNodeId || edge.targetNodeId === selectedStep.sourceNodeId
  )) : []), [flow.edges, selectedStep]);
  const nodeNames = useMemo(
    () => new Map(flow.nodes.map((node) => [node.sourceNodeId, node.name])),
    [flow.nodes],
  );

  return (
    <aside className="inspector business-flow-panel" aria-label={t('flow.aria')}>
      <div className="inspector-heading business-flow-heading">
        <span className="aside-mark" aria-hidden="true">↝</span>
        <div><p className="kicker">{t('flow.mode')}</p><h2>{flow.title}</h2></div>
      </div>
      <button className="business-flow-exit" type="button" onClick={onExit}>
        {t('flow.exit')}
      </button>
      <p className="business-flow-description">{flow.description}</p>
      <p className="business-flow-readonly">{t('flow.registeredOnly')}</p>
      <p className="business-flow-restore">{t('flow.restoreFocus', { name: originNodeName })}</p>

      <section className="business-flow-steps" aria-label={t('flow.steps')}>
        <h3>{t('flow.steps')} <span>{flow.nodes.length}</span></h3>
        <div className="business-flow-step-list">
          {flow.nodes.map((node) => (
            <button
              className={`business-flow-step ${node.sourceNodeId === selectedStep?.sourceNodeId ? 'is-active' : ''} ${node.sidebarOnly ? 'is-sidebar-only' : ''}`}
              type="button"
              key={node.sourceNodeId}
              onClick={() => onSelectSourceNode(node.sourceNodeId)}
            >
              <span className="business-flow-step-number">{node.step}</span>
              <span className="business-flow-step-copy">
                <strong>{node.name}</strong>
                <small>{node.sidebarOnly ? t('flow.sidebarOnly') : t('flow.canvasMapped')}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      {selectedStep && (
        <section className="business-flow-detail" aria-live="polite">
          <p className="kicker">{t('flow.step', { step: selectedStep.step })}</p>
          <h3>{selectedStep.name}</h3>
          <p>{selectedStep.purpose}</p>
          {selectedStep.sidebarOnly && <p className="business-flow-artifact-note">{t('flow.sidebarOnlyNote')}</p>}
          <h4>{t('flow.transitions')}</h4>
          {!transitions.length && <p className="inspector-placeholder">{t('flow.noTransitions')}</p>}
          <ul className="business-flow-transition-list">
            {transitions.map((edge) => {
              const outgoing = edge.sourceNodeId === selectedStep.sourceNodeId;
              const otherId = outgoing ? edge.targetNodeId : edge.sourceNodeId;
              return (
                <li key={edge.sourceEdgeId}>
                  <span>{outgoing ? '→' : '←'} {nodeNames.get(otherId) || otherId}</span>
                  <small>{edge.label}</small>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}
