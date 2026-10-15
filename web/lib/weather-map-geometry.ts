export type WeatherMapBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type WeatherMapMarkerAnchor = Readonly<{
  name: string;
  x: number;
  y: number;
}>;

export type WeatherMapCountyShape = Readonly<{
  county: string;
  centerX: number;
  centerY: number;
  path: string;
}>;

export type WeatherMapRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type WeatherMapSide = 'north' | 'west' | 'east' | 'inland' | 'unknown';

export type WeatherMapMarkerLayout = Readonly<{
  name: string;
  side: WeatherMapSide;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  temperatureOffsetY: number;
  coastGap: number;
  iconRect: WeatherMapRect;
  groupRect: WeatherMapRect;
  labelRect: WeatherMapRect;
}>;

export const WEATHER_MAP_VIEWBOX = '187 185 446 610';
export const WEATHER_MAP_VIEWBOX_BOUNDS: WeatherMapBounds = { x: 187, y: 185, width: 446, height: 610 };
export const WEATHER_MAP_MAX_MARKER_SHIFT = 24;
export const WEATHER_MAP_KAOHSIUNG_SOUTHWARD_OFFSET = 34;
export const WEATHER_MAP_TRANSFORM = { scale: 0.96, translateX: 0, translateY: 54.76 } as const;

const MARKER_RADIUS = 12;
const LABEL_WIDTH = 34;
const LABEL_HEIGHT = 10;
const LABEL_GAP = 2;
const COAST_GAP = 4;
const MIN_COAST_CLEARANCE = 3.25;
const BOX_GAP = 1;
const GROUP_HALF_WIDTH = Math.max(MARKER_RADIUS, LABEL_WIDTH / 2);
const GROUP_HEIGHT = MARKER_RADIUS * 2 + LABEL_GAP + LABEL_HEIGHT;
const PATH_CACHE = new WeakMap<readonly WeatherMapCountyShape[], ParsedCountyShape[]>();

export const WEATHER_MAP_GROUPS = {
  north: ['\u6843\u5712\u5e02', '\u65b0\u5317\u5e02', '\u81fa\u5317\u5e02', '\u57fa\u9686\u5e02'],
  west: ['\u65b0\u7af9\u5e02', '\u82d7\u6817\u7e23', '\u81fa\u4e2d\u5e02', '\u5f70\u5316\u7e23', '\u96f2\u6797\u7e23', '\u5609\u7fa9\u5e02', '\u81fa\u5357\u5e02', '\u9ad8\u96c4\u5e02', '\u5c4f\u6771\u7e23'],
  east: ['\u5b9c\u862d\u7e23', '\u82b1\u84ee\u7e23', '\u81fa\u6771\u7e23'],
  inland: ['\u65b0\u7af9\u7e23', '\u5357\u6295\u7e23', '\u5609\u7fa9\u7e23'],
} as const;

type Point = readonly [number, number];
type ParsedCountyShape = WeatherMapCountyShape & { rings: Point[][] };
type Interval = readonly [number, number];

