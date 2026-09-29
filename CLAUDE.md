# CLAUDE.md

better-link 是一個 Cloudflare Worker：把社群貼文網址轉成「清掉追蹤碼、在 Discord / Telegram 等聊天軟體裡能正常顯示預覽」的分享連結。Instagram 和 Facebook 由 Worker 自己抓資料產生 og 頁，其他平台轉給現成的修正服務（fixupx 等）。

## 指令

套件管理與測試都用 Bun，Worker 執行環境用 wrangler。

```sh
bun install
bun run dev          # wrangler dev，本機跑 Worker
bun run typecheck    # wrangler types 產生 worker-configuration.d.ts，再分別檢查 src 與 test
bun test             # 全部單元測試
bun test ./test/clean.test.ts   # 單一檔案
bun run check        # typecheck + test，提交前跑這個
bun run smoke        # 在 127.0.0.1:8799 起 wrangler dev，對真實 Instagram / Facebook 打端到端請求
```

- `worker-configuration.d.ts` 由 `wrangler types` 產生且被 gitignore，沒跑過 typecheck 時 `Env`、`ExecutionContext` 等型別會找不到。
- `smoke` 需要對外網路，結果取決於上游當下的回應，不適合當 CI 的必要條件。

## 架構

`src/index.ts` 是唯一入口，只依路徑分成三個端點：

| 路徑 | 處理函式 | 行為 |
| --- | --- | --- |
| `GET /?url=<percent-encoded>` | `convert` | 展開 FB/IG `/share/` 短連結、清追蹤碼，回 `text/plain` 的分享連結。加 `raw=1` 則回清理後的原網址 |
| `GET /<原網域>/<路徑>` | `shareRedirect` | 非爬蟲：302 到清理後的原網址。爬蟲：IG 貼文與 FB 貼文/影片回 og HTML；在修正服務表中的平台 302 到修正服務；其他 302 回原網址 |
| `GET /media/...` | `mediaRedirect` | 當下重新取得帶簽章的 CDN 網址，`Cache-Control: no-store` 的 302 |

各模組職責：

- `clean.ts`：追蹤碼清除。Worker 支援的平台（Instagram、YouTube）用白名單，其他用黑名單，X/Twitter 另去掉 `s`、`t`。
- `expand.ts`：`/share/` 短連結展開（HEAD + `Go-http-client/1.1` UA，最多 3 跳、5 秒）與 `isShareable`。
- `crawler.ts`：以 UA 子字串判斷是否為爬蟲。
- `fix-services.ts`：其他平台 → 修正服務的唯一對照表。
- `instagram.ts`：抓 `/embed/captioned/` 頁、解析出 `Post`，並用 Cache API 快取。
- `facebook.ts`：抓 `plugins/post.php` / `plugins/video.php`，解析貼文圖或影片。
- `og.ts`：把 `Post` 渲染成 og / twitter card HTML。

`createWorker({ cache })` 讓測試注入假的快取（`test/support/fake-cache.ts`）；抓取在測試中以 `spyOn(globalThis, "fetch")` 替換。上游頁面存成 `test/fixtures/` 下的 HTML，解析測試都跑在 fixture 上，不打網路。

## 規格（`docs/spec/`）

`docs/spec/*.md` 是已接受的硬性約束，改到 `scope` 涵蓋的檔案前先讀相關規格。每份規格的 frontmatter 有 `verify`，是可以直接跑的檢查指令（`check:` 後面那段）。目前的規格：

- `cpu-budget-10ms`：每請求 CPU ≤ 10ms、subrequest ≤ 50。解析只用 `indexOf` 取需要的欄位，不建 DOM、不在 Worker 裡處理圖片或影片。本機 `wrangler dev` 不會限制 CPU，超標只會在部署後出現。
- `fail-open-to-original`：分享連結端點抓取或解析失敗一律 302 回清理後的原網址，不回錯誤頁、不回缺媒體的 og 頁。Facebook 失敗頁也回 200，只能靠「缺欄位」判定失敗。
- `fix-service-table-single-source`：修正服務網域只寫在 `src/fix-services.ts`，其他地方不得寫死。
- `free-plan-bindings-only`：只用 Workers 免費方案。不宣告 KV / R2 / D1 / Durable Objects / Queues，暫存一律用 `caches.default`。
- `signed-cdn-urls-never-outlive-signature`：og 標籤只放本服務的 `/media/...` 網址，不放 CDN 網址；含 CDN 網址的快取保存時間（目前 24 小時）不可拉長。
- `tracking-params-cleaned-at-conversion`：清除規則只寫在 `clean.ts` 一處，所有 302 出去的原網址都走同一套規則。

這些規格的共同點是「違反時不會被察覺」：爬蟲拿到錯誤只會默默不顯示預覽，沒有人會回報。所以新行為要有測試，不能只靠手動貼連結看預覽。

新增規格時沿用既有 frontmatter（`id`、`status`、`scope`、`verify`、`related`、`source`、`adr`），內文依序寫：規則一句話、細節與實測數據（附日期與樣本數）、範圍外的事、違反時為何不會被察覺。

## 開發慣例

- TypeScript strict、`verbatimModuleSyntax`，型別匯入寫 `import type` 或 `type` 修飾。
- 不加執行期相依套件；目前只有 devDependencies。
- 解析上游 HTML 時用字串搜尋取欄位，並處理找不到的情況（回 `null`），由呼叫端決定 302 回原網址。
- 新增平台支援時，先存上游頁面為 fixture，再寫解析測試。
- 提交訊息用 Conventional Commits，scope 用模組名：`feat(facebook): ...`、`fix(clean): ...`、`test(worker): ...`、`docs(spec): ...`。描述用英文小寫開頭、一個 commit 一件事，測試常與實作分開提交。
- 規格與文件用繁體中文，程式碼與註解用英文。
