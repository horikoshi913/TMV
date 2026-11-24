#!/bin/sh
# 環境変数 GOOGLE_MAPS_API_KEY / GOOGLE_MAPS_MAP_ID から config.js を生成する
set -eu

js_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

key=$(js_escape "${GOOGLE_MAPS_API_KEY:-}")
map_id=$(js_escape "${GOOGLE_MAPS_MAP_ID:-}")

cat > /usr/share/nginx/html/config.js <<JS
window.APP_CONFIG = {
  googleMapsApiKey: "${key}",
  mapId: "${map_id}",
};
JS

if [ -z "${GOOGLE_MAPS_API_KEY:-}" ]; then
  echo "40-app-config.sh: GOOGLE_MAPS_API_KEY が未設定です（画面でキーを入力できます）" >&2
fi