export function formatWeatherTemperature(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric)}\u00b0C` : null;
}

export function getWeatherMapGroup(name: string): keyof typeof WEATHER_MAP_GROUPS | null {
  for (const [group, names] of Object.entries(WEATHER_MAP_GROUPS)) {
    if ((names as readonly string[]).includes(name)) return group as keyof typeof WEATHER_MAP_GROUPS;
  }
  return null;
}

function parseCountyShapes(shapes: readonly WeatherMapCountyShape[]): ParsedCountyShape[] {
  const cached = PATH_CACHE.get(shapes);
  if (cached) return cached;
  const mainlandNames = new Set<string>(Object.values(WEATHER_MAP_GROUPS).flat());
  const parsed = shapes.flatMap(shape => {
    if (!mainlandNames.has(shape.county)) return [];
    const tokens = [...shape.path.matchAll(/[MLZ]|-?\d+(?:\.\d+)?/g)].map(match => match[0]);
    const rings: Point[][] = [];
    let ring: Point[] = [];
    for (let index = 0; index < tokens.length;) {
      const command = tokens[index++];
      if (command === 'M' || command === 'L') {
        if (command === 'M' && ring.length) {
          rings.push(ring);
          ring = [];
        }
        const x = Number(tokens[index++]);
        const y = Number(tokens[index++]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid county path point');
        ring.push([x, y]);
      } else if (command === 'Z') {
        if (ring.length) rings.push(ring);
        ring = [];
      } else {
        throw new Error('Unsupported county path command');
      }
    }
    if (ring.length) rings.push(ring);
    return rings.length ? [{ ...shape, rings }] : [];
  });
  PATH_CACHE.set(shapes, parsed);
  return parsed;
}

function scanlineIntervals(shapes: readonly ParsedCountyShape[], value: number, vertical: boolean): Interval[] {
  const intervals: [number, number][] = [];
  for (const shape of shapes) for (const ring of shape.rings) {
    const intersections: number[] = [];
    for (let index = 0; index < ring.length; index += 1) {
      const [x1, y1] = ring[index];
      const [x2, y2] = ring[(index + 1) % ring.length];
      const fixed1 = vertical ? x1 : y1;
      const fixed2 = vertical ? x2 : y2;
      if ((fixed1 <= value && fixed2 > value) || (fixed2 <= value && fixed1 > value)) {
        const along1 = vertical ? y1 : x1;
        const along2 = vertical ? y2 : x2;
        intersections.push(along1 + (value - fixed1) * (along2 - along1) / (fixed2 - fixed1));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      if (intersections[index + 1] - intersections[index] > 0.02) intervals.push([intersections[index], intersections[index + 1]]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

function mainIslandInterval(shapes: readonly ParsedCountyShape[], value: number, vertical: boolean): Interval | undefined {
  return scanlineIntervals(shapes, value, vertical).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
}

function pointInRing([x, y]: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringArea(ring: readonly Point[]): number {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function mainRing(shape: ParsedCountyShape): Point[] {
  return shape.rings.reduce((largest, ring) => ringArea(ring) > ringArea(largest) ? ring : largest);
}

function pointInMainland(point: Point, shapes: readonly ParsedCountyShape[]): boolean {
  return shapes.some(shape => pointInRing(point, mainRing(shape)));
}

function exteriorSegments(shape: ParsedCountyShape, allShapes: readonly ParsedCountyShape[]): { start: Point; end: Point; outwardX: number }[] {
  const segments: { start: Point; end: Point; outwardX: number }[] = [];
  const ring = mainRing(shape);
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (length < 0.01) continue;
    const nx = -dy / length;
    const ny = dx / length;
    const midpoint: Point = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const positiveInside = pointInMainland([midpoint[0] + nx * 0.75, midpoint[1] + ny * 0.75], allShapes);
    const negativeInside = pointInMainland([midpoint[0] - nx * 0.75, midpoint[1] - ny * 0.75], allShapes);
    if (positiveInside === negativeInside) continue;
    segments.push({ start, end, outwardX: positiveInside ? -nx : nx });
  }
  return segments;
}

function countyWestCoastEdgeAtY(segments: readonly { start: Point; end: Point; outwardX: number }[], mapY: number): number | undefined {
  const y = (mapY - WEATHER_MAP_TRANSFORM.translateY) / WEATHER_MAP_TRANSFORM.scale;
  let edge = Infinity;
  for (const { start, end, outwardX } of segments) {
    if (outwardX > -0.3 || !((start[1] <= y && end[1] > y) || (end[1] <= y && start[1] > y))) continue;
    const x = start[0] + (y - start[1]) * (end[0] - start[0]) / (end[1] - start[1]);
    edge = Math.min(edge, x * WEATHER_MAP_TRANSFORM.scale + WEATHER_MAP_TRANSFORM.translateX);
  }
  return Number.isFinite(edge) ? edge : undefined;
}

function markerRects(x: number, y: number): Pick<WeatherMapMarkerLayout, 'iconRect' | 'groupRect' | 'labelRect'> {
  const iconRect = { x: x - MARKER_RADIUS, y: y - MARKER_RADIUS, width: MARKER_RADIUS * 2, height: MARKER_RADIUS * 2 };
  const labelRect = { x: x - LABEL_WIDTH / 2, y: y + MARKER_RADIUS + LABEL_GAP, width: LABEL_WIDTH, height: LABEL_HEIGHT };
  return {
    iconRect,
    labelRect,
    groupRect: { x: x - GROUP_HALF_WIDTH, y: y - MARKER_RADIUS, width: GROUP_HALF_WIDTH * 2, height: GROUP_HEIGHT },
  };
}

function inside(rect: WeatherMapRect, bounds: WeatherMapBounds): boolean {
  return rect.x >= bounds.x - 1e-7 && rect.y >= bounds.y - 1e-7
    && rect.x + rect.width <= bounds.x + bounds.width + 1e-7
    && rect.y + rect.height <= bounds.y + bounds.height + 1e-7;
}

function overlaps(a: WeatherMapRect, b: WeatherMapRect, gap = 0): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const fraction = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + fraction * dx), point[1] - (start[1] + fraction * dy));
}

function pointToRectDistance([x, y]: Point, rect: WeatherMapRect): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function segmentIntersectsRect(start: Point, end: Point, rect: WeatherMapRect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const clips: [number, number][] = [
    [-dx, start[0] - rect.x], [dx, rect.x + rect.width - start[0]],
    [-dy, start[1] - rect.y], [dy, rect.y + rect.height - start[1]],
  ];
  for (const [p, q] of clips) {
    if (p === 0) { if (q < 0) return false; continue; }
    const ratio = q / p;
    if (p < 0) t0 = Math.max(t0, ratio);
    else t1 = Math.min(t1, ratio);
    if (t0 > t1) return false;
  }
  return true;
}

function rectToCoastDistance(rect: WeatherMapRect, shapes: readonly ParsedCountyShape[]): number {
  const corners: Point[] = [
    [rect.x, rect.y], [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height],
  ];
  let distance = Infinity;
  for (const shape of shapes) for (const ring of shape.rings) for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    const start: Point = [x1 * WEATHER_MAP_TRANSFORM.scale + WEATHER_MAP_TRANSFORM.translateX,
      y1 * WEATHER_MAP_TRANSFORM.scale + WEATHER_MAP_TRANSFORM.translateY];
    const end: Point = [x2 * WEATHER_MAP_TRANSFORM.scale + WEATHER_MAP_TRANSFORM.translateX,
      y2 * WEATHER_MAP_TRANSFORM.scale + WEATHER_MAP_TRANSFORM.translateY];
    if (segmentIntersectsRect(start, end, rect)) return 0;
    distance = Math.min(distance, pointToRectDistance(start, rect));
    for (const corner of corners) distance = Math.min(distance, pointToSegmentDistance(corner, start, end));
  }
  return distance;
}

function isotonicNorthX(anchors: readonly WeatherMapMarkerAnchor[]): Map<string, number> {
  const ordered = [...anchors].sort((a, b) => a.x - b.x);
  const spacing = GROUP_HALF_WIDTH * 2 + BOX_GAP;
  const blocks: { start: number; end: number; sum: number; count: number }[] = [];
  ordered.forEach((anchor, index) => {
    blocks.push({ start: index, end: index, sum: anchor.x - index * spacing, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const previous = blocks[blocks.length - 2];
      if (previous.sum / previous.count <= last.sum / last.count) break;
      blocks.splice(blocks.length - 2, 2, {
        start: previous.start,
        end: last.end,
        sum: previous.sum + last.sum,
        count: previous.count + last.count,
      });
    }
  });
  const positions = new Map<string, number>();
  for (const block of blocks) {
    const base = block.sum / block.count;
    for (let index = block.start; index <= block.end; index += 1) positions.set(ordered[index].name, base + index * spacing);
  }
  return positions;
}

function countyTargetY(shape: ParsedCountyShape, name: string): number {
  const points = shape.rings.flat();
  const minY = Math.min(...points.map(point => point[1]));
  const maxY = Math.max(...points.map(point => point[1]));
  // The reference puts the two southern-coast badges near their actual southern county edges.
  if (name === '\u5c4f\u6771\u7e23') return maxY;
  if (name === '\u81fa\u6771\u7e23') return minY + (maxY - minY) * 0.75;
  if (name === '\u81fa\u4e2d\u5e02') return shape.centerY + 3 / WEATHER_MAP_TRANSFORM.scale;
  if (name === '\u9ad8\u96c4\u5e02') return shape.centerY + 18 / WEATHER_MAP_TRANSFORM.scale;
  return shape.centerY;
}

function buildLayout(
  anchors: readonly WeatherMapMarkerAnchor[],
  shapes: readonly ParsedCountyShape[],
  bounds: WeatherMapBounds,
): WeatherMapMarkerLayout[] {
  const shapeByName = new Map(shapes.map(shape => [shape.county, shape] as const));
  const anchorByName = new Map(anchors.map(anchor => [anchor.name, anchor] as const));
  const localWestCoastByName = new Map(['高雄市'].flatMap(name => {
    const shape = shapeByName.get(name);
    const segments = shape ? exteriorSegments(shape, shapes) : [];
    return shape ? [[name, segments] as const] : [];
  }));
  const placed: WeatherMapMarkerLayout[] = [];
  const push = (anchor: WeatherMapMarkerAnchor, side: WeatherMapSide, x: number, y: number, coastGap: number) => {
    const rects = markerRects(x, y);
    const layout = { name: anchor.name, side, anchorX: anchor.x, anchorY: anchor.y, x, y,
      temperatureOffsetY: MARKER_RADIUS + LABEL_GAP + LABEL_HEIGHT / 2, coastGap, ...rects };
    placed.push(layout);
    return layout;
  };
  const collides = (candidate: WeatherMapMarkerLayout) => placed.some(item => overlaps(candidate.groupRect, item.groupRect, BOX_GAP));

  for (const name of WEATHER_MAP_GROUPS.inland) {
    const anchor = anchorByName.get(name);
    if (anchor) push(anchor, 'inland', anchor.x, anchor.y, 0);
  }

  const northAnchors = WEATHER_MAP_GROUPS.north.flatMap(name => anchorByName.get(name) ?? []);
  const northX = isotonicNorthX(northAnchors);
  for (const anchor of northAnchors) {
    const shape = shapeByName.get(anchor.name);
    if (!shape) continue;
    const x = northX.get(anchor.name) ?? anchor.x;
    let top = Infinity;
    for (let mapX = x - GROUP_HALF_WIDTH; mapX <= x + GROUP_HALF_WIDTH; mapX += 0.5) {
      const spans = scanlineIntervals(shapes, (mapX - WEATHER_MAP_TRANSFORM.translateX) / WEATHER_MAP_TRANSFORM.scale, true);
      for (const span of spans) top = Math.min(top, span[0] * WEATHER_MAP_TRANSFORM.scale + WEATHER_MAP_TRANSFORM.translateY);
    }
    const initialY = top - (MARKER_RADIUS + LABEL_GAP + LABEL_HEIGHT + COAST_GAP);
    if (!Number.isFinite(top)) continue;
    for (let outward = 0; outward <= 40; outward += 0.25) {
      const y = initialY - outward;
      const candidate = { name: anchor.name, side: 'north' as const, anchorX: anchor.x, anchorY: anchor.y,
        x, y, temperatureOffsetY: MARKER_RADIUS + LABEL_GAP + LABEL_HEIGHT / 2,
        coastGap: MIN_COAST_CLEARANCE, ...markerRects(x, y) };
      if (!inside(candidate.groupRect, bounds) && outward > 0) break;
      if (inside(candidate.groupRect, bounds) && !collides(candidate)
        && rectToCoastDistance(candidate.groupRect, shapes) >= MIN_COAST_CLEARANCE) {
        placed.push(candidate);
        break;
      }
    }
  }

  for (const side of ['west', 'east'] as const) {
    const ordered = WEATHER_MAP_GROUPS[side]
      .flatMap(name => {
        const anchor = anchorByName.get(name);
        const shape = shapeByName.get(name);
        return anchor && shape ? [{ anchor, shape, targetY: countyTargetY(shape, name) }] : [];
      })
      .sort((a, b) => a.targetY - b.targetY);
    let lastY = -Infinity;
    for (const { anchor, shape, targetY } of ordered) {
      const southwardBias = anchor.name === '\u9ad8\u96c4\u5e02' ? WEATHER_MAP_KAOHSIUNG_SOUTHWARD_OFFSET : 0;
      const anchorTargetY = targetY * WEATHER_MAP_TRANSFORM.scale + WEATHER_MAP_TRANSFORM.translateY + southwardBias;
      let selected: WeatherMapMarkerLayout | undefined;
      let bestGlobalCandidate: WeatherMapMarkerLayout | undefined;
      let bestLocalGap = Infinity;
      const maxShift = localWestCoastByName.has(anchor.name) ? 48 : WEATHER_MAP_MAX_MARKER_SHIFT;
      for (let distance = 0; distance <= maxShift && !selected; distance += 1) {
        for (const direction of distance === 0 ? [0] : [-1, 1]) {
          const y = anchorTargetY + distance * direction;
          if (y < lastY) continue;
          let edge = side === 'west' ? Infinity : -Infinity;
          const top = y - MARKER_RADIUS;
          const bottom = y + MARKER_RADIUS + LABEL_GAP + LABEL_HEIGHT;
          for (let mapY = top; mapY <= bottom + 1e-7; mapY += 0.5) {
            const localWestEdge = side === 'west' ? localWestCoastByName.get(anchor.name) : undefined;
            const span = localWestEdge
              ? undefined
              : mainIslandInterval(shapes, (mapY - WEATHER_MAP_TRANSFORM.translateY) / WEATHER_MAP_TRANSFORM.scale, false);
            const sideEdge = localWestEdge
              ? countyWestCoastEdgeAtY(localWestEdge, mapY)
              : span?.[side === 'west' ? 0 : 1];
            if (sideEdge === undefined) continue;
            const transformedEdge = localWestEdge ? sideEdge : sideEdge * WEATHER_MAP_TRANSFORM.scale + WEATHER_MAP_TRANSFORM.translateX;
            edge = side === 'west' ? Math.min(edge, transformedEdge) : Math.max(edge, transformedEdge);
          }
          if (!Number.isFinite(edge)) continue;
          const initialX = edge + (side === 'west' ? -1 : 1) * (GROUP_HALF_WIDTH + COAST_GAP);
          for (let outward = 0; outward <= 40; outward += 0.25) {
            const x = initialX + (side === 'west' ? -1 : 1) * outward;
            const candidate: WeatherMapMarkerLayout = {
              name: anchor.name,
              side,
              anchorX: anchor.x,
              anchorY: anchor.y,
              x,
              y,
              temperatureOffsetY: MARKER_RADIUS + LABEL_GAP + LABEL_HEIGHT / 2,
              coastGap: MIN_COAST_CLEARANCE,
              ...markerRects(x, y),
            };
            if (!inside(candidate.groupRect, bounds)) break;
            if (collides(candidate)) continue;
            if (rectToCoastDistance(candidate.groupRect, shapes) < MIN_COAST_CLEARANCE) continue;
            if (localWestCoastByName.has(anchor.name)) {
              const localShape: ParsedCountyShape = { ...shape, rings: [mainRing(shape)] };
              const localGap = rectToCoastDistance(candidate.groupRect, [localShape]);
              if (localGap < bestLocalGap) {
                bestLocalGap = localGap;
                bestGlobalCandidate = candidate;
              }
              if (localGap > 5) continue;
            }
            selected = candidate;
            break;
          }
          if (selected) break;
        }
      }
      if (!selected && bestGlobalCandidate) selected = bestGlobalCandidate;
      if (selected) {
        placed.push(selected);
        lastY = selected.y;
      } else {
        // Keep the widget usable if an SVG path is incomplete; production geometry tests catch this fallback.
        const fallback = { ...push(anchor, side, anchor.x, anchor.y, 0) };
        if (!inside(fallback.groupRect, bounds)) placed.pop();
      }
    }
  }

  const byName = new Map(placed.map(marker => [marker.name, marker] as const));
  return anchors.map(anchor => byName.get(anchor.name) ?? {
    name: anchor.name,
    side: getWeatherMapGroup(anchor.name) ?? 'unknown',
    anchorX: anchor.x,
    anchorY: anchor.y,
    x: anchor.x,
    y: anchor.y,
    temperatureOffsetY: MARKER_RADIUS + LABEL_GAP + LABEL_HEIGHT / 2,
    coastGap: 0,
    ...markerRects(anchor.x, anchor.y),
  });
}

/** Project 16 coastal badges outside the real mainland silhouette and leave only 3 inland badges on land. */
export function layoutWeatherMarkers(
  anchors: readonly WeatherMapMarkerAnchor[],
  countyShapes: readonly WeatherMapCountyShape[] = [],
  bounds: WeatherMapBounds = WEATHER_MAP_VIEWBOX_BOUNDS,
): WeatherMapMarkerLayout[] {
  if (!anchors.length) return [];
  try {
    return buildLayout(anchors, parseCountyShapes(countyShapes), bounds);
  } catch {
    return anchors.map(anchor => ({
      name: anchor.name,
      side: getWeatherMapGroup(anchor.name) ?? 'unknown',
      anchorX: anchor.x,
      anchorY: anchor.y,
      x: anchor.x,
      y: anchor.y,
      temperatureOffsetY: MARKER_RADIUS + LABEL_GAP + LABEL_HEIGHT / 2,
      coastGap: 0,
      ...markerRects(anchor.x, anchor.y),
    }));
  }
}
