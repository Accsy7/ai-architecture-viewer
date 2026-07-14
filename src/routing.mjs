export const ROUTING_PORTS = Object.freeze(['top', 'right', 'bottom', 'left']);

const PORT_SET = new Set(ROUTING_PORTS);
const PORT_VECTOR = Object.freeze({
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
});
const AUTO_PORT_PAIRS = Object.freeze([
  ['right', 'left'],
  ['left', 'right'],
  ['bottom', 'top'],
  ['top', 'bottom'],
]);
const EPSILON = 0.01;
const PORT_STUB = 24;
const OBSTACLE_PADDING = 18;
const BEND_PENALTY = 38;
const OBSTACLE_PENALTY = 100000;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rounded = (value) => Math.round(finite(value) * 100) / 100;
const samePoint = (left, right) => Math.abs(left.x - right.x) < EPSILON && Math.abs(left.y - right.y) < EPSILON;
const distance = (left, right) => Math.abs(left.x - right.x) + Math.abs(left.y - right.y);

function dimension(node, key, fallback) {
  const measured = node?.measured?.[key];
  const styled = Number.parseFloat(node?.style?.[key]);
  return finite(measured, finite(styled, finite(node?.[key], fallback)));
}

export function nodeBounds(node) {
  const left = finite(node?.position?.x, 0);
  const top = finite(node?.position?.y, 0);
  const width = dimension(node, 'width', 260);
  const height = dimension(node, 'height', 150);
  return {
    id: node?.id,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    center: { x: left + width / 2, y: top + height / 2 },
  };
}

export function portPoint(node, port) {
  const bounds = nodeBounds(node);
  if (port === 'top') return { x: bounds.center.x, y: bounds.top };
  if (port === 'bottom') return { x: bounds.center.x, y: bounds.bottom };
  if (port === 'left') return { x: bounds.left, y: bounds.center.y };
  return { x: bounds.right, y: bounds.center.y };
}

export function normalizeRoutingData(data = {}) {
  if (data.routingMode !== 'manual') return { routingMode: 'auto' };
  const sourcePort = PORT_SET.has(data.sourcePort) ? data.sourcePort : 'right';
  const targetPort = PORT_SET.has(data.targetPort) ? data.targetPort : 'left';
  const waypoints = Array.isArray(data.waypoints)
    ? data.waypoints
      .filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
      .slice(0, 24)
      .map((point) => ({ x: rounded(point.x), y: rounded(point.y) }))
    : [];
  return {
    routingMode: 'manual',
    sourcePort,
    targetPort,
    ...(waypoints.length ? { waypoints } : {}),
  };
}

export function obstacleBounds(nodes, excludedIds = [], padding = OBSTACLE_PADDING) {
  const excluded = excludedIds instanceof Set ? excludedIds : new Set(excludedIds);
  return (nodes || [])
    .filter((node) => !excluded.has(node.id))
    .map((node) => {
      const bounds = nodeBounds(node);
      return {
        id: bounds.id,
        left: bounds.left - padding,
        top: bounds.top - padding,
        right: bounds.right + padding,
        bottom: bounds.bottom + padding,
      };
    });
}

function normalizePoints(points) {
  const deduplicated = [];
  for (const point of points) {
    const normalized = { x: rounded(point.x), y: rounded(point.y) };
    if (!deduplicated.length || !samePoint(deduplicated[deduplicated.length - 1], normalized)) {
      deduplicated.push(normalized);
    }
  }
  if (deduplicated.length < 3) return deduplicated;
  const result = [deduplicated[0]];
  for (let index = 1; index < deduplicated.length - 1; index += 1) {
    const previous = result[result.length - 1];
    const current = deduplicated[index];
    const next = deduplicated[index + 1];
    const collinear = (Math.abs(previous.x - current.x) < EPSILON && Math.abs(current.x - next.x) < EPSILON)
      || (Math.abs(previous.y - current.y) < EPSILON && Math.abs(current.y - next.y) < EPSILON);
    if (!collinear) result.push(current);
  }
  result.push(deduplicated[deduplicated.length - 1]);
  return result;
}

