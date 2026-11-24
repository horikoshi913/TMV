// 北海道在来線路線図 — Google マップ / オフライン地図
import { createTrainModel, REFRESH_MS } from "./trains.js";
import { createTimetableModel } from "./timetable.js";
import { createGoogleView } from "./map-google.js";
import { createOfflineView } from "./map-offline.js";

const HOKKAIDO_CENTER = { lat: 43.35, lng: 142.6 };
const HOKKAIDO_BOUNDS = { north: 45.6, south: 41.3, west: 139.3, east: 145.9 };
const MAP_RESTRICTION = { north: 47.5, south: 39.5, west: 136.5, east: 149 };
const MIN_ZOOM = 6;
const KEY_STORAGE = "tmv.googleMapsApiKey";
const MODE_STORAGE = "tmv.mapMode"; // "offline" のときはオフライン地図を使う
const TIMETABLE_URL = "data/trains.json";
const TIMETABLE_LINES = ["hakodate"]; // 実際の時刻表で走らせる路線（デモ列車は出さない）

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  data: null,
  map: null, // 地図ビュー（map-google.js / map-offline.js）
  lineById: new Map(),
  stationByName: new Map(),
  polylines: new Map(), // lineId -> [路線ハンドル]
  markers: new Map(), // stationName -> マーカーハンドル
  visible: new Set(),
  focused: null, // フォーカス中の路線 id
  activeStation: null,
  trainModel: null, // デモ列車
  timetableModel: null, // 実際の時刻表の列車
  trainMarkers: new Map(), // train id -> マーカーハンドル
  trains: new Map(), // train id -> 最新の列車データ
  showTrains: true,
  infoTrain: null, // 情報ウィンドウに表示中の列車 id
  activeTrain: null,
};

// ---------- API キー ----------
function readStoredKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; }
}
function storeKey(k) {
  try { localStorage.setItem(KEY_STORAGE, k); } catch { /* 保存できなくても動作は継続 */ }
}
function resolveApiKey() {
  const params = new URLSearchParams(location.search);
  return params.get("key") || (window.APP_CONFIG || {}).googleMapsApiKey || readStoredKey();
}
function readMode() {
  try { return localStorage.getItem(MODE_STORAGE) || ""; } catch { return ""; }
}
function storeMode(mode) {
  try { mode ? localStorage.setItem(MODE_STORAGE, mode) : localStorage.removeItem(MODE_STORAGE); } catch { /* noop */ }
}
function wantsOffline() {
  const params = new URLSearchParams(location.search);
  if (params.has("offline")) return params.get("offline") !== "0";
  return (window.APP_CONFIG || {}).offline === true || readMode() === "offline";
}

// ---------- データ ----------
async function loadData() {
  const res = await fetch("data/hokkaido-rail.json");
  if (!res.ok) throw new Error(`データを読み込めませんでした (${res.status})`);
  const data = await res.json();
  state.data = data;
  for (const l of data.lines) state.lineById.set(l.id, l);
  for (const s of data.stations) state.stationByName.set(s.name, s);
  for (const l of data.lines) state.visible.add(l.id);
  return data;
}

function lineStopCount(line) {
  return new Set(line.sections.flatMap((s) => s.stations)).size;
}

// 路線ごとの前後の駅
function neighbours(stationName, line) {
  const out = [];
  for (const sec of line.sections) {
    const i = sec.stations.indexOf(stationName);
    if (i === -1) continue;
    out.push({ prev: sec.stations[i - 1], next: sec.stations[i + 1], section: sec });
  }
  return out;
}

// ---------- サイドパネル ----------
function swatch(color) {
  return `<span class="swatch" style="background:${color}"></span>`;
}

