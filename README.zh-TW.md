# better-link

[English](README.md) | 繁體中文

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/musingfox/better-link)

把社群貼文網址轉成乾淨、能在聊天軟體裡正常顯示預覽的分享連結。

Instagram 和 Facebook 的連結貼到 Discord、Telegram 常常沒有預覽，或帶著 `igsh`、`fbclid` 這類追蹤碼。better-link 是一個 Cloudflare Worker，負責三件事：

- 清掉追蹤碼，展開 Instagram / Facebook 的 `/share/` 短連結。
- 對 Instagram 貼文與 Facebook 貼文、影片，由 Worker 自己抓資料產生 og 預覽頁，多圖貼文可指定第幾張。
- 對 X / Twitter、TikTok、Bluesky、Reddit、Pixiv、Threads，把爬蟲轉給現成的修正服務。

提供兩種模式：只清理網址，或另外產生能正常 embed 的分享連結，見下方說明。

## 兩種模式

better-link 產生兩種連結，差別在分享出去之後還要不要經過 better-link。

| | 只清理連結 | 帶 embed 的分享連結 |
| --- | --- | --- |
| 取得方式 | `GET /?url=<網址>&raw=1` | `GET /?url=<網址>`，或把 `https://` 換成 `https://link.example/` |
| 得到的網址 | `https://www.instagram.com/p/ABC/` | `https://link.example/www.instagram.com/p/ABC/` |
| 追蹤碼 | 清掉 | 清掉 |
| `/share/` 短連結 | 展開 | 展開（僅限 `/?url=`） |
| 聊天軟體預覽 | 平台原本給什麼就是什麼，Instagram / Facebook 常常沒有 | better-link 或修正服務產生的 og 預覽 |
| 分享後是否依賴 better-link | 否，就是平台自己的網址 | 是，每次打開都經過 Worker |

兩種模式下，真人點開連結最後都會到清理後的原網址，差別只在爬蟲看到什麼。

### 只清理連結

回傳清理後的原網址（純文字）。適合只想去掉追蹤碼、保留平台原本網址的情況，例如存檔，或分享到不需要預覽的地方。

```sh
curl 'https://link.example/?url=https%3A%2F%2Fx.com%2Fjack%2Fstatus%2F20%3Fs%3D20&raw=1'
# https://x.com/jack/status/20
```

### 帶 embed 的分享連結

回傳 better-link 網域下的連結。聊天軟體的爬蟲來抓時，依平台回應：

- Instagram 貼文、Facebook 貼文與影片：Worker 自己抓貼文，回 og / twitter card HTML。Instagram 多圖貼文可在網址後加 `/<n>` 指定第 n 張（1 起算）。
- X / Twitter、TikTok、Bluesky、Reddit、Pixiv、Threads：302 到現成的修正服務，由它產生 embed。
- 其他網站：302 回清理後的原網址，預覽不會比原網址好。

一般瀏覽器一律 302 回清理後的原網址，不會看到中間頁。抓取或解析失敗時爬蟲也拿到同一個 302：最差情況是沒有預覽，而不是錯誤頁。

```sh
curl 'https://link.example/?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FABC%2F%3Figsh%3Dxyz'
# https://link.example/www.instagram.com/p/ABC/
```

也可以不呼叫 API，直接把原網址的 `https://` 換成 `https://link.example/`。這條路徑同樣會清追蹤碼，但不展開 `/share/` 短連結。

兩種模式的 `url` 參數都要 percent-encode。範例以部署網域 `https://link.example` 為例。

## 端點

| 請求 | 回應 |
| --- | --- |
| `GET /?url=<網址>[&raw=1]` | `200 text/plain`，內容是連結；網址無效時回 `400` |
| `GET /<原網域>/<路徑>` | 爬蟲：og 預覽頁或 302 到修正服務。一般瀏覽器：302 回原網址 |
| `GET /www.instagram.com/p/<code>/<n>` | 多圖貼文的第 n 張（1 起算） |
| `GET /media/...` | 302 到當下重新簽章的 CDN 圖片或影片網址，供 og 標籤使用 |

## 部署自己的版本

按下按鈕即可在 Cloudflare 部署一份自己的 better-link：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/musingfox/better-link)

Cloudflare 會把這個 repo 複製到你的 GitHub 或 GitLab 帳號、建置並部署 Worker，並接上 Workers Builds，之後推到那份複本就會自動重新部署。只需要 Cloudflare 帳號，Workers 免費方案就夠，也沒有 binding、環境變數或 secret 要填。Worker 名稱可以在設定頁改。

部署完成後網址是 `https://better-link.<你的子網域>.workers.dev`（或你取的名稱），把上面範例中的 `https://link.example` 換成它即可，也可以在 Cloudflare 後台綁自訂網域。

手動部署：

```sh
bun install
npx cf auth login   # 只需一次；cf 不沿用 Wrangler 的登入
bun run deploy      # cf deploy
```

## 開發

需要 [Bun](https://bun.sh) 和 Node.js 22.18 以上。

```sh
bun install
bun run dev      # 本機跑 Worker
bun run check    # 型別檢查 + 單元測試
bun run smoke    # 對真實 Instagram / Facebook 的端到端測試，需要網路
```

設定在 `cloudflare.config.ts`。專案只用 Workers 免費方案的功能，不需要任何 binding。

設計約束寫在 [`docs/spec/`](docs/spec/)，例如每請求 CPU 10ms 上限、失敗時退回原網址、og 標籤不直接放會過期的 CDN 網址。修改程式前先讀相關規格；給 AI 代理的說明在 [`CLAUDE.md`](CLAUDE.md)（`AGENTS.md` 是它的 symlink）。
