// デモ用の仮想列車。
// 実際の時刻表・走行位置ではなく、下の SERVICES に定めた一定間隔のダイヤから
// 現在時刻（日本時間）の位置を計算して表示する。

export const REFRESH_MS = 10_000;

// 運転系統: 路線 id, 区間の起点・終点駅, 運転間隔(分), 種別
const SERVICES = [
  { line: "hakodate", from: "函館", to: "長万部", every: 60, type: "普通" },
  { line: "hakodate", from: "長万部", to: "小樽", every: 120, type: "普通" },
  { line: "hakodate", from: "小樽", to: "岩見沢", every: 15, type: "普通" },
  { line: "hakodate", from: "岩見沢", to: "旭川", every: 30, type: "普通" },
  { line: "hakodate", from: "大沼", to: "森", every: 180, type: "普通" },
  { line: "muroran", from: "長万部", to: "東室蘭", every: 90, type: "普通" },
  { line: "muroran", from: "東室蘭", to: "苫小牧", every: 60, type: "普通" },
  { line: "muroran", from: "苫小牧", to: "岩見沢", every: 120, type: "普通" },
  { line: "muroran", from: "東室蘭", to: "室蘭", every: 30, type: "普通" },
  { line: "chitose", from: "白石", to: "沼ノ端", every: 20, type: "普通" },
  { line: "chitose", from: "南千歳", to: "新千歳空港", every: 15, type: "快速" },
  { line: "sassho", from: "桑園", to: "北海道医療大学", every: 30, type: "普通" },
  { line: "sekisho", from: "南千歳", to: "新得", every: 120, type: "特急" },
  { line: "nemuro", from: "滝川", to: "富良野", every: 120, type: "普通" },
  { line: "nemuro", from: "新得", to: "帯広", every: 60, type: "普通" },
  { line: "nemuro", from: "帯広", to: "釧路", every: 90, type: "普通" },
  { line: "nemuro", from: "釧路", to: "根室", every: 240, type: "普通" },
  { line: "furano", from: "旭川", to: "富良野", every: 60, type: "普通" },
  { line: "soya", from: "旭川", to: "名寄", every: 60, type: "普通" },
  { line: "soya", from: "名寄", to: "稚内", every: 240, type: "普通" },
  { line: "sekihoku", from: "新旭川", to: "上川", every: 120, type: "普通" },
  { line: "sekihoku", from: "上川", to: "網走", every: 180, type: "特急" },
  { line: "senmo", from: "網走", to: "東釧路", every: 180, type: "普通" },
  { line: "hidaka", from: "苫小牧", to: "鵡川", every: 120, type: "普通" },
  { line: "isaribi", from: "五稜郭", to: "木古内", every: 60, type: "普通" },
];

// 種別ごとの走行速度 (km/h, 駅間の平均) と停車時間 (秒)
const TYPES = {
  普通: { speed: 60, dwell: 30, stopsAll: true },
  快速: { speed: 75, dwell: 30, stopsAll: true },
  特急: { speed: 100, dwell: 60, stopsAll: true },
};

const FIRST_DEP = 6 * 3600; // 始発 6:00
const LAST_DEP = 22 * 3600; // 最終 22:00

// ---------- 幾何計算 ----------
function km(a, b) {
  const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dx = (a[1] - b[1]) * 111.32 * Math.cos(lat);
  const dy = (a[0] - b[0]) * 110.57;
  return Math.hypot(dx, dy);
}

function bearing(a, b) {
  const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dx = (b[1] - a[1]) * Math.cos(lat);
  const dy = b[0] - a[0];
  return (Math.atan2(dx, dy) * 180) / Math.PI; // 北が 0°、時計回り
}

// 系統ごとに、軌跡・駅の距離・発着時刻（起点からの秒数）を前計算する
function buildService(svc, line, index) {
  for (const sec of line.sections) {
    const i = sec.stations.indexOf(svc.from);
    const j = sec.stations.indexOf(svc.to);
    if (i === -1 || j === -1) continue;
    const [a, b] = i < j ? [i, j] : [j, i];
    const path = sec.path.slice(sec.stopIdx[a], sec.stopIdx[b] + 1);
    const cum = [0];
    for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + km(path[k - 1], path[k]));
    const stops = sec.stations.slice(a, b + 1).map((name, k) => ({
      name,
      d: cum[sec.stopIdx[a + k] - sec.stopIdx[a]],
    }));
    const t = TYPES[svc.type];
    return { ...svc, index, color: line.color, lineName: line.name, path, cum, stops, total: cum[cum.length - 1], t };
  }
  console.warn("系統の区間が見つかりません", svc);
  return null;
}

