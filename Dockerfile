# 北海道在来線路線図 — 静的ファイルを nginx で配信する
FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# 起動時に環境変数から config.js を生成する（API キーをイメージに含めないため）
COPY --chmod=755 docker/40-app-config.sh /docker-entrypoint.d/40-app-config.sh

COPY index.html /usr/share/nginx/html/
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY data/ /usr/share/nginx/html/data/

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
