---
id: shared-link-log-page-behind-access
status: accepted
scope:
  - "src/index.ts"
  - "src/shared-link-log-page.ts"
verify: check:bun test ./test/shared-link-log-page-behind-access.test.ts
related: [shared-links-logged-to-kv-at-conversion, free-plan-bindings-only, cpu-budget-10ms]
source: null
adr: null
---
`GET /log` 只在請求經過 Cloudflare Access 驗證（`ctx.access` 有值）時才讀取 `SHARED_LINKS`，否則回 403 且不呼叫任何 KV 方法；沒有綁定時 `/log` 照原本的分享連結路由處理（404）。

登入由部署的人在 Zero Trust 建立的 self-hosted application 負責，應用程式網域只填 `<網域>/log` 這個路徑。保護整個 Worker 會連分享連結和 `/media/` 一起擋住，爬蟲拿不到預覽。Worker 不自己驗 JWT，只看執行環境填入的 `ctx.access`；這一層檢查是為了 Access 沒設好時（例如只保護自訂網域，卻從 `workers.dev/log` 連進來）仍然不會吐出紀錄。

一次瀏覽只呼叫一次 `list`，`prefix` 是一個 UTC 日期（`YYYY-MM-DD`，由 `?day=` 指定，預設今天），因為 key 以 ISO 時間戳開頭。免費方案每天最多寫 1,000 筆、一次 `list` 最多回 1,000 筆，所以一天的紀錄一次拿完（https://developers.cloudflare.com/kv/platform/limits/ 、https://developers.cloudflare.com/kv/api/list-keys/ ，2026-10-16 查閱）；list 請求在免費方案每天 1,000 次（https://developers.cloudflare.com/kv/platform/pricing/ ），所以不做跨日翻頁或搜尋。資料只讀 key 的 metadata，不逐筆 `get`；metadata 沒有原網址的紀錄只顯示提示。原網址來自使用者輸入，輸出到 HTML 前一律跳脫。回應帶 `Cache-Control: no-store`。`list` 失敗回 503，不影響其他路由。

`ctx.access.aud` 不比對：帳號裡任何涵蓋這個 Worker 的 Access 應用程式都是部署的人自己授權的。以本地時區分日也不在範圍內。

違反時不會被察覺：紀錄含有所有使用這個部署的人的連結，頁面若在沒登入時也能讀，外人打開 `/log` 不會留下任何讓部署的人注意到的痕跡；網址沒跳脫時，惡意的轉換請求會把腳本存進紀錄，等部署的人登入後打開頁面才執行。

由 `test/shared-link-log-page-behind-access.test.ts` 檢查（即 `verify` 指令）：沒有 `ctx.access` 時回 403 且不呼叫 `list`；沒有綁定時 `/log` 回 404；`list` 的 `prefix` 等於指定或今天的 UTC 日期，且只呼叫一次；新的紀錄排在前面；網址經過 HTML 跳脫；回應帶 `no-store`；`list` 失敗時回 503；不合法的 `day` 回 400 且不呼叫 `list`。
