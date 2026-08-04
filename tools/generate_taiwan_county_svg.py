"""Generate a compact clickable Taiwan county SVG from the NLSC county SHP.

Source dataset: 內政部國土測繪中心「直轄市、縣市界線(TWD97經緯度)」
https://data.gov.tw/dataset/7442

Usage:
  pip install pyshp
  python tools/generate_taiwan_county_svg.py INPUT.shp system/assets/taiwan-counties.svg
"""

from __future__ import annotations

import html
import math
import sys
from pathlib import Path

import shapefile


WIDTH, HEIGHT, PADDING = 620, 820, 24
SIMPLIFY_TOLERANCE = 0.004
# 官方高雄市界線亦含東沙、南沙島礁；互動氣象圖聚焦臺澎金馬，
# 避免遠端島礁把臺灣本島壓縮成畫面上方的一小塊。
MAP_BOUNDS = (117.8, 21.7, 122.2, 26.6)


def point_line_distance(point, start, end):
    if start == end:
        return math.dist(point, start)
    x, y = point
    x1, y1 = start
    x2, y2 = end
    dx, dy = x2 - x1, y2 - y1
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(points, tolerance=SIMPLIFY_TOLERANCE):
    if len(points) <= 3:
        return points
    first, last = points[0], points[-1]
    max_distance, index = 0.0, 0
    for i in range(1, len(points) - 1):
        distance = point_line_distance(points[i], first, last)
        if distance > max_distance:
            max_distance, index = distance, i
    if max_distance > tolerance:
        left = simplify(points[: index + 1], tolerance)
        right = simplify(points[index:], tolerance)
        return left[:-1] + right
    return [first, last]


def polygon_centroid(ring):
    area = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        cross = x1 * y2 - x2 * y1
        area += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(area) < 1e-12:
        return sum(x for x, _ in ring) / len(ring), sum(y for _, y in ring) / len(ring)
    return cx / (3 * area), cy / (3 * area)


def ring_is_in_map(ring):
    min_lon, min_lat, max_lon, max_lat = MAP_BOUNDS
    lon = sum(point[0] for point in ring) / len(ring)
    lat = sum(point[1] for point in ring) / len(ring)
    return min_lon <= lon <= max_lon and min_lat <= lat <= max_lat


def canonical_county(value):
    return str(value or "").strip().replace("台", "臺")


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: generate_taiwan_county_svg.py INPUT.shp OUTPUT.svg")
    source, target = Path(sys.argv[1]), Path(sys.argv[2])
    reader = shapefile.Reader(str(source), encoding="utf-8")
    fields = [field[0] for field in reader.fields[1:]]
    name_field = next((name for name in ("COUNTYNAME", "COUNTY_NAM", "COUNTY") if name in fields), None)
    if not name_field:
        raise RuntimeError(f"county name field not found: {fields}")

    features = []
    all_points = []
    for item in reader.iterShapeRecords():
        record = dict(zip(fields, item.record))
        name = canonical_county(record.get(name_field))
        points = [(float(x), float(y)) for x, y in item.shape.points]
        parts = list(item.shape.parts) + [len(points)]
        rings = []
        for start, end in zip(parts, parts[1:]):
            ring = points[start:end]
            if len(ring) < 4:
                continue
            if ring[0] == ring[-1]:
                ring = ring[:-1]
            if not ring_is_in_map(ring):
                continue
            ring = simplify(ring)
            if len(ring) >= 3:
                rings.append(ring)
                all_points.extend(ring)
        if rings:
            features.append((name, rings))

    min_x = min(x for x, _ in all_points)
    max_x = max(x for x, _ in all_points)
    min_y = min(y for _, y in all_points)
    max_y = max(y for _, y in all_points)
    scale = min((WIDTH - 2 * PADDING) / (max_x - min_x), (HEIGHT - 2 * PADDING) / (max_y - min_y))
    x_offset = (WIDTH - (max_x - min_x) * scale) / 2
    y_offset = (HEIGHT - (max_y - min_y) * scale) / 2

    def project(point):
        x, y = point
        return x_offset + (x - min_x) * scale, y_offset + (max_y - y) * scale

    paths = []
    for name, rings in features:
        commands = []
        for ring in rings:
            projected = [project(p) for p in ring]
            commands.append("M" + " ".join(
                (f"{x:.1f},{y:.1f}" if i == 0 else f"L{x:.1f},{y:.1f}")
                for i, (x, y) in enumerate(projected)
            ) + "Z")
        largest = max(rings, key=len)
        cx, cy = project(polygon_centroid(largest))
        safe = html.escape(name, quote=True)
        paths.append(
            f'  <path id="county-{safe}" class="county" data-county="{safe}" '
            f'data-cx="{cx:.1f}" data-cy="{cy:.1f}" d="{" ".join(commands)}"><title>{safe}</title></path>'
        )

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "\n".join([
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label="臺灣縣市互動地圖">',
            "  <title>臺灣直轄市及縣市界線</title>",
            "  <desc>資料來源：內政部國土測繪中心，政府資料開放授權條款第1版。</desc>",
            '  <g class="county-layer" fill-rule="evenodd">',
            *paths,
            "  </g>",
            '  <g class="weather-marker-layer" aria-hidden="true"></g>',
            "</svg>",
            "",
        ]),
        encoding="utf-8",
    )
    print(f"generated {target} with {len(features)} counties")


if __name__ == "__main__":
    main()