// 方向 dir (0: from→to, 1: to→from) の各駅の着・発時刻（起点発からの秒）
function timetable(s, dir) {
  const stops = dir === 0 ? s.stops : [...s.stops].reverse().map((x) => ({ name: x.name, d: s.total - x.d }));
  const out = [];
  let time = 0;
  stops.forEach((st, k) => {
    if (k > 0) time += ((st.d - stops[k - 1].d) / s.t.speed) * 3600;
    const arr = time;
    if (k > 0 && k < stops.length - 1) time += s.t.dwell;
    out.push({ name: st.name, d: st.d, arr, dep: time });
  });
  return out;
}

function pointAt(s, dir, dist) {
  const d = dir === 0 ? dist : s.total - dist;
  let k = 1;
  while (k < s.cum.length - 1 && s.cum[k] < d) k++;
  const a = s.path[k - 1], b = s.path[k];
  const seg = s.cum[k] - s.cum[k - 1];
  const f = seg > 0 ? Math.min(Math.max((d - s.cum[k - 1]) / seg, 0), 1) : 0;
  const pos = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  return { pos, heading: dir === 0 ? bearing(a, b) : bearing(b, a) };
}

// 日本時間の 0 時からの秒数
export function jstSeconds(now = Date.now()) {
  return ((now / 1000 + 9 * 3600) % 86400 + 86400) % 86400;
}

export function formatTime(sec) {
  sec = ((Math.round(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function createTrainModel(data) {
  const lineById = new Map(data.lines.map((l) => [l.id, l]));
  const services = SERVICES.map((s, i) => buildService(s, lineById.get(s.line), i)).filter(Boolean);
  const tables = new Map();
  for (const s of services) tables.set(s.index, [timetable(s, 0), timetable(s, 1)]);

  // 現在走行中の全列車
  function trainsAt(now = Date.now()) {
    const t = jstSeconds(now);
    const out = [];
    for (const s of services) {
      const every = s.every * 60;
      // 系統ごとに発車時刻をずらす（毎回同じ値になる決定的なずらし）
      const offset = ((s.index * 7) % s.every) * 60;
      for (const dir of [0, 1]) {
        const tt = tables.get(s.index)[dir];
        const runTime = tt[tt.length - 1].arr;
        const dirOffset = dir === 1 ? Math.floor(every / 2) : 0;
        for (let dep = FIRST_DEP + offset + dirOffset; dep <= LAST_DEP + offset + dirOffset; dep += every) {
          const tau = t - dep;
          if (tau < 0 || tau > runTime) continue;
          out.push(locate(s, dir, tt, dep, tau));
        }
      }
    }
    return out;
  }

  function locate(s, dir, tt, dep, tau) {
    let k = 0;
    while (k < tt.length - 1 && tt[k + 1].arr <= tau) k++;
    const cur = tt[k];
    let dist, atStation = null, next = tt[k + 1] || null;
    if (tau <= cur.dep || !next) {
      dist = cur.d; // 停車中
      atStation = cur.name;
      if (!next) next = null;
    } else {
      const f = (tau - cur.dep) / (next.arr - cur.dep);
      dist = cur.d + (next.d - cur.d) * f;
    }
    // 向きを出すため、停車中は少し先の地点で計算
    const { pos, heading } = pointAt(s, dir, Math.min(dist + (atStation && next ? 0.05 : 0), s.total));
    const trip = Math.round((dep - FIRST_DEP) / 60);
    const no = (s.index + 1) * 1000 + (trip % 1000) * 2 + (dir === 0 ? 1 : 2);
    return {
      id: `${s.index}-${dir}-${dep}`,
      number: `${no % 10000}${s.type === "特急" ? "D" : "M"}`,
      line: s.line,
      lineName: s.lineName,
      color: s.color,
      type: s.type,
      dest: tt[tt.length - 1].name,
      origin: tt[0].name,
      lat: pos[0],
      lng: pos[1],
      heading,
      atStation,
      prev: atStation ? null : cur.name,
      next: next ? { name: next.name, time: formatTime(dep + next.arr) } : null,
      departed: formatTime(dep),
    };
  }

  return { trainsAt, serviceCount: services.length };
}
