#!/usr/bin/env python3
"""Natural Earth の陸地データから、オフライン地図の背景用に北海道周辺だけを切り出す。

使い方:
    curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson
    python3 scripts/build_coast.py ne_10m_land.geojson

出力: data/hokkaido-land.json  （[lat, lng] のリングの配列。Natural Earth はパブリックドメイン）
"""
import json
import sys
from pathlib import Path

# 切り出す範囲（北海道 + 周辺の本州北端・サハリン南部など）
WEST, EAST, SOUTH, NORTH = 137.5, 149.0, 39.8, 47.0
TOLERANCE = 0.001  # 簡略化の許容誤差（度）。約 100 m
MIN_POINTS = 4


def clip(ring, inside, intersect):
    """Sutherland–Hodgman の 1 辺分。"""
    out = []
    if not ring:
        return out
    prev = ring[-1]
    for cur in ring:
        if inside(cur):
            if not inside(prev):
                out.append(intersect(prev, cur))
            out.append(cur)
        elif inside(prev):
            out.append(intersect(prev, cur))
        prev = cur
    return out


def lerp_x(a, b, x):
    t = (x - a[0]) / (b[0] - a[0])
    return (x, a[1] + t * (b[1] - a[1]))


def lerp_y(a, b, y):
    t = (y - a[1]) / (b[1] - a[1])
    return (a[0] + t * (b[0] - a[0]), y)


def clip_to_box(ring):
    ring = clip(ring, lambda p: p[0] >= WEST, lambda a, b: lerp_x(a, b, WEST))
    ring = clip(ring, lambda p: p[0] <= EAST, lambda a, b: lerp_x(a, b, EAST))
    ring = clip(ring, lambda p: p[1] >= SOUTH, lambda a, b: lerp_y(a, b, SOUTH))
    ring = clip(ring, lambda p: p[1] <= NORTH, lambda a, b: lerp_y(a, b, NORTH))
    return ring


def simplify(points, tol):
    """Douglas–Peucker（反復版）。"""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        s, e = stack.pop()
        ax, ay = points[s]
        bx, by = points[e]
        dx, dy = bx - ax, by - ay
        norm = (dx * dx + dy * dy) ** 0.5
        best, idx = 0.0, -1
        for i in range(s + 1, e):
            px, py = points[i]
            if norm == 0:
                d = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, idx = d, i
        if best > tol and idx != -1:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [p for p, k in zip(points, keep) if k]


def bbox_hits(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return not (max(xs) < WEST or min(xs) > EAST or max(ys) < SOUTH or min(ys) > NORTH)


def main(src):
    gj = json.loads(Path(src).read_text(encoding="utf-8"))
    rings = []
    for f in gj["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            for ring in poly:
                if not bbox_hits(ring):
                    continue
                r = clip_to_box([tuple(p) for p in ring])
                if len(r) < MIN_POINTS:
                    continue
                r = simplify(r + [r[0]], TOLERANCE)
                if len(r) < MIN_POINTS:
                    continue
                rings.append([[round(lat, 4), round(lng, 4)] for lng, lat in r[:-1]])
    out = {
        "source": "Natural Earth（1:10m Land, パブリックドメイン）",
        "bounds": {"west": WEST, "east": EAST, "south": SOUTH, "north": NORTH},
        "rings": rings,
    }
    dst = Path(__file__).resolve().parent.parent / "data" / "hokkaido-land.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{dst}: {len(rings)} rings, {sum(len(r) for r in rings)} points, {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
