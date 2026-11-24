// 実際の時刻表（data/trains.json）から列車の現在位置を計算する。
// 時刻表にあるのは停車駅と発着時刻だけなので、停車駅の間は線路網上の最短経路を
// 一定の速さで走るものとして位置を求める。

import { jstSeconds, formatTime } from "./trains.js";

// 特急の列車名（時刻表の train_type にそのまま入っている）
const LIMITED_EXPRESS = new Set(["北斗", "すずらん", "ライラック", "カムイ", "オホーツク", "大雪", "宗谷", "サロベツ", "おおぞら", "とかち"]);

function km(a, b) {
  const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  return Math.hypot((a[1] - b[1]) * 111.32 * Math.cos(lat), (a[0] - b[0]) * 110.57);
}
function bearing(a, b) {
  const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  return (Math.atan2((b[1] - a[1]) * Math.cos(lat), b[0] - a[0]) * 180) / Math.PI;
}
const seconds = (hms) => {
  if (!hms) return null;
  const [h, m, s = 0] = hms.split(":").map(Number);
  return h * 3600 + m * 60 + s;
};

// 時刻表の駅名を路線データの駅名に合わせる（例:「森(北海道)」→「森」、「駒ケ岳」→「駒ヶ岳」）
function normalizeName(name, known) {
  if (known.has(name)) return name;
  const base = name.replace(/[（(].*?[)）]$/, "").trim();
  for (const cand of [base, base.replace(/ケ/g, "ヶ"), base.replace(/ヶ/g, "ケ")]) {
    if (known.has(cand)) return cand;
  }
  return null;
}

// 隣り合う駅を結ぶ線路網（路線をまたいで経路を探せるようにする）
function buildGraph(data) {
  const graph = new Map(); // 駅名 -> [{ to, line, path, km }]
  const add = (a, edge) => { if (!graph.has(a)) graph.set(a, []); graph.get(a).push(edge); };
  for (const line of data.lines) {
    for (const sec of line.sections) {
      for (let k = 0; k + 1 < sec.stations.length; k++) {
        const path = sec.path.slice(sec.stopIdx[k], sec.stopIdx[k + 1] + 1);
        let len = 0;
        for (let i = 1; i < path.length; i++) len += km(path[i - 1], path[i]);
        add(sec.stations[k], { to: sec.stations[k + 1], line: line.id, path, km: len });
        add(sec.stations[k + 1], { to: sec.stations[k], line: line.id, path: [...path].reverse(), km: len });
      }
    }
  }
  return graph;
}

// 2 駅間の最短経路を、点列・累積距離・各区間の路線 id にまとめる
function makeRouter(graph) {
  const cache = new Map();
  return (from, to) => {
    const key = `${from}|${to}`;
    if (cache.has(key)) return cache.get(key);
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const queue = [[0, from]];
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [d, u] = queue.shift();
      if (u === to) break;
      if (d > dist.get(u)) continue;
      for (const e of graph.get(u) || []) {
        const nd = d + e.km;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { from: u, edge: e });
          queue.push([nd, e.to]);
        }
      }
    }
    let route = null;
    if (from === to || prev.has(to)) {
      const edges = [];
      for (let v = to; v !== from; v = prev.get(v).from) edges.unshift(prev.get(v).edge);
      const pts = [], lines = [], cum = [];
      for (const e of edges) {
        e.path.forEach((p, i) => {
          if (pts.length && i === 0) return; // 駅の点は重複させない
          cum.push(pts.length ? cum[cum.length - 1] + km(pts[pts.length - 1], p) : 0);
          pts.push(p);
          lines.push(e.line); // pts[i-1]→pts[i] の区間が属する路線
        });
      }
      if (!pts.length) { pts.push([0, 0]); cum.push(0); lines.push(null); }
      route = { pts, cum, lines, total: cum[cum.length - 1] };
    }
    cache.set(key, route);
    return route;
  };
}

function pointOnRoute(route, d) {
  const { pts, cum, lines } = route;
  if (pts.length < 2) return { pos: pts[0], heading: 0, line: lines[0] };
  let k = 1;
  while (k < cum.length - 1 && cum[k] < d) k++;
  const a = pts[k - 1], b = pts[k];
  const seg = cum[k] - cum[k - 1];
  const f = seg > 0 ? Math.min(Math.max((d - cum[k - 1]) / seg, 0), 1) : 0;
  return { pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], heading: bearing(a, b), line: lines[k] };
}

export function createTimetableModel(data, timetable) {
  const known = new Set(data.stations.map((s) => s.name));
  const lineById = new Map(data.lines.map((l) => [l.id, l]));
  const route = makeRouter(buildGraph(data));
  const trains = [];
  const skipped = [];

  for (const raw of timetable) {
    const stops = raw.schedule.map((s) => ({
      name: normalizeName(s.station_name, known),
      label: s.station_name,
      arr: seconds(s.arrival_time),
      dep: seconds(s.departure_time),
    }));
    if (stops.some((s) => !s.name)) { skipped.push(raw.train_id); continue; }
    for (const s of stops) { s.arr ??= s.dep; s.dep ??= s.arr; }
    const legs = [];
    let ok = true;
    for (let i = 0; i + 1 < stops.length; i++) {
      const r = route(stops[i].name, stops[i + 1].name);
      if (!r) { ok = false; break; }
      legs.push(r);
    }
    if (!ok) { skipped.push(raw.train_id); continue; }
    const limited = LIMITED_EXPRESS.has(raw.train_type);
    trains.push({
      id: raw.train_id,
      type: limited ? `特急${raw.train_type}` : raw.train_type,
      dest: stops[stops.length - 1].name,
      stops,
      legs,
      start: stops[0].dep,
      end: stops[stops.length - 1].arr,
    });
  }
  if (skipped.length) console.warn("時刻表の駅を路線データで見つけられず、表示できない列車:", skipped);

  function locate(tr, t) {
    const { stops, legs } = tr;
    let i = 0;
    while (i + 1 < stops.length && stops[i + 1].arr <= t) i++;
    const cur = stops[i];
    const next = stops[i + 1] || null;
    let at, atStation = null;
    if (t <= cur.dep || !next) {
      atStation = cur.name;
      // 停車中は次の区間の向きで表示する
      const leg = legs[Math.min(i, legs.length - 1)];
      at = pointOnRoute(leg, next ? 0 : leg.total);
      if (next) at.heading = pointOnRoute(leg, Math.min(0.05, leg.total)).heading;
    } else {
      const leg = legs[i];
      const f = (t - cur.dep) / Math.max(next.arr - cur.dep, 1);
      at = pointOnRoute(leg, leg.total * f);
    }
    const lineId = at.line || legs[Math.min(i, legs.length - 1)].lines.find(Boolean);
    const line = lineById.get(lineId);
    return {
      id: `tt-${tr.id}`,
      real: true,
      number: tr.id,
      line: lineId,
      lineName: line?.name || "",
      color: line?.color || "#555",
      type: tr.type,
      dest: tr.dest,
      origin: stops[0].name,
      lat: at.pos[0],
      lng: at.pos[1],
      heading: at.heading,
      atStation,
      prev: atStation ? null : cur.name,
      next: next ? { name: next.name, time: formatTime(next.arr) } : null,
      departed: formatTime(tr.start),
    };
  }

  function trainsAt(now = Date.now()) {
    const t = jstSeconds(now);
    return trains.filter((tr) => t >= tr.start && t <= tr.end).map((tr) => locate(tr, t));
  }

  return { trainsAt, trainCount: trains.length, skipped };
}
