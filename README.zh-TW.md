# better-link

[English](README.md) | 繁體中文

把社群貼文網址轉成乾淨、能在聊天軟體裡正常顯示預覽的分享連結。

Instagram 和 Facebook 的連結貼到 Discord、Telegram 常常沒有預覽，或帶著 `igsh`、`fbclid` 這類追蹤碼。better-link 是一個 Cloudflare Worker，負責三件事：

- 清掉追蹤碼，展開 Instagram / Facebook 的 `/share/` 短連結。
- 對 Instagram 貼文與 Facebook 貼文、影片，由 Worker 自己抓資料產生 og 預覽頁，多圖貼文可指定第幾張。
- 對 X / Twitter、TikTok、Bluesky、Reddit、Pixiv、Threads，把爬蟲轉給現成的修正服務。

一般使用者點開分享連結時，會被 302 轉回清理後的原網址，不會看到中間頁。

## 用法

以下以部署網域 `https://link.example` 為例。

### 產生分享連結

```sh
curl 'https://link.example/?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FABC%2F%3Figsh%3Dxyz'
# https://link.example/www.instagram.com/p/ABC/
```

`url` 參數要 percent-encode。加上 `raw=1` 則只回清理後的原網址：

```sh
curl 'https://link.example/?url=https%3A%2F%2Fx.com%2Fjack%2Fstatus%2F20%3Fs%3D20&raw=1'
# https://x.com/jack/status/20
```

也可以不呼叫 API，直接把原網址的 `https://` 換成 `https://link.example/`。這條路徑同樣會清追蹤碼，但不展開 `/share/` 短連結。

### 端點

| 請求 | 回應 |
| --- | --- |
| `GET /?url=<網址>[&raw=1]` | `200 text/plain`，內容是分享連結；網址無效時回 `400` |
| `GET /<原網域>/<路徑>` | 爬蟲：og 預覽頁或 302 到修正服務。一般瀏覽器：302 回原網址 |
| `GET /www.instagram.com/p/<code>/<n>` | 多圖貼文的第 n 張（1 起算） |
| `GET /media/...` | 302 到當下重新簽章的 CDN 圖片或影片網址，供 og 標籤使用 |

抓取或解析失敗時，分享連結一律 302 回清理後的原網址，最差情況是沒有預覽，而不是錯誤頁。

## 開發

需要 [Bun](https://bun.sh)。

```sh
bun install
bun run dev      # 本機跑 Worker
bun run check    # 型別檢查 + 單元測試
bun run smoke    # 對真實 Instagram / Facebook 的端到端測試，需要網路
```

部署用 wrangler（`bunx wrangler deploy`），設定在 `wrangler.jsonc`。專案只用 Workers 免費方案的功能，不需要任何 binding。

設計約束寫在 [`docs/spec/`](docs/spec/)，例如每請求 CPU 10ms 上限、失敗時退回原網址、og 標籤不直接放會過期的 CDN 網址。修改程式前先讀相關規格；給 AI 代理的說明在 [`CLAUDE.md`](CLAUDE.md)（`AGENTS.md` 是它的 symlink）。
