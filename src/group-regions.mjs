export const REGION_NODE_PREFIX = 'group-region-';
export const REGION_MIN_WIDTH = 300;
export const REGION_MIN_HEIGHT = 210;
export const REGION_CARD_PADDING = 28;
export const REGION_HEADER_CLEARANCE = 92;

export const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const nodeWidth = (node) => finiteNumber(
  node?.measured?.width,
  finiteNumber(node?.width, finiteNumber(node?.style?.width, 260)),
);

const nodeHeight = (node) => finiteNumber(
  node?.measured?.height,
  finiteNumber(node?.height, finiteNumber(node?.style?.height, 150)),
);

export const regionNodeId = (groupId) => `${REGION_NODE_PREFIX}${groupId}`;

export function groupGeometry(group, layout, preview = {}) {
  const stored = preview[group.id] || layout?.containers?.[group.id] || {};
  return {
    x: finiteNumber(stored.x, finiteNumber(group.position?.x, 0)),
    y: finiteNumber(stored.y, finiteNumber(group.position?.y, 0)),
    width: Math.max(REGION_MIN_WIDTH, finiteNumber(stored.width, finiteNumber(group.width, 340))),
    height: Math.max(REGION_MIN_HEIGHT, finiteNumber(stored.height, finiteNumber(group.height, 520))),
  };
}

export function expandGeometryToContainNode(geometry, node) {
  const left = finiteNumber(node.position?.x);
  const top = finiteNumber(node.position?.y);
  const right = left + nodeWidth(node);
  const bottom = top + nodeHeight(node);
  const nextLeft = Math.min(geometry.x, left - REGION_CARD_PADDING);
  const nextTop = Math.min(geometry.y, top - REGION_HEADER_CLEARANCE);
  const nextRight = Math.max(geometry.x + geometry.width, right + REGION_CARD_PADDING);
  const nextBottom = Math.max(geometry.y + geometry.height, bottom + REGION_CARD_PADDING);
  return {
    x: nextLeft,
    y: nextTop,
    width: Math.max(REGION_MIN_WIDTH, nextRight - nextLeft),
    height: Math.max(REGION_MIN_HEIGHT, nextBottom - nextTop),
  };
}

export function sameGeometry(left, right) {
  return ['x', 'y', 'width', 'height'].every((key) => (
    Math.abs(finiteNumber(left?.[key]) - finiteNumber(right?.[key])) < 0.01
  ));
}

export function buildGroupRegionNodes({
  groups = [],
  semanticNodes = [],
  layout = {},
  preview = {},
  selectedRegionId = null,
  draggable = false,
  fallbackLabel = (index) => `Group ${index + 1}`,
  onResize = null,
  onResizeEnd = null,
} = {}) {
  return groups.flatMap((group, index) => {
    const childNodes = semanticNodes.filter((node) => node.data?.group === group.group);
    if (!childNodes.length) return [];
    const geometry = groupGeometry(group, layout, preview);
    const minimumRight = Math.max(...childNodes.map((node) => (
      finiteNumber(node.position?.x) + nodeWidth(node) + REGION_CARD_PADDING
    )));
    const minimumBottom = Math.max(...childNodes.map((node) => (
      finiteNumber(node.position?.y) + nodeHeight(node) + REGION_CARD_PADDING
    )));
    const minWidth = Math.max(REGION_MIN_WIDTH, minimumRight - geometry.x);
    const minHeight = Math.max(REGION_MIN_HEIGHT, minimumBottom - geometry.y);
    const id = regionNodeId(group.id || String(index));
    return [{
      id,
      type: 'groupRegion',
      position: { x: geometry.x, y: geometry.y },
      width: geometry.width,
      height: geometry.height,
      style: { width: geometry.width, height: geometry.height },
      selected: selectedRegionId === id,
      dragHandle: '.group-region__drag-handle',
      data: {
        label: group.label || group.group || fallbackLabel(index),
        description: group.description || '',
        color: group.color,
        accent: group.accent,
        level: group.level || 'L1',
        __groupId: group.id,
        __group: group.group,
        __resizable: draggable,
        __minWidth: minWidth,
        __minHeight: minHeight,
        __onResize: onResize,
        __onResizeEnd: onResizeEnd,
      },
      draggable,
      selectable: true,
      connectable: false,
      deletable: false,
      focusable: true,
      zIndex: -1,
    }];
  });
}
