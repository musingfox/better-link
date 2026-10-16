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

登入由部署的人在 Zero Trust 建立的 self-hosted application 負責，應用程式網域只填 `<網域>/log` 這個路徑。保護整個 Worker 會連分享連結和 `/media/` 一起擋住，爬蟲拿不到預覽。Worker 不自己驗 JWT，只看執行環境填入的 `ctx.access`；這一層檢查是為了 Access 沒設好時（例如只保護自訂網域，卻從 `workers.dev/log` 連進來）仍然不會吐出紀錄。2026-10-16 在正式環境確認，只保護 `/log` 路徑的 Access 應用程式會讓未登入的請求 302 到登入頁，分享連結和 `/media/` 不受影響。

翻頁：沒有 `?q=` 時一次請求只呼叫一次 `list`，`limit` 為 30，`?cursor=` 原樣傳給 `list`；`list_complete` 為 false 時頁面給出帶下一個游標的「較舊」連結。key 以反轉時間戳開頭，所以 list 的順序就是新的在前，不需要把全部 key 列完。游標只能往前，所以沒有「上一頁」。

搜尋：有 `?q=` 時以不分大小寫的子字串比對 metadata 裡的原網址。每次請求最多呼叫 3 次 `list`（`limit` 1,000，掃 3,000 筆），一批掃完後若已找到 30 筆以上就停；沒掃完時頁面給出帶游標與 `q` 的「繼續往前搜尋」連結。停在批次之間而不是批次中間，因為游標只能接在整批之後，從中間停會漏掉同一批剩下的結果；所以一頁的結果可能超過 30 筆。上限 3 次的依據：一次請求的 KV 操作上限是 1,000（https://developers.cloudflare.com/kv/platform/limits/ ），免費方案的 list 請求每天 1,000 次（https://developers.cloudflare.com/kv/platform/pricing/ ），2026-10-16 查閱。

預覽：只有分享連結本身會產生 embed media 的紀錄才有預覽，網址和分享連結的 og 頁用的相同。Instagram 的貼文、Reels、限動用 `/media/<shortcode>/<n>`，Facebook 的貼文和影片用 `/media/<網域><路徑><query>`。頁面先用 `<img>` 載入，失敗就換成 `<video>`（影片貼文的媒體是 mp4），再失敗就顯示無預覽。其他平台一律無預覽，`/log` 本身不往外抓任何東西。

資料只讀 key 的 metadata，不逐筆 `get`；metadata 沒有原網址的紀錄只顯示提示、搜不到，也沒有預覽。原網址來自使用者輸入，輸出到 HTML 前一律跳脫。回應帶 `Cache-Control: no-store`。`list` 失敗回 503，不影響其他路由。

`ctx.access.aud` 不比對：帳號裡任何涵蓋這個 Worker 的 Access 應用程式都是部署的人自己授權的。搜尋原網址以外的欄位（作者、內文）、其他平台的預覽、往回翻頁都不在範圍內。

違反時不會被察覺：紀錄含有所有使用這個部署的人的連結，頁面若在沒登入時也能讀，外人打開 `/log` 不會留下任何讓部署的人注意到的痕跡；網址沒跳脫時，惡意的轉換請求會把腳本存進紀錄，等部署的人登入後打開頁面才執行；搜尋若不設上限，紀錄多時一次請求會用掉大量 list 額度或超過 CPU 上限，失敗只是頁面打不開。

由 `test/shared-link-log-page-behind-access.test.ts` 檢查（即 `verify` 指令）：沒有 `ctx.access` 時回 403 且不呼叫 `list`；沒有綁定時 `/log` 回 404；沒有 `q` 時只呼叫一次 `list`、`limit` 為 30 並帶入游標，未列完時才有「較舊」連結；搜尋不分大小寫、最多 3 次 `list`、找到 30 筆以上就在批次之間停下，沒掃完時給出帶 `q` 的續搜連結；Instagram 與 Facebook 紀錄的預覽網址與分享連結 og 頁相同，其他平台沒有預覽；網址經過 HTML 跳脫；回應帶 `no-store`；`list` 失敗時回 503。
