import { NodeResizeControl } from '@xyflow/react';
import { useI18n } from '../i18n.jsx';

export default function GroupRegionNode({ data, selected }) {
  const { t } = useI18n();
  return (
    <section
      className={`group-region${selected ? ' is-selected' : ''}`}
      style={{
        '--group-region-color': data.color || '#eef3ef',
        '--group-region-accent': data.accent || '#758a7d',
      }}
      aria-label={t('group.regionLabel', { name: data.label })}
    >
      {selected && data.__resizable && (
        <NodeResizeControl
          position="bottom-right"
          minWidth={data.__minWidth || 300}
          minHeight={data.__minHeight || 210}
          maxWidth={100000}
          maxHeight={100000}
          onResize={(_, geometry) => data.__onResize?.(data.__groupId, geometry)}
          onResizeEnd={(_, geometry) => data.__onResizeEnd?.(data.__groupId, geometry)}
          className="group-region__resize nodrag nopan"
        >
          <span aria-hidden="true" />
        </NodeResizeControl>
      )}
      <header className="group-region__drag-handle" title={t('group.dragTitle')}>
        <span>{data.level || 'L1'}</span>
        <h2>{data.label}</h2>
        {data.__resizable && <i aria-hidden="true">⠿</i>}
      </header>
      {data.description && <p>{data.description}</p>}
    </section>
  );
}