function renderPanel() {
  const { data } = state;
  const km = data.lines.reduce((sum, l) => sum + l.sections.reduce((a, s) => a + s.km, 0), 0);
  $("#summary").textContent = `${data.lines.length} 路線 · ${data.stations.length} 駅 · 約 ${Math.round(km)} km`;
  $("#source").textContent = `出典：${data.source}`;

  const list = $("#line-list");
  list.innerHTML = data.lines.map((l) => `
    <li class="line-item" data-line="${l.id}" style="--line-color:${l.color}">
      <div class="line-row">
        <input type="checkbox" checked aria-label="${esc(l.name)}を表示" data-toggle="${l.id}">
        <button class="line-name" data-focus="${l.id}" aria-expanded="false">
          <svg class="chev" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          ${swatch(l.color)}
          <span class="title">${esc(l.name)}</span>
          <span class="meta">${lineStopCount(l)} 駅</span>
        </button>
      </div>
      <div class="stations">
        ${l.nickname ? `<div class="section-title">愛称：${esc(l.nickname)}</div>` : ""}
        ${l.operator !== "JR北海道" ? `<div class="section-title">運営：${esc(l.operator)}</div>` : ""}
        ${l.sections.map((sec) => `
          <div class="section-title">${esc(sec.from)} – ${esc(sec.to)}（${sec.km} km）</div>
          <ol class="stop-list">
            ${sec.stations.map((name) => {
              const st = state.stationByName.get(name);
              const others = st.lines.filter((id) => id !== l.id);
              return `<li><button data-station="${esc(name)}" class="${others.length ? "transfer" : ""}">${esc(name)}
                ${others.length ? `<span class="mini-swatches" title="乗換">${others.map((id) => `<i style="background:${state.lineById.get(id).color}"></i>`).join("")}</span>` : ""}
              </button></li>`;
            }).join("")}
          </ol>`).join("")}
      </div>
    </li>`).join("");

  list.addEventListener("change", (e) => {
    const id = e.target.dataset.toggle;
    if (id) setLineVisible(id, e.target.checked);
  });
  list.addEventListener("click", (e) => {
    const stBtn = e.target.closest("[data-station]");
    if (stBtn) return selectStation(stBtn.dataset.station);
    const lineBtn = e.target.closest("[data-focus]");
    if (lineBtn) toggleFocus(lineBtn.dataset.focus);
  });

  $("#show-all").addEventListener("click", () => setAllVisible(true));
  $("#hide-all").addEventListener("click", () => setAllVisible(false));

  const panel = $("#panel");
  $("#panel-toggle").addEventListener("click", () => {
    const collapsed = panel.classList.toggle("collapsed");
    $("#panel-toggle").setAttribute("aria-expanded", String(!collapsed));
    $("#panel-toggle").setAttribute("aria-label", collapsed ? "パネルを開く" : "パネルを閉じる");
  });

  setupSearch();
}

function setupSearch() {
  const input = $("#search");
  const results = $("#search-results");
  const render = () => {
    const q = input.value.trim();
    if (!q) { results.hidden = true; return; }
    // 完全一致 → 前方一致 → 部分一致 の順
    const rank = (s) => (s.name === q ? 0 : s.name.startsWith(q) ? 1 : 2);
    const hits = state.data.stations
      .filter((s) => s.name.includes(q))
      .sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length)
      .slice(0, 30);
    results.innerHTML = hits.length
      ? hits.map((s) => `<li><button data-station="${esc(s.name)}">
          <span class="mini-swatches">${s.lines.map((id) => `<i style="background:${state.lineById.get(id).color}"></i>`).join("")}</span>
          <span>${esc(s.name)}</span>
          <span class="muted" style="margin-left:auto;font-size:12px">${s.lines.map((id) => esc(state.lineById.get(id).name)).join("・")}</span>
        </button></li>`).join("")
      : `<li class="empty">「${esc(q)}」に一致する駅はありません</li>`;
    results.hidden = false;
  };
  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = results.querySelector("[data-station]");
      if (first) { first.click(); }
    } else if (e.key === "Escape") {
      results.hidden = true;
    }
  });
  results.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-station]");
    if (!btn) return;
    results.hidden = true;
    input.value = btn.dataset.station;
    selectStation(btn.dataset.station);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) results.hidden = true;
  });
}

// ---------- 地図 ----------
function initMap(view) {
  state.map = view;
  view.onInfoClose(() => { setActiveStation(null); setActiveTrain(null); });

  for (const line of state.data.lines) {
    state.polylines.set(line.id, line.paths.map((path) =>
      view.addLine({ path, color: line.color, onClick: () => toggleFocus(line.id, true) })));
  }

  for (const st of state.data.stations) {
    const el = document.createElement("div");
    el.className = "stn" + (st.lines.length > 1 ? " transfer" : "");
    el.style.setProperty("--c", state.lineById.get(st.lines[0]).color);
    el.innerHTML = `<span class="dot"></span><span class="label">${esc(st.name)}</span>`;
    const marker = view.addMarker({
      lat: st.lat,
      lng: st.lng,
      el,
      title: st.name,
      zIndex: st.lines.length > 1 ? 20 : 10,
      onClick: () => selectStation(st.name, { pan: false }),
    });
    state.markers.set(st.name, marker);
  }

  const updateZoomClass = () => {
    const z = state.map.getZoom();
    const m = $("#map");
    m.classList.toggle("z-major", z >= 9);
    m.classList.toggle("z-all", z >= 11);
  };
  view.onZoom(updateZoomClass);
  updateZoomClass();
}

