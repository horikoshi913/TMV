#!/usr/bin/env python3
"""国土数値情報（鉄道データ N02）から北海道の在来線データを生成する。

使い方:
    python3 scripts/build_data.py <N02 の UTF-8 ディレクトリ>

出力: data/hokkaido-rail.json
"""
import heapq
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

# id, N02 の路線名, 運営会社 (部分一致), 表示名, 愛称, 色, 区間 [(起点, 経由駅..., 終点), ...]
LINES = [
    ("hakodate", "函館線", "北海道旅客鉄道", "函館本線", None, "#e2421f", [
        ("函館", "新函館北斗", "仁山", "大沼", "駒ヶ岳", "森", "長万部", "倶知安", "小樽", "札幌", "岩見沢", "滝川", "旭川"),
        ("大沼", "鹿部", "渡島砂原", "森"),
    ]),
    ("muroran", "室蘭線", "北海道旅客鉄道", "室蘭本線", None, "#f08300", [("長万部", "岩見沢"), ("東室蘭", "室蘭")]),
    ("chitose", "千歳線", "北海道旅客鉄道", "千歳線", None, "#0b8a4a", [("白石", "沼ノ端"), ("南千歳", "新千歳空港")]),
    ("sassho", "札沼線", "北海道旅客鉄道", "札沼線", "学園都市線", "#2e9b45", [("桑園", "北海道医療大学")]),
    ("sekisho", "石勝線", "北海道旅客鉄道", "石勝線", None, "#7b3fa0", [("南千歳", "新得")]),
    ("nemuro", "根室線", "北海道旅客鉄道", "根室本線", None, "#1d5fbf", [("滝川", "富良野"), ("新得", "根室")]),
    ("furano", "富良野線", "北海道旅客鉄道", "富良野線", None, "#a35fc9", [("旭川", "富良野")]),
    ("soya", "宗谷線", "北海道旅客鉄道", "宗谷本線", None, "#c9a400", [("旭川", "稚内")]),
    ("sekihoku", "石北線", "北海道旅客鉄道", "石北本線", None, "#d6336c", [("新旭川", "網走")]),
    ("senmo", "釧網線", "北海道旅客鉄道", "釧網本線", None, "#0f9fb3", [("網走", "東釧路")]),
    ("hidaka", "日高線", "北海道旅客鉄道", "日高本線", None, "#8a6d3b", [("苫小牧", "鵡川")]),
    ("isaribi", "道南いさりび鉄道線", "道南いさりび鉄道", "道南いさりび鉄道線", None, "#5b6abf", [("五稜郭", "木古内")]),
    # 札幌市営地下鉄（公式のラインカラー）
    ("namboku", "南北線", "札幌市", "札幌市営地下鉄南北線", None, "#00873c", [("麻生", "真駒内")]),
    ("tozai", "東西線", "札幌市", "札幌市営地下鉄東西線", None, "#f39800", [("宮の沢", "新さっぽろ")]),
    ("toho", "東豊線", "札幌市", "札幌市営地下鉄東豊線", None, "#0078c8", [("栄町", "福住")]),
    # 路面電車。N02 の路線名が複数に分かれているのでまとめる。
    # 札幌市電はループ線（起点と終点が同じ）。経由駅は経路探索で逆回りしないための目印
    ("sapporo-tram", ("1条線", "山鼻西線", "山鼻線", "都心線"), "札幌市交通事業振興公社", "札幌市電", None, "#6a8f00", [
        ("西4丁目", "西15丁目", "西線16条", "中央図書館前", "山鼻19条", "中島公園通", "すすきの", "狸小路", "西4丁目"),
    ]),
    ("hakodate-tram", ("本線", "大森線", "湯の川線", "宝来・谷地頭線"), "函館市", "函館市電", None, "#00897b", [
        ("湯の川", "松風町", "函館駅前", "十字街", "函館どつく前"),
        ("十字街", "谷地頭"),
    ]),
]

OPERATOR_NAMES = {
    "北海道旅客鉄道": "JR北海道",
    "道南いさりび鉄道": "道南いさりび鉄道",
    "札幌市": "札幌市交通局",
    "札幌市交通事業振興公社": "札幌市交通事業振興公社",
    "函館市": "函館市企業局",
}

# 他社線と同名の別駅があるとき、駅名の後ろに付ける種別
NAME_SUFFIX = {"namboku": "地下鉄", "tozai": "地下鉄", "toho": "地下鉄", "sapporo-tram": "市電", "hakodate-tram": "市電"}


def key(c):
    return (round(c[0], 6), round(c[1], 6))


def dist(a, b):
    # 簡易距離 (km)。北海道付近の緯度で十分な精度。
    lat = math.radians((a[1] + b[1]) / 2)
    dx = (a[0] - b[0]) * 111.32 * math.cos(lat)
    dy = (a[1] - b[1]) * 110.57
    return math.hypot(dx, dy)


