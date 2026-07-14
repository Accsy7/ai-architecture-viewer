import { createContext, useContext } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import {
  NODE_MAX_HEIGHT,
  NODE_MAX_WIDTH,
  NODE_MIN_HEIGHT,
  NODE_MIN_WIDTH,
} from '../graph.js';

export const CanvasEditContext = createContext({ editable: false, onResizeEnd: () => {} });

export default function ArchitectureNode({ id, data, selected }) {
  const { editable, onResizeEnd } = useContext(CanvasEditContext);
  const classes = [
    'architecture-node',
    data.focus ? 'is-focus' : '',
    data.compareClass || '',
    selected ? 'is-selected' : '',
    data.__mutedByFocus ? 'is-muted-by-focus' : '',
    data.__relatedByFocus ? 'is-related-by-focus' : '',
    editable ? 'is-editable' : '',
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
        {data.compareStatus && <span className="compare-badge">{data.compareStatus}</span>}
        {data.horizon && <span className="horizon-badge">{data.horizon}</span>}
        {data.humanConfirmed && <span className="human-confirmed-badge">人工已确认</span>}
        {data.aiCollaboration && <span className="ai-collaboration-badge">AI · {data.aiCollaboration}</span>}
        {data.__hasChildDiagram && <span className="drilldown-badge">可进入下钻架构</span>}
        {data.documentCount > 0 && (
          <span className={`document-badge ${data.documentWarningCount ? 'has-warning' : ''}`}>
            文档 {data.documentCount}{data.documentWarningCount ? ` · ${data.documentWarningCount} 项异常` : ''}
          </span>
        )}
      </div>
      <h3>{data.name}</h3>
      <p className="node-group">{data.group}</p>
      {data.buildStrategy && <p className="node-build-strategy">建设方式：{data.buildStrategy}</p>}
      <div className="node-chips" aria-label="三轴状态">
        <span>{data.technical}</span>
        <span className="product-chip">{data.product}</span>
        <span className="authorization-chip">{data.authorization}</span>
      </div>
    </article>
  );
}
