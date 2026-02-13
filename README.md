# UDP-OBS-Rec-and-Play-Tool (Electron + TypeScript)

OBS録画とUDP記録/再送を同期する、Windows/Mac向けデスクトップアプリのMVPです。

<img width="1161" height="1084" alt="スクリーンショット 2026-02-12 232611" src="https://github.com/user-attachments/assets/99e7219c-b343-4053-9ea0-1bb3d43a995a" />

## 機能
- RECタブ
  - OBS接続（WebSocket v5）
  - `REC START` で OBS録画開始 + UDP受信JSONL記録開始
  - `REC STOP` で UDP受信停止 + OBS録画停止
- PLAYタブ
  - MP4と `udp.jsonl` を読み込み
  - `video.currentTime + offset` を基準にUDP再送
  - `PLAY / PAUSE / STOP` 制御
  - 動画の埋め込みUIは誤操作防止のため無効化（操作はアプリ側ボタンのみ）
  - 送信UDPの直近4件を行表示（先頭は累積連番）
- ステータス表示
  - REC: `OBS / REC / Packets / Log` を1行表示 + 受信UDP直近4件（累積連番）
  - PLAY: `Ready / Time / Sent / Offset` を1行表示 + 送信UDP直近4件（累積連番）

<img width="1091" height="702" alt="rec" src="https://github.com/user-attachments/assets/61ddbfcf-c946-4939-94b5-f4e295dc56b4" />

<img width="1145" height="499" alt="play" src="https://github.com/user-attachments/assets/9233a7d9-a96c-4b81-a809-4197952729db" />


## ログ形式
- セッションフォルダ: `session_YYYYMMDD_HHMMSS/`
  - `udp.jsonl`
  - `meta.json`
- `udp.jsonl` (1行1パケット)
  - `{"t":0.033,"data_b64":"..."}`

## セットアップ
1. Node.js 20+ をインストール
2. 依存導入
   - `npm install`
3. 開発実行
   - `npm run dev`
4. 本番相当起動（ビルド後起動）
   - `npm start`

## 配布ビルド（インストーラ生成）
- すべて（現在OS向け）: `npm run dist`
- Windows向け: `npm run dist:win`
- macOS向け: `npm run dist:mac`
- 出力先: `release/`

注意:
- WindowsでmacOS向けDMGを作るには通常macOS環境が必要です（逆も同様）。
- テスト再生用ファイルを同梱する場合は `default-media/` に `mp4` と `jsonl`（またはJSONL内容の `json` 拡張子）を配置してください。

GitHub ActionsでmacOSビルドする場合:
1. GitHubへpush
2. Actionsタブで `Build macOS Package` を手動実行
3. 完了後、Artifacts から `dmg/zip` を取得

GitHub ActionsでWindowsビルドする場合:
1. GitHubへpush
2. Actionsタブで `Build Windows Package` を手動実行
3. 完了後、Artifacts から `exe/zip` を取得

## OBS側の事前設定
1. OBSを起動
2. `ツール > WebSocket サーバー設定`
3. `WebSocketサーバーを有効化` をON
4. ポートを `4455`（または任意）に設定
5. パスワードを設定
6. RECタブの `OBS WS URL` / `OBS Password` に同値を入力

## 注意
- UDPは `dgram` でバイト列を無加工のまま扱います。
- 相対時刻は `process.hrtime.bigint()` を使ったmonotonic計測です。
- `PLAY` は `video.currentTime` 追従で再送します（開始時刻固定ではありません）。

## デフォルト再生素材の自動読込
- アプリ起動時は `PLAY` タブがデフォルト表示です。
- 規定フォルダ `default-media` に `*.mp4` と `*.jsonl`（またはJSONL内容の `*.json`）があると自動でPRELOADします。
- 探索順:
  - `UDP_OBS_DEFAULT_MEDIA_DIR` 環境変数で指定したフォルダ
  - 配布版: `resources/default-media`、または実行ファイルと同階層の `default-media`
  - 開発時: プロジェクト直下の `default-media`

## 今後の改善案
- PLAY中のシーク頻発時に備えた送信レート制御
- JSONLのストリーム読み込み対応（長時間収録向け）
- セッション一覧UIとワンクリック再生
- electron-builderで配布パッケージ生成（Windows/Mac）