def merge_chains(segments):
    """線分の集合を、分岐点・端点で区切られた最長の折れ線にまとめる。"""
    deg = defaultdict(int)
    adj = defaultdict(list)
    for i, s in enumerate(segments):
        a, b = key(s[0]), key(s[-1])
        deg[a] += 1
        deg[b] += 1
        adj[a].append(i)
        adj[b].append(i)
    used = [False] * len(segments)
    chains = []

    def extend(chain, end):
        while deg[end] == 2:
            nxt = [i for i in adj[end] if not used[i]]
            if not nxt:
                break
            i = nxt[0]
            used[i] = True
            seg = segments[i]
            if key(seg[0]) != end:
                seg = seg[::-1]
            chain.extend(seg[1:])
            end = key(seg[-1])
        return chain

    for i, s in enumerate(segments):
        if used[i]:
            continue
        used[i] = True
        chain = extend(list(s), key(s[-1]))
        back = extend(list(reversed(chain)), key(chain[0]))
        chains.append(back)
    return chains


def simplify(pts, tol_km=0.008):
    """Douglas-Peucker 法で頂点数を減らす。"""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        a, b = pts[s], pts[e]
        best, idx = 0.0, None
        ab = dist(a, b)
        for i in range(s + 1, e):
            p = pts[i]
            if ab == 0:
                d = dist(a, p)
            else:
                # ヘロンの公式で点と直線の距離
                x, y = dist(a, p), dist(b, p)
                sp = (ab + x + y) / 2
                area = math.sqrt(max(sp * (sp - ab) * (sp - x) * (sp - y), 0))
                d = 2 * area / ab
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol_km:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [p for p, k in zip(pts, keep) if k]


