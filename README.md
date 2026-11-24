# 北海道在来线路线图（TMV）

基于 Google Maps JavaScript API 的 Web 应用，在北海道地图上显示 JR 北海道全部在来线及道南いさりび鉄道的线路和所有车站。

- 12 条线路、322 个车站（换乘站已合并）
- 侧栏按线路列出车站（按实际站序），可显示/隐藏、点击聚焦线路
- 点击车站显示所属线路及前后站；支持车站搜索
- 缩放到一定程度自动显示站名；适配手机
- 显示运行中的列车（**演示用虚拟列车**），每 10 秒刷新

## 运行中的列车（演示）

JR北海道没有公开列车实时位置的 API，所以这里显示的是虚拟列车：按 `js/trains.js` 中 `SERVICES` 定义的固定间隔时刻表（6:00〜22:00 发车），根据当前日本时间推算位置，沿实际线路形状行驶。与真实运行无关，页面上标有「デモ」。
修改 `SERVICES`（区间、发车间隔、种别）和 `TYPES`（速度、停车时间）即可调整。

## 用 Docker 运行（推荐）

1. 复制环境变量文件，填入 Google Maps API 密钥：

   ```bash
   cp .env.example .env
   ```

2. 构建并启动：

   ```bash
   docker compose up -d --build
   ```

3. 浏览器访问 http://localhost:8000 ，停止时运行 `docker compose down`。

容器启动时会根据环境变量 `GOOGLE_MAPS_API_KEY`（和可选的 `GOOGLE_MAPS_MAP_ID`）生成 `config.js`，密钥不会打包进镜像。
要改端口，修改 `compose.yaml` 里的 `8000:80`。

## 不用 Docker 运行

1. 在 Google Cloud Console 启用 **Maps JavaScript API** 并创建 API 密钥（建议设置 HTTP 引用来源限制）。
2. 复制配置文件并填入密钥：

   ```bash
   cp config.example.js config.js
   ```

3. 用任意静态服务器启动（直接双击打开 `file://` 无法读取数据）：

   ```bash
   python3 -m http.server 8000
   ```

4. 浏览器访问 http://localhost:8000

没有 `config.js` 时，页面会提示输入密钥（保存在浏览器 localStorage 中），也可以用 `?key=...` 参数临时指定。
`mapId` 未设置时使用 Google 提供的开发用 `DEMO_MAP_ID`；正式使用请在 Cloud Console 创建地图 ID。

## 收录范围

| 线路 | 区间 |
| --- | --- |
| 函館本線 | 函館–旭川、大沼–渡島砂原–森（砂原支线） |
| 室蘭本線 | 長万部–岩見沢、東室蘭–室蘭 |
| 千歳線 | 白石–沼ノ端、南千歳–新千歳空港 |
| 札沼線（学園都市線） | 桑園–北海道医療大学 |
| 石勝線 | 南千歳–新得 |
| 根室本線 | 滝川–富良野、新得–根室 |
| 富良野線 | 旭川–富良野 |
| 宗谷本線 | 旭川–稚内 |
| 石北本線 | 新旭川–網走 |
| 釧網本線 | 網走–東釧路 |
| 日高本線 | 苫小牧–鵡川 |
| 道南いさりび鉄道線 | 五稜郭–木古内 |

不含北海道新幹线、海峡线（无在来线客运）、路面电车和地铁。留萌本线已于 2026 年 3 月废止，未收录。

## 数据

`data/hokkaido-rail.json` 由 `scripts/build_data.py` 从国土交通省「国土数値情報（鉄道データ）N02-25」生成：

```bash
curl -O https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-25/N02-25_GML.zip
unzip N02-25_GML.zip
python3 scripts/build_data.py N02-25_GML/UTF-8
```

脚本会合并线段、简化坐标、按途经站计算站序，并合并换乘站。要增减线路或区间，修改脚本开头的 `LINES` 即可。

出典：「国土数値情報（鉄道データ）」（国土交通省）を加工して作成