function segmentIntersectsRect(start, end, rect) {
  if (Math.abs(start.y - end.y) < EPSILON) {
    const y = start.y;
    if (y <= rect.top + EPSILON || y >= rect.bottom - EPSILON) return false;
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    return Math.max(left, rect.left) < Math.min(right, rect.right) - EPSILON;
  }
  if (Math.abs(start.x - end.x) < EPSILON) {
    const x = start.x;
    if (x <= rect.left + EPSILON || x >= rect.right - EPSILON) return false;
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    return Math.max(top, rect.top) < Math.min(bottom, rect.bottom) - EPSILON;
  }
  return true;
}

function countObstacleHits(points, obstacles) {
  let hits = 0;
  for (let index = 1; index < points.length; index += 1) {
    for (const obstacle of obstacles) {
      if (segmentIntersectsRect(points[index - 1], points[index], obstacle)) hits += 1;
    }
  }
  return hits;
}

function routeScore(points, obstacles) {
  const length = points.slice(1).reduce((total, point, index) => total + distance(points[index], point), 0);
  const bends = Math.max(0, points.length - 2);
  const obstacleHits = countObstacleHits(points, obstacles);
  return { score: length + bends * BEND_PENALTY + obstacleHits * OBSTACLE_PENALTY, length, bends, obstacleHits };
}

function nearestCorridors(values, midpoint, limit = 12) {
  return [...new Set(values.map(rounded))]
    .sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint))
    .slice(0, limit);
}

function routeBetween(start, end, obstacles) {
  const candidates = [];
  const add = (points) => candidates.push(normalizePoints(points));
  if (Math.abs(start.x - end.x) < EPSILON || Math.abs(start.y - end.y) < EPSILON) add([start, end]);
  add([start, { x: end.x, y: start.y }, end]);
  add([start, { x: start.x, y: end.y }, end]);

  const xMidpoint = (start.x + end.x) / 2;
  const yMidpoint = (start.y + end.y) / 2;
  const xCorridors = nearestCorridors([
    xMidpoint,
    start.x,
    end.x,
    ...obstacles.flatMap((rect) => [rect.left - 1, rect.right + 1]),
  ], xMidpoint);
  const yCorridors = nearestCorridors([
    yMidpoint,
    start.y,
    end.y,
    ...obstacles.flatMap((rect) => [rect.top - 1, rect.bottom + 1]),
  ], yMidpoint);

  xCorridors.forEach((x) => add([start, { x, y: start.y }, { x, y: end.y }, end]));
  yCorridors.forEach((y) => add([start, { x: start.x, y }, { x: end.x, y }, end]));

  xCorridors.forEach((x) => yCorridors.forEach((y) => {
    add([start, { x, y: start.y }, { x, y }, { x: end.x, y }, end]);
    add([start, { x: start.x, y }, { x, y }, { x, y: end.y }, end]);
  }));

  let best = null;
  for (const points of candidates) {
    const metrics = routeScore(points, obstacles);
    if (!best || metrics.score < best.score) best = { points, ...metrics };
  }
  return best || { points: normalizePoints([start, { x: end.x, y: start.y }, end]), score: 0, length: 0, bends: 1, obstacleHits: 0 };
}

function pointAlongSegment(from, to, amount) {
  const length = distance(from, to);
  if (!length) return { ...from };
  return {
    x: from.x + ((to.x - from.x) / length) * amount,
    y: from.y + ((to.y - from.y) / length) * amount,
  };
}

function roundedPath(points, radius = 7) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const parts = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incoming = Math.min(radius, distance(previous, current) / 2);
    const outgoing = Math.min(radius, distance(current, next) / 2);
    const before = pointAlongSegment(current, previous, incoming);
    const after = pointAlongSegment(current, next, outgoing);
    parts.push(`L ${rounded(before.x)} ${rounded(before.y)}`);
    parts.push(`Q ${current.x} ${current.y} ${rounded(after.x)} ${rounded(after.y)}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${last.x} ${last.y}`);
  return parts.join(' ');
}

