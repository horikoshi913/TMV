// Google Maps JavaScript API を使う地図ビュー。
// app.js からは map-offline.js と同じインターフェースで使う。

// Google 公式の動的ローダー (https://developers.google.com/maps/documentation/javascript/load-maps-js-api)
function loadGoogleMaps(key) {
  return new Promise((resolve, reject) => {
    ((g) => {
      var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window;
      b = b[c] || (b[c] = {});
      var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams,
        u = () => h || (h = new Promise(async (f, n) => {
          await (a = m.createElement("script"));
          e.set("libraries", [...r] + "");
          for (k in g) e.set(k.replace(/[A-Z]/g, (t) => "_" + t[0].toLowerCase()), g[k]);
          e.set("callback", c + ".maps." + q);
          a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
          d[q] = f;
          a.onerror = () => h = n(Error(p + " could not load."));
          a.nonce = m.querySelector("script[nonce]")?.nonce || "";
          m.head.append(a);
        }));
      d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n));
    })({ key, v: "weekly", language: "ja", region: "JP" });
    Promise.all([google.maps.importLibrary("maps"), google.maps.importLibrary("marker"), google.maps.importLibrary("core")])
      .then(resolve, reject);
  });
}

export async function createGoogleView(container, { key, mapId, center, bounds, restriction, minZoom }) {
  await loadGoogleMaps(key);
  const { Map, InfoWindow, Polyline } = google.maps;
  const { AdvancedMarkerElement } = google.maps.marker;
  const map = new Map(container, {
    center,
    zoom: 7,
    minZoom,
    mapId: mapId || "DEMO_MAP_ID",
    restriction: { latLngBounds: restriction, strictBounds: false },
    mapTypeControl: true,
    streetViewControl: false,
    fullscreenControl: true,
    clickableIcons: false,
    gestureHandling: "greedy",
  });
  map.fitBounds(bounds, 0);
  const info = new InfoWindow({ maxWidth: 300 });

  return {
    kind: "google",

    addLine({ path, color, onClick }) {
      const p = path.map(([lat, lng]) => ({ lat, lng }));
      // 白い縁取り + 路線色
      const casing = new Polyline({ path: p, strokeColor: "#ffffff", strokeOpacity: 0.9, strokeWeight: 7, zIndex: 1, clickable: false, map });
      const stroke = new Polyline({ path: p, strokeColor: color, strokeOpacity: 1, strokeWeight: 4, zIndex: 2, map });
      if (onClick) stroke.addListener("click", onClick);
      return {
        setStyle({ visible, dim, raised }) {
          const z = raised ? 10 : 0;
          casing.setMap(visible ? map : null);
          stroke.setMap(visible ? map : null);
          casing.setOptions({ strokeOpacity: dim ? 0.3 : 0.9, zIndex: 1 + z });
          stroke.setOptions({ strokeOpacity: dim ? 0.25 : 1, zIndex: 2 + z });
        },
      };
    },

    addMarker({ lat, lng, el, zIndex, title, onClick, visible = true }) {
      const m = new AdvancedMarkerElement({ map: visible ? map : null, position: { lat, lng }, content: el, zIndex, title, gmpClickable: true });
      if (onClick) m.addEventListener("gmp-click", onClick);
      return {
        el,
        anchor: m,
        setPosition(lat, lng) { m.position = { lat, lng }; },
        setTitle(t) { m.title = t; },
        setVisible(v) { m.map = v ? map : null; },
        remove() { m.map = null; },
      };
    },

    openInfo(content, marker) {
      info.setContent(content);
      // shouldFocus: false — 検索欄から開いたときにフォーカスを奪わない
      info.open({ map, anchor: marker.anchor, shouldFocus: false });
    },
    setInfoContent(content) { info.setContent(content); },
    closeInfo() { info.close(); },
    onInfoClose(cb) { info.addListener("closeclick", cb); },

    fitBounds(b, padding) {
      map.fitBounds(b, padding);
      // 全体表示から狭い範囲へ一気に寄せると、まれに 1 画面分ずれた位置になる（Google 側の挙動）。
      // 描画が落ち着いた時点で範囲の中心が画面外なら、もう一度合わせ直す
      google.maps.event.addListenerOnce(map, "idle", () => {
        const mid = { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
        if (!map.getBounds()?.contains(mid)) map.fitBounds(b, padding);
      });
    },
    getZoom() { return map.getZoom(); },
    setZoom(z) { map.setZoom(z); },
    panTo(lat, lng) { map.panTo({ lat, lng }); },
    onZoom(cb) { map.addListener("zoom_changed", cb); },
  };
}