function stationVisible(st) {
  return st.lines.some((id) => state.visible.has(id));
}

function refreshStyles() {
  for (const [id, pls] of state.polylines) {
    const style = {
      visible: state.visible.has(id),
      dim: !!state.focused && state.focused !== id,
      raised: state.focused === id,
    };
    for (const pl of pls) pl.setStyle(style);
  }
  for (const st of state.data.stations) {
    const marker = state.markers.get(st.name);
    if (!marker) continue;
    marker.setVisible(stationVisible(st));
    marker.el.classList.toggle("dimmed", !!state.focused && !st.lines.includes(state.focused));
  }
  updateTrainStyles();
  for (const li of document.querySelectorAll(".line-item")) {
    li.classList.toggle("hidden-line", !state.visible.has(li.dataset.line));
  }
}

function setLineVisible(id, on) {
  on ? state.visible.add(id) : state.visible.delete(id);
  if (!on && state.focused === id) state.focused = null;
  const cb = document.querySelector(`[data-toggle="${id}"]`);
  if (cb) cb.checked = on;
  if (state.map) refreshStyles();
}

function setAllVisible(on) {
  for (const l of state.data.lines) setLineVisible(l.id, on);
}

function fitLine(line) {
  const b = { north: -90, south: 90, west: 180, east: -180 };
  for (const path of line.paths) {
    for (const [lat, lng] of path) {
      b.north = Math.max(b.north, lat); b.south = Math.min(b.south, lat);
      b.east = Math.max(b.east, lng); b.west = Math.min(b.west, lng);
    }
  }
  state.map.fitBounds(b, 48);
}

function toggleFocus(id, fromMap = false) {
  const li = document.querySelector(`.line-item[data-line="${id}"]`);
  const opening = state.focused !== id;
  document.querySelectorAll(".line-item.open").forEach((el) => {
    el.classList.remove("open");
    el.querySelector("[data-focus]").setAttribute("aria-expanded", "false");
  });
  state.focused = opening ? id : null;
  if (opening) {
    if (!state.visible.has(id)) setLineVisible(id, true);
    li.classList.add("open");
    li.querySelector("[data-focus]").setAttribute("aria-expanded", "true");
    if (fromMap) li.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (state.map) fitLine(state.lineById.get(id));
  }
  if (state.map) refreshStyles();
}

function setActiveStation(name) {
  if (state.activeStation) state.markers.get(state.activeStation)?.el.classList.remove("active");
  state.activeStation = name;
  if (name) state.markers.get(name)?.el.classList.add("active");
}

function selectStation(name, { pan = true } = {}) {
  const st = state.stationByName.get(name);
  if (!st || !state.map) return;
  // 非表示路線の駅なら、その路線を表示する
  if (!stationVisible(st)) st.lines.forEach((id) => setLineVisible(id, true));
  setActiveStation(name);
  setActiveTrain(null);
  const rows = st.lines.map((id) => {
    const line = state.lineById.get(id);
    const adj = neighbours(name, line).map(({ prev, next }) =>
      `${prev ? esc(prev) : "（起点）"} ← → ${next ? esc(next) : "（終点）"}`).join("<br>");
    return `<li>${swatch(line.color)}<div><strong>${esc(line.name)}</strong>${line.nickname ? `（${esc(line.nickname)}）` : ""}<div class="adj">${adj}</div></div></li>`;
  }).join("");
  const box = document.createElement("div");
  box.className = "iw";
  box.innerHTML = `<h3>${esc(name)}駅</h3><ul>${rows}</ul>`;
  state.map.openInfo(box, state.markers.get(name));
  if (pan) {
    if (state.map.getZoom() < 11) state.map.setZoom(11);
    state.map.panTo(st.lat, st.lng);
  }
  // スマホでは地図が見えるようにパネルを畳む
  if (matchMedia("(max-width: 720px)").matches) {
    $("#panel").classList.add("collapsed");
    $("#panel-toggle").setAttribute("aria-expanded", "false");
  }
}