function pointOnPathAtFraction(points, fraction = 0.5) {
  const total = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
  if (!total) return points[0] || { x: 0, y: 0 };
  let remaining = total * Math.max(0, Math.min(1, finite(fraction, 0.5)));
  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = distance(points[index - 1], points[index]);
    if (remaining <= segmentLength) return pointAlongSegment(points[index - 1], points[index], remaining);
    remaining -= segmentLength;
  }
  return points[points.length - 1];
}

export function buildOrthogonalRoute({
  source,
  target,
  sourcePort = 'right',
  targetPort = 'left',
  waypoints = [],
  obstacles = [],
  labelFraction = 0.5,
}) {
  const sourceVector = PORT_VECTOR[sourcePort] || PORT_VECTOR.right;
  const targetVector = PORT_VECTOR[targetPort] || PORT_VECTOR.left;
  const sourceStub = { x: source.x + sourceVector.x * PORT_STUB, y: source.y + sourceVector.y * PORT_STUB };
  const targetStub = { x: target.x + targetVector.x * PORT_STUB, y: target.y + targetVector.y * PORT_STUB };
  const checkpoints = [
    sourceStub,
    ...(Array.isArray(waypoints) ? waypoints.map((point) => ({ x: finite(point.x), y: finite(point.y) })) : []),
    targetStub,
  ];
  const core = [checkpoints[0]];
  let score = 0;
  let obstacleHits = 0;
  for (let index = 1; index < checkpoints.length; index += 1) {
    const segment = routeBetween(checkpoints[index - 1], checkpoints[index], obstacles);
    core.push(...segment.points.slice(1));
    score += segment.score;
    obstacleHits += segment.obstacleHits;
  }
  const points = normalizePoints([source, ...core, target]);
  const label = pointOnPathAtFraction(points, labelFraction);
  return {
    points,
    path: roundedPath(points),
    labelX: rounded(label.x),
    labelY: rounded(label.y),
    score,
    obstacleHits,
  };
}

function facingPenalty(sourceBounds, targetBounds, sourcePort, targetPort) {
  const direction = {
    x: targetBounds.center.x - sourceBounds.center.x,
    y: targetBounds.center.y - sourceBounds.center.y,
  };
  const sourceVector = PORT_VECTOR[sourcePort];
  const targetVector = PORT_VECTOR[targetPort];
  const sourceDot = sourceVector.x * direction.x + sourceVector.y * direction.y;
  const targetDot = targetVector.x * -direction.x + targetVector.y * -direction.y;
  return (sourceDot < 0 ? 1200 + Math.abs(sourceDot) : 0)
    + (targetDot < 0 ? 1200 + Math.abs(targetDot) : 0);
}

export function resolveEdgePorts(nodes, edge) {
  const routing = normalizeRoutingData(edge?.data);
  if (routing.routingMode === 'manual') {
    return { sourcePort: routing.sourcePort, targetPort: routing.targetPort, routingMode: 'manual' };
  }
  const sourceNode = (nodes || []).find((node) => node.id === edge?.source);
  const targetNode = (nodes || []).find((node) => node.id === edge?.target);
  if (!sourceNode || !targetNode) return { sourcePort: 'right', targetPort: 'left', routingMode: 'auto' };
  const sourceBounds = nodeBounds(sourceNode);
  const targetBounds = nodeBounds(targetNode);
  const obstacles = obstacleBounds(nodes, [edge.source, edge.target]);
  let best = null;
  for (const [sourcePort, targetPort] of AUTO_PORT_PAIRS) {
    const route = buildOrthogonalRoute({
      source: portPoint(sourceNode, sourcePort),
      target: portPoint(targetNode, targetPort),
      sourcePort,
      targetPort,
      obstacles,
    });
    const score = route.score + facingPenalty(sourceBounds, targetBounds, sourcePort, targetPort);
    if (!best || score < best.score) best = { sourcePort, targetPort, score };
  }
  return { sourcePort: best.sourcePort, targetPort: best.targetPort, routingMode: 'auto' };
}

export function routeIsOrthogonal(points) {
  return points.slice(1).every((point, index) => (
    Math.abs(points[index].x - point.x) < EPSILON || Math.abs(points[index].y - point.y) < EPSILON
  ));
}