def station_point(geom):
    coords = geom["coordinates"]
    if geom["type"] == "MultiLineString":
        coords = [c for part in coords for c in part]
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def main(src):
    src = Path(src)
    sections = json.loads(next(src.glob("*RailroadSection.geojson")).read_text(encoding="utf-8"))
    stations = json.loads(next(src.glob("*Station.geojson")).read_text(encoding="utf-8"))
    meta_date = next(src.glob("*RailroadSection.geojson")).name.split("_")[0]

    out_lines = []
    all_stations = {}  # group code -> station dict

    for lid, n02names, op, name, nickname, color, routes in LINES:
        if isinstance(n02names, str):
            n02names = (n02names,)
        segs = []
        for f in sections["features"]:
            p = f["properties"]
            if p["N02_003"] in n02names and op in p["N02_004"]:
                g = f["geometry"]
                parts = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
                segs.extend([tuple(map(tuple, part)) for part in parts])
        sts = []
        for f in stations["features"]:
            p = f["properties"]
            if p["N02_003"] in n02names and op in p["N02_004"]:
                sts.append({"name": p["N02_005"], "group": p["N02_005g"], "pt": station_point(f["geometry"])})
        if not segs:
            sys.exit(f"線路データがありません: {n02names}")

        # グラフ構築
        graph = defaultdict(list)
        for s in segs:
            for a, b in zip(s, s[1:]):
                d = dist(a, b)
                graph[key(a)].append((key(b), d))
                graph[key(b)].append((key(a), d))
        verts = list(graph)

        def snap(pt):
            return min(verts, key=lambda v: dist(v, pt))

        by_name = {}
        for st in sts:
            st["v"] = snap(st["pt"])
            by_name[st["name"]] = st

        def dijkstra(start):
            dd = {start: 0.0}
            prev = {}
            pq = [(0.0, start)]
            while pq:
                d, u = heapq.heappop(pq)
                if d > dd[u]:
                    continue
                for v, w in graph[u]:
                    nd = d + w
                    if nd < dd.get(v, math.inf):
                        dd[v] = nd
                        prev[v] = u
                        heapq.heappush(pq, (nd, v))
            return dd, prev

        sections_out = []
        placed = set()
        for route in routes:
            for n in route:
                if n not in by_name:
                    sys.exit(f"{name}: 駅が見つかりません {n}")
            # 経由駅を順にたどる経路
            path = [by_name[route[0]]["v"]]
            for a, b in zip(route, route[1:]):
                dd, prev = dijkstra(by_name[a]["v"])
                seg = []
                v = by_name[b]["v"]
                while v != by_name[a]["v"]:
                    seg.append(v)
                    v = prev[v]
                path.extend(reversed(seg))
            along = [0.0]
            for a, b in zip(path, path[1:]):
                along.append(along[-1] + dist(a, b))
            loop = route[0] == route[-1]
            on = {}
            for st in sts:
                if st["name"] in placed:
                    continue
                i, d = min(((i, dist(v, st["pt"])) for i, v in enumerate(path)), key=lambda t: t[1])
                # 上下で別の停留場がある場合（例: 札幌市電の狸小路）は同名を 1 つにまとめる
                if d < 0.4 and (st["name"] not in on or along[i] < on[st["name"]]):
                    on[st["name"]] = along[i]
            # 支線は分岐駅・合流駅も一覧に含める
            names = sorted(on, key=on.get)
            for end in dict.fromkeys((route[0], route[-1])):
                if end not in names:
                    names.insert(0 if end == route[0] else len(names), end)
            if loop:
                # ループ線は起点に戻ってくる
                names.remove(route[0])
                names = [route[0]] + names + [route[0]]
            placed.update(names)
            # 列車の位置計算用: 区間の軌跡と、各駅が軌跡上のどの頂点か
            stop_idx = [min(range(len(path)), key=lambda i: dist(path[i], by_name[n]["pt"])) for n in names]
            if loop:
                stop_idx[0], stop_idx[-1] = 0, len(path) - 1
            keep = sorted(set(stop_idx))
            simple, new_index = [], {}
            for k0, k1 in zip([0] + keep, keep + [len(path) - 1]):
                part = simplify(path[k0:k1 + 1])
                if simple:
                    part = part[1:]
                new_index.setdefault(k0, len(simple) - 1 if simple else 0)
                simple.extend(part)
                new_index[k1] = len(simple) - 1
            sections_out.append({"from": route[0], "to": route[-1], "stations": names,
                                 "km": round(along[-1], 1),
                                 "path": [[round(c[1], 5), round(c[0], 5)] for c in simple],
                                 "stopIdx": [new_index[i] for i in stop_idx]})
        missing = [s["name"] for s in sts if s["name"] not in placed]
        if missing:
            sys.exit(f"{name}: 区間に含まれない駅があります {missing}")

        chains = merge_chains(segs)
        paths = [[[round(c[1], 5), round(c[0], 5)] for c in simplify(ch)] for ch in chains]

        for st in sts:
            g = st["group"]
            if g not in all_stations:
                all_stations[g] = {"name": st["name"], "pts": [], "lines": []}
            all_stations[g]["pts"].append(st["pt"])
            if lid not in all_stations[g]["lines"]:
                all_stations[g]["lines"].append(lid)

        out_lines.append({
            "id": lid, "name": name, "nickname": nickname, "color": color,
            "operator": OPERATOR_NAMES[op], "sections": sections_out, "paths": paths,
        })

    # 同名駅で group コードが分かれている場合 (例: 異なる会社) は近ければ統合
    merged = []
    for st in all_stations.values():
        x = sum(p[0] for p in st["pts"]) / len(st["pts"])
        y = sum(p[1] for p in st["pts"]) / len(st["pts"])
        for m in merged:
            if m["name"] == st["name"] and dist((m["lng"], m["lat"]), (x, y)) < 0.5:
                m["lines"] += [l for l in st["lines"] if l not in m["lines"]]
                break
        else:
            merged.append({"name": st["name"], "lat": round(y, 5), "lng": round(x, 5), "lines": st["lines"]})
    merged.sort(key=lambda s: (-s["lat"]))

    # JR と地下鉄で同名の別の駅（琴似・白石・平岸）は、地下鉄側の名前に種別を付けて区別する
    counts = defaultdict(int)
    for s in merged:
        counts[s["name"]] += 1
    line_by_id = {l["id"]: l for l in out_lines}
    for s in merged:
        if counts[s["name"]] < 2 or not all(l in NAME_SUFFIX for l in s["lines"]):
            continue
        old, new = s["name"], f"{s['name']}（{NAME_SUFFIX[s['lines'][0]]}）"
        s["name"] = new
        for lid in s["lines"]:
            for sec in line_by_id[lid]["sections"]:
                sec["stations"] = [new if n == old else n for n in sec["stations"]]
    names = [s["name"] for s in merged]
    dup = sorted({n for n in names if names.count(n) > 1})
    if dup:
        sys.exit(f"同名の駅を区別できません: {dup}")

    out = {
        "source": f"国土数値情報（鉄道データ）{meta_date}（国土交通省）を加工して作成",
        "lines": out_lines,
        "stations": merged,
    }
    dst = Path(__file__).resolve().parent.parent / "data" / "hokkaido-rail.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{dst}: 路線 {len(out_lines)} / 駅 {len(merged)} / {dst.stat().st_size // 1024} KB")
    for l in out_lines:
        for s in l["sections"]:
            print(f"  {l['name']} {s['from']}–{s['to']} {s['km']}km {len(s['stations'])}駅: "
                  f"{' '.join(s['stations'][:4])} … {' '.join(s['stations'][-3:])}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
