import { useMemo } from 'react';
import { BaseEdge, EdgeLabelRenderer, useReactFlow } from '@xyflow/react';
import { buildOrthogonalRoute, normalizeRoutingData, obstacleBounds } from '../routing.mjs';

const BUNDLE_DISTANCE = 54;

function bundledWaypoints(source, target, sourcePort, targetPort, data) {
  const sourceBundled = Number(data.__sourceBundleCount) > 1;
  const targetBundled = Number(data.__targetBundleCount) > 1;
  if (!sourceBundled && !targetBundled) return [];
  const points = [];
  if (sourceBundled) {
    if (sourcePort === 'left') points.push({ x: source.x - BUNDLE_DISTANCE, y: source.y });
    if (sourcePort === 'right') points.push({ x: source.x + BUNDLE_DISTANCE, y: source.y });
    if (sourcePort === 'top') points.push({ x: source.x, y: source.y - BUNDLE_DISTANCE });
    if (sourcePort === 'bottom') points.push({ x: source.x, y: source.y + BUNDLE_DISTANCE });
  }
  if (targetBundled) {
    if (targetPort === 'left' || targetPort === 'right') {
      const x = target.x + (targetPort === 'left' ? -BUNDLE_DISTANCE : BUNDLE_DISTANCE);
      points.push({ x, y: source.y }, { x, y: target.y });
    } else {
      const y = target.y + (targetPort === 'top' ? -BUNDLE_DISTANCE : BUNDLE_DISTANCE);
      points.push({ x: source.x, y }, { x: target.x, y });
    }
  }
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

export default function SmartArchitectureEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data = {},
  label,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  markerEnd,
  style,
  selected,
}) {
  const { screenToFlowPosition } = useReactFlow();
  const routing = normalizeRoutingData(data);
  const sourcePort = data.__sourcePort || routing.sourcePort || 'right';
  const targetPort = data.__targetPort || routing.targetPort || 'left';
  const autoWaypoints = bundledWaypoints(
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
    sourcePort,
    targetPort,
    data,
  );
  const route = useMemo(() => buildOrthogonalRoute({
    source: { x: sourceX, y: sourceY },
    target: { x: targetX, y: targetY },
    sourcePort,
    targetPort,
    waypoints: routing.routingMode === 'manual' ? (routing.waypoints || []) : autoWaypoints,
    obstacles: obstacleBounds(data.__nodes || [], [source, target]),
    labelFraction: Number(data.__targetBundleCount) > 1 ? 0.3 : Number(data.__sourceBundleCount) > 1 ? 0.4 : 0.5,
  }), [autoWaypoints, data, routing.routingMode, routing.sourcePort, routing.targetPort, source, sourcePort, sourceX, sourceY, target, targetPort, targetX, targetY]);

  const startWaypointDrag = (event, index) => {
    if (!data.__editable || typeof data.__onWaypointMove !== 'function') return;
    event.preventDefault();
    event.stopPropagation();
    const move = (moveEvent) => {
      const position = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      data.__onWaypointMove(id, index, position);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };

  return (
    <>
      <BaseEdge
        path={route.path}
        markerEnd={markerEnd}
        style={style}
        label={label}
        labelX={route.labelX}
        labelY={route.labelY}
        labelStyle={labelStyle}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
        interactionWidth={28}
      />
      {selected && data.__editable && routing.routingMode === 'manual' && (routing.waypoints || []).length > 0 && (
        <EdgeLabelRenderer>
          {(routing.waypoints || []).map((waypoint, index) => (
            <button
              className="edge-waypoint nodrag nopan"
              style={{ transform: `translate(-50%, -50%) translate(${waypoint.x}px, ${waypoint.y}px)` }}
              type="button"
              aria-label={`路径转折点 ${index + 1}`}
              title="拖动调整；双击删除"
              key={`${id}-waypoint-${index}`}
              onPointerDown={(event) => startWaypointDrag(event, index)}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                data.__onWaypointRemove?.(id, index);
              }}
            >{index + 1}</button>
          ))}
        </EdgeLabelRenderer>
      )}
    </>
  );
}
