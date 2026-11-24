// API キー不要・外部通信なしで動くオフライン地図ビュー。
// 海岸線（data/hokkaido-land.json）と路線を SVG で描き、駅・列車は HTML 要素で重ねる。
// 座標は Web メルカトル（Google マップと同じズームレベル体系）。

const TILE = 256;
const MAX_ZOOM = 15;
const DRAG_THRESHOLD = 5; // px — これ以上動いたらクリックではなくドラッグ

function worldXY(lat, lng) {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [((lng + 180) / 360) * TILE, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE];
}

const SVG_NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

export async function createOfflineView(container, { center, bounds, restriction, minZoom, landUrl, onSwitchToGoogle }) {
  // 大きな座標値での SVG の精度落ちを避けるため、北海道中心からの相対座標で持つ
  const [ox, oy] = worldXY(center.lat, center.lng);
  const rel = (lat, lng) => { const [x, y] = worldXY(lat, lng); return [x - ox, y - oy]; };
  const pathD = (pts, digits) => pts.map(([lat, lng], i) => {
    const [x, y] = rel(lat, lng);
    return `${i ? "L" : "M"}${x.toFixed(digits)} ${y.toFixed(digits)}`;
  }).join("");

  container.classList.add("offline-map");
  container.innerHTML = `
    <svg class="om-svg" aria-hidden="true">
      <g class="om-world"><path class="om-land"/><g class="om-lines"></g></g>
    </svg>
    <div class="om-markers"></div>
    <div class="om-info" hidden role="dialog">
      <button type="button" class="om-info-close" aria-label="閉じる">×</button>
      <div class="om-info-body"></div>
    </div>
    <div class="om-zoom">
      <button type="button" data-zoom="1" aria-label="拡大">+</button>
      <button type="button" data-zoom="-1" aria-label="縮小">−</button>
    </div>
    ${onSwitchToGoogle ? `<button type="button" class="om-switch">Google マップで表示</button>` : ""}
    <div class="om-attrib">オフライン地図 · 海岸線: Natural Earth</div>`;
  const svg = container.querySelector(".om-svg");
  const world = container.querySelector(".om-world");
  const linesG = container.querySelector(".om-lines");
  const markersDiv = container.querySelector(".om-markers");
  const infoDiv = container.querySelector(".om-info");
  const infoBody = container.querySelector(".om-info-body");

  // 海岸線。読み込めなくても路線だけで表示を続ける
  try {
    const land = await (await fetch(landUrl)).json();
    container.querySelector(".om-land").setAttribute("d", land.rings.map((r) => pathD(r, 4) + "Z").join(""));
  } catch (e) {
    console.warn("海岸線データを読み込めませんでした", e);
  }

  // ---------- 表示状態 ----------
  let zoom = 7;
  let cx = 0, cy = 0; // 画面中心（相対ワールド座標）
  let width = 0, height = 0;
  const [rx1, ry1] = rel(restriction.north, restriction.west);
  const [rx2, ry2] = rel(restriction.south, restriction.east);
  const markers = new Set();
  const zoomListeners = [];
  let infoAnchor = null;
  let infoCloseCb = () => {};
  let frame = 0;

  const scale = () => 2 ** zoom;
  const toScreen = (x, y) => [(x - cx) * scale() + width / 2, (y - cy) * scale() + height / 2];
  const toWorld = (sx, sy) => [cx + (sx - width / 2) / scale(), cy + (sy - height / 2) / scale()];

  function clampView() {
    zoom = Math.max(minZoom, Math.min(MAX_ZOOM, zoom));
    cx = Math.max(rx1, Math.min(rx2, cx));
    cy = Math.max(ry1, Math.min(ry2, cy));
  }

  function render() {
    frame = 0;
    const s = scale();
    world.setAttribute("transform", `translate(${width / 2 - cx * s} ${height / 2 - cy * s}) scale(${s})`);
    for (const m of markers) placeMarker(m);
    placeInfo();
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };

  function setView(nx, ny, nz) {
    const before = zoom;
    cx = nx; cy = ny; zoom = nz;
    clampView();
    schedule();
    if (zoom !== before) zoomListeners.forEach((cb) => cb());
  }

  function zoomAround(sx, sy, nz) {
    const [wx, wy] = toWorld(sx, sy);
    nz = Math.max(minZoom, Math.min(MAX_ZOOM, nz));
    const s = 2 ** nz;
    setView(wx - (sx - width / 2) / s, wy - (sy - height / 2) / s, nz);
  }

  function placeMarker(m) {
    if (!m.visible) return;
    const [sx, sy] = toScreen(m.x, m.y);
    const off = sx < -100 || sy < -100 || sx > width + 100 || sy > height + 100;
    m.wrap.style.display = off ? "none" : "";
    if (!off) m.wrap.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
  }

  function placeInfo() {
    if (!infoAnchor || infoDiv.hidden) return;
    const [sx, sy] = toScreen(infoAnchor.x, infoAnchor.y);
    // マーカーは下端中央が座標。その上に吹き出しを出す
    const h = infoAnchor.el.getBoundingClientRect().height || 0;
    infoDiv.style.transform = `translate(${sx.toFixed(1)}px, ${(sy - h - 10).toFixed(1)}px) translate(-50%, -100%)`;
  }

  new ResizeObserver(() => {
    width = container.clientWidth;
    height = container.clientHeight;
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    schedule();
  }).observe(container);
  width = container.clientWidth;
  height = container.clientHeight;

  // ---------- 操作（ドラッグ・ピンチ・ホイール） ----------
  const pointers = new Map();
  let gesture = null; // { x, y, dist, moved }
  let suppressClick = false;
  const isUi = (t) => t.closest(".om-info, .om-zoom, .om-switch");

  const centroid = () => {
    const ps = [...pointers.values()];
    const x = ps.reduce((a, p) => a + p.x, 0) / ps.length;
    const y = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    const dist = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    return { x, y, dist };
  };
  const local = (e) => { const r = container.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  container.addEventListener("pointerdown", (e) => {
    if (isUi(e.target) || (e.pointerType === "mouse" && e.button !== 0)) return;
    pointers.set(e.pointerId, local(e));
    gesture = { ...centroid(), moved: gesture?.moved || false };
  });
  container.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    const c = centroid();
    if (!gesture.moved && Math.hypot(c.x - gesture.x, c.y - gesture.y) < DRAG_THRESHOLD && pointers.size < 2) return;
    if (!gesture.moved) {
      gesture.moved = true;
      container.classList.add("dragging");
      // ドラッグが始まってからキャプチャする（クリックの対象を変えないため）
      for (const id of pointers.keys()) try { container.setPointerCapture(id); } catch { /* noop */ }
    }
    const s = scale();
    let nz = zoom;
    if (pointers.size > 1 && gesture.dist > 0 && c.dist > 0) nz = zoom + Math.log2(c.dist / gesture.dist);
    // 指の重心の下の地点を保ったまま移動・拡大
    const [wx, wy] = [cx + (gesture.x - width / 2) / s, cy + (gesture.y - height / 2) / s];
    nz = Math.max(minZoom, Math.min(MAX_ZOOM, nz));
    const ns = 2 ** nz;
    setView(wx - (c.x - width / 2) / ns, wy - (c.y - height / 2) / ns, nz);
    gesture = { ...c, moved: true };
  });
  const endPointer = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (gesture?.moved) suppressClick = true;
    if (pointers.size) gesture = { ...centroid(), moved: gesture.moved };
    else { gesture = null; container.classList.remove("dragging"); setTimeout(() => { suppressClick = false; }, 0); }
  };
  container.addEventListener("pointerup", endPointer);
  container.addEventListener("pointercancel", endPointer);
  // ドラッグ直後のクリック（駅・列車・路線の選択）を無視する
  container.addEventListener("click", (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);

  container.addEventListener("wheel", (e) => {
    if (isUi(e.target)) return;
    e.preventDefault();
    const p = local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoomAround(p.x, p.y, zoom - Math.max(-1, Math.min(1, delta / 250)));
  }, { passive: false });

  container.addEventListener("dblclick", (e) => {
    if (isUi(e.target) || e.target.closest(".om-mk")) return;
    const p = local(e);
    zoomAround(p.x, p.y, Math.round(zoom) + (e.shiftKey ? -1 : 1));
  });

  container.querySelector(".om-zoom").addEventListener("click", (e) => {
    const b = e.target.closest("[data-zoom]");
    if (b) zoomAround(width / 2, height / 2, Math.round(zoom) + Number(b.dataset.zoom));
  });
  container.querySelector(".om-switch")?.addEventListener("click", onSwitchToGoogle);
  container.querySelector(".om-info-close").addEventListener("click", () => {
    infoDiv.hidden = true;
    infoAnchor = null;
    infoCloseCb();
  });

  // ---------- 公開インターフェース（map-google.js と同じ） ----------
  const view = {
    kind: "offline",

    addLine({ path, color, onClick }) {
      const d = pathD(path, 6);
      const casing = svgEl("path", { d, class: "om-casing" });
      const stroke = svgEl("path", { d, class: "om-stroke", stroke: color });
      if (onClick) stroke.addEventListener("click", onClick);
      const g = svgEl("g");
      g.append(casing, stroke);
      linesG.append(g);
      return {
        setStyle({ visible, dim, raised }) {
          g.style.display = visible ? "" : "none";
          casing.style.opacity = dim ? 0.3 : 0.9;
          stroke.style.opacity = dim ? 0.25 : 1;
          if (raised) linesG.append(g); // 最前面へ
        },
      };
    },

    addMarker({ lat, lng, el, zIndex = 0, title, onClick, visible = true }) {
      const wrap = document.createElement("div");
      wrap.className = "om-mk";
      wrap.style.zIndex = zIndex;
      const inner = document.createElement("div");
      inner.className = "om-mk-anchor";
      inner.append(el);
      wrap.append(inner);
      if (title) wrap.title = title;
      if (onClick) wrap.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
      const [x, y] = rel(lat, lng);
      const m = { el, wrap, x, y, visible };
      wrap.style.display = visible ? "" : "none";
      markersDiv.append(wrap);
      markers.add(m);
      placeMarker(m);
      return {
        el,
        anchor: m,
        setPosition(lat, lng) { [m.x, m.y] = rel(lat, lng); placeMarker(m); if (infoAnchor === m) placeInfo(); },
        setTitle(t) { wrap.title = t; },
        setVisible(v) { m.visible = v; wrap.style.display = v ? "" : "none"; if (v) placeMarker(m); },
        remove() { markers.delete(m); wrap.remove(); },
      };
    },

    openInfo(content, marker) {
      infoBody.replaceChildren(content);
      infoAnchor = marker.anchor;
      infoDiv.hidden = false;
      placeInfo();
    },
    setInfoContent(content) { infoBody.replaceChildren(content); placeInfo(); },
    closeInfo() { infoDiv.hidden = true; infoAnchor = null; },
    onInfoClose(cb) { infoCloseCb = cb; },

    fitBounds(b, padding = 0) {
      const [x1, y1] = rel(b.north, b.west);
      const [x2, y2] = rel(b.south, b.east);
      const w = Math.max(1, width - padding * 2);
      const h = Math.max(1, height - padding * 2);
      const z = Math.log2(Math.min(w / Math.max(x2 - x1, 1e-9), h / Math.max(y2 - y1, 1e-9)));
      setView((x1 + x2) / 2, (y1 + y2) / 2, Math.min(z, MAX_ZOOM));
    },
    getZoom() { return zoom; },
    setZoom(z) { setView(cx, cy, z); },
    panTo(lat, lng) { const [x, y] = rel(lat, lng); setView(x, y, zoom); },
    onZoom(cb) { zoomListeners.push(cb); },
  };

  view.fitBounds(bounds, 0);
  render();
  return view;
}
