import { createContext, useContext } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import {
  NODE_MAX_HEIGHT,
  NODE_MAX_WIDTH,
  NODE_MIN_HEIGHT,
  NODE_MIN_WIDTH,
} from '../graph.js';
import { useI18n } from '../i18n.jsx';

export const CanvasEditContext = createContext({ editable: false, onResizeEnd: () => {} });

export default function ArchitectureNode({ id, data, selected }) {
  const { editable, onResizeEnd } = useContext(CanvasEditContext);
  const { t } = useI18n();
  const draftChanges = data.__draftChanges || [];
  const draftCategory = draftChanges[0]?.category;
  const classes = [
    'architecture-node',
    data.focus ? 'is-focus' : '',
    data.compareClass || '',
    selected ? 'is-selected' : '',
    data.__mutedByFocus ? 'is-muted-by-focus' : '',
    data.__relatedByFocus ? 'is-related-by-focus' : '',
    editable ? 'is-editable' : '',
    data.__draftAddition ? 'is-pending-addition' : '',
    data.__draftRemoval ? 'is-pending-removal' : '',
    draftChanges.length && !data.__draftAddition && !data.__draftRemoval ? 'is-pending-change' : '',
  ].filter(Boolean).join(' ');

  return (
    <article className={classes} aria-label={`${data.name}，${data.group}`}>
      <NodeResizer
        isVisible={selected && editable}
        minWidth={NODE_MIN_WIDTH}
        maxWidth={NODE_MAX_WIDTH}
        minHeight={NODE_MIN_HEIGHT}
        maxHeight={NODE_MAX_HEIGHT}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
        onResizeEnd={(_, params) => onResizeEnd(id, params)}
      />
      <Handle id="top" className="node-handle node-handle-top" type="source" position={Position.Top} isConnectable={editable} />
      <Handle id="right" className="node-handle node-handle-right" type="source" position={Position.Right} isConnectable={editable} />
      <Handle id="bottom" className="node-handle node-handle-bottom" type="source" position={Position.Bottom} isConnectable={editable} />
      <Handle id="left" className="node-handle node-handle-left" type="source" position={Position.Left} isConnectable={editable} />
      <div className="node-badges">
        {draftChanges.length > 0 && (
          <span className={`pending-node-badge is-${draftCategory || 'module-changed'}`}>
            {t(`pending.category.${draftCategory || 'module-changed'}`)} · {draftChanges.length}
          </span>
        )}
        {data.compareStatus && <span className="compare-badge">{t(`compare.${data.compareStatus}`, {}, data.compareStatus)}</span>}
        {data.horizon && <span className="horizon-badge">{data.horizon}</span>}
        {data.humanConfirmed && <span className="human-confirmed-badge" title={t('node.correctionNotPublication')}>{t('node.humanConfirmed')}</span>}
        {data.aiCollaboration && <span className="ai-collaboration-badge">AI · {data.aiCollaboration}</span>}
        {data.__hasChildDiagram && <span className="drilldown-badge">{t('node.drilldown')}</span>}
        {data.documentCount > 0 && (
          <span className={`document-badge ${data.documentWarningCount ? 'has-warning' : ''}`}>
            {t('node.documents', { count: data.documentCount })}{data.documentWarningCount ? ` · ${t('node.documentWarnings', { count: data.documentWarningCount })}` : ''}
          </span>
        )}
      </div>
      <h3>{data.name}</h3>
      <p className="node-group">{data.group}</p>
      {data.buildStrategy && <p className="node-build-strategy">{t('node.buildStrategy')}：{data.buildStrategy}</p>}
      <div className="node-chips" aria-label={t('node.statusAxes')}>
        <span>{data.technical}</span>
        <span className="product-chip">{data.product}</span>
        <span className="authorization-chip">{data.authorization}</span>
      </div>
    </article>
  );
}