// ---------- 列車（デモ） ----------
function trainIcon(color, heading) {
  // 路線色の丸に電車アイコン、外側の三角で進行方向を示す
  return `<svg viewBox="0 0 40 40" width="36" height="36">
    <g transform="rotate(${heading.toFixed(0)} 20 20)">
      <circle cx="20" cy="20" r="18" fill="${color}" opacity=".28"/>
      <path d="M20 1 L26 9 L14 9 Z" fill="${color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
    </g>
    <circle cx="20" cy="20" r="12.5" fill="${color}" stroke="#fff" stroke-width="2.5"/>
    <rect x="14.5" y="12.5" width="11" height="13" rx="3" fill="#fff"/>
    <rect x="16.3" y="14.5" width="7.4" height="4.5" rx="1" fill="${color}"/>
    <circle cx="17.3" cy="22.4" r="1.1" fill="${color}"/>
    <circle cx="22.7" cy="22.4" r="1.1" fill="${color}"/>
    <path d="M16 28 L17.5 25.5 M24 28 L22.5 25.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
}

function trainContent(tr) {
  const rows = [
    `<div class="row">${esc(tr.lineName)}・列車番号 ${esc(tr.number)}</div>`,
    `<div class="row">${esc(tr.origin)} ${esc(tr.departed)} 発</div>`,
    tr.atStation
      ? `<div class="row"><strong>${esc(tr.atStation)}</strong> に停車中${tr.next ? `（次は ${esc(tr.next.name)} ${esc(tr.next.time)} 着）` : ""}</div>`
      : `<div class="row">${esc(tr.prev)} → <strong>${esc(tr.next.name)}</strong>（${esc(tr.next.time)} 着予定）</div>`,
  ];
  const box = document.createElement("div");
  box.className = "iw";
  const badge = tr.real ? `<span class="tt-badge">時刻表</span>` : `<span class="demo-badge">デモ</span>`;
  box.innerHTML = `<h3>${swatch(tr.color)} ${esc(tr.type)} ${esc(tr.dest)}行${badge}</h3>${rows.join("")}`;
  return box;
}

function setActiveTrain(id) {
  if (state.activeTrain) state.trainMarkers.get(state.activeTrain)?.el.classList.remove("active");
  state.activeTrain = id;
  state.infoTrain = id;
  if (id) state.trainMarkers.get(id)?.el.classList.add("active");
}

function openTrainInfo(id) {
  const tr = state.trains.get(id);
  if (!tr) return;
  setActiveStation(null);
  setActiveTrain(id);
  state.map.openInfo(trainContent(tr), state.trainMarkers.get(id));
}

function trainShown(tr) {
  return state.showTrains && state.visible.has(tr.line);
}

function updateTrainStyles() {
  for (const [id, marker] of state.trainMarkers) {
    const tr = state.trains.get(id);
    marker.setVisible(!!tr && trainShown(tr));
    marker.el.classList.toggle("dimmed", !!state.focused && tr?.line !== state.focused);
  }
}

function updateTrains() {
  const now = Date.now();
  const list = [...state.trainModel.trainsAt(now), ...(state.timetableModel?.trainsAt(now) || [])];
  const seen = new Set();
  state.trains = new Map(list.map((tr) => [tr.id, tr]));
  for (const tr of list) {
    seen.add(tr.id);
    let marker = state.trainMarkers.get(tr.id);
    if (!marker) {
      const el = document.createElement("div");
      el.className = "train";
      marker = state.map.addMarker({ lat: tr.lat, lng: tr.lng, el, zIndex: 30, visible: false, onClick: () => openTrainInfo(tr.id) });
      state.trainMarkers.set(tr.id, marker);
    }
    marker.setPosition(tr.lat, tr.lng);
    marker.setTitle(`${tr.type} ${tr.dest}行（${tr.number}）`);
    marker.el.innerHTML = trainIcon(tr.color, tr.heading);
    marker.el.classList.toggle("real", !!tr.real);
  }
  // 終着した列車を消す
  for (const [id, marker] of state.trainMarkers) {
    if (seen.has(id)) continue;
    marker.remove();
    state.trainMarkers.delete(id);
    if (state.infoTrain === id) { state.map.closeInfo(); setActiveTrain(null); }
  }
  // 表示中の列車の情報を更新
  if (state.infoTrain && state.trains.has(state.infoTrain)) {
    state.map.setInfoContent(trainContent(state.trains.get(state.infoTrain)));
  }
  updateTrainStyles();
  const shown = list.filter(trainShown);
  const real = shown.filter((tr) => tr.real).length;
  const clock = new Date(now).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
  $("#train-status").textContent = list.length
    ? `運行中 ${shown.length} 本（うち時刻表 ${real} 本） · 最終更新 ${clock}`
    : `現在運行中の列車はありません（6:00〜24:00 頃に運行） · 最終更新 ${clock}`;
}

// 実際の時刻表。読み込めなければデモ列車だけで続ける
async function loadTimetable() {
  try {
    const res = await fetch(TIMETABLE_URL);
    if (!res.ok) throw new Error(res.status);
    return createTimetableModel(state.data, await res.json());
  } catch (e) {
    console.warn("時刻表を読み込めませんでした", e);
    return null;
  }
}

async function initTrains() {
  state.timetableModel = await loadTimetable();
  state.trainModel = createTrainModel(state.data, { excludeLines: state.timetableModel ? TIMETABLE_LINES : [] });
  $("#train-toggle").addEventListener("change", (e) => {
    state.showTrains = e.target.checked;
    if (!state.showTrains && state.infoTrain) { state.map.closeInfo(); setActiveTrain(null); }
    updateTrainStyles();
  });
  updateTrains();
  setInterval(updateTrains, REFRESH_MS);
}

// ---------- 起動 ----------
function askForKey(message) {
  const setup = $("#key-setup");
  setup.hidden = false;
  const err = $("#key-error");
  if (message) { err.textContent = message; err.hidden = false; }
  $("#key-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const k = $("#key-input").value.trim();
    if (!k) return;
    storeKey(k);
    storeMode("");
    location.reload();
  }, { once: true });
}

function showNotice(text) {
  const n = $("#map-notice");
  n.textContent = text;
  n.hidden = false;
  setTimeout(() => { n.hidden = true; }, 8000);
}

// ?offline パラメータを外して読み込み直す（Google マップに戻すとき）
function reloadWithoutOfflineParam() {
  const url = new URL(location.href);
  url.searchParams.delete("offline");
  location.replace(url);
}

function startMap(view) {
  initMap(view);
  initTrains();
  refreshStyles();
}

async function startOffline(notice) {
  $("#key-setup").hidden = true;
  const view = await createOfflineView($("#map"), {
    center: HOKKAIDO_CENTER,
    bounds: HOKKAIDO_BOUNDS,
    restriction: MAP_RESTRICTION,
    minZoom: MIN_ZOOM,
    landUrl: "data/hokkaido-land.json",
    onSwitchToGoogle: () => { storeMode(""); reloadWithoutOfflineParam(); },
  });
  startMap(view);
  if (notice) showNotice(notice);
}

async function main() {
  try {
    await loadData();
  } catch (e) {
    $("#summary").textContent = e.message;
    return;
  }
  renderPanel();

  $("#use-offline").addEventListener("click", () => {
    storeMode("offline");
    // Google マップを読み込み済み（認証エラー後など）なら作り直す
    if (state.map) location.reload();
    else startOffline();
  });

  if (wantsOffline()) return startOffline();

  const key = resolveApiKey();
  if (!key) return askForKey();
  // キーが無効・リファラー不許可のとき Google が呼び出す
  window.gm_authFailure = () => {
    try { localStorage.removeItem(KEY_STORAGE); } catch { /* noop */ }
    askForKey("API キーが無効か、Maps JavaScript API が有効になっていないか、この URL が許可されていません（HTTP リファラー制限）。");
  };
  let view;
  try {
    view = await createGoogleView($("#map"), {
      key,
      mapId: (window.APP_CONFIG || {}).mapId,
      center: HOKKAIDO_CENTER,
      bounds: HOKKAIDO_BOUNDS,
      restriction: MAP_RESTRICTION,
      minZoom: MIN_ZOOM,
    });
  } catch {
    // ネットワークに繋がらないなどで読み込めないときはオフライン地図で続ける
    return startOffline("Google マップを読み込めなかったため、オフライン地図で表示しています。");
  }
  startMap(view);
}

main();
