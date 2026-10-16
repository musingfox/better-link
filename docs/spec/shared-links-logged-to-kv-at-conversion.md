---
id: shared-links-logged-to-kv-at-conversion
status: accepted
scope:
  - "cloudflare.config.ts"
  - "src/index.ts"
  - "src/shared-link-log.ts"
  - "src/summary.ts"
verify: check:bun test ./test/shared-links-logged-to-kv-at-conversion.test.ts ./test/summary.test.ts
related: [free-plan-bindings-only, fail-open-to-original, tracking-params-cleaned-at-conversion, shared-link-log-page-behind-access, cpu-budget-10ms, fix-service-table-single-source]
source: null
adr: null
---
紀錄分享連結是可選功能：預設不啟用，啟用後只在 `GET /?url=` 成功產生分享連結時寫進一個 Workers KV 命名空間，`raw=1` 的請求同樣會記錄（並在 metadata 標記 `raw`），每一筆都帶 `expirationTtl`，而且寫入成功與否都不能改變回應。

`cloudflare.config.ts` 只在建置時的環境變數有設定時才宣告 `bindings.kv()`，部署的人在 Workers Builds 的建置變數裡設定它來啟用；在 Cloudflare 後台手動加的綁定會在下次部署時被設定檔覆蓋，所以不能當作啟用方式。預設匯出必須維持一般物件，因為 `test/config.test.ts` 直接讀它。Worker 在執行時看 `env` 有沒有這個綁定來決定要不要寫。寫入放在 `ctx.waitUntil` 裡，所以 `src/index.ts` 的 `createWorker` 要把 `env` 和 `ctx` 傳下去。key 以反轉的時間戳開頭（`9999999999999` 減去寫入時的毫秒數，補零到 13 位），因為 KV 列出 key 時依 UTF-8 位元組排序，這樣 list 回來就是新的在前，紀錄頁可以直接用游標往舊的翻；ISO 時間放在 metadata 的 `at`。清過追蹤碼的原網址和時間放在 key 的 metadata（上限 1,024 bytes，以 UTF-8 位元組計算），list 回來就能直接讀，不用逐筆 get；超過上限時 metadata 只留時間，原網址仍放在 value，`raw=1` 的紀錄則在 metadata 加上 `raw: true`。舊資料靠 TTL 自動淘汰，不另寫清理機制。

寫入前先在同一個 `waitUntil` 裡取得貼文的作者和內文（`src/summary.ts`），放進 metadata 的 `author` 和 `text`，讓紀錄頁能搜尋。來源依平台而定：Instagram 和 Facebook 用分享連結 og 頁同一套解析與快取；YouTube 和 X 用官方 oEmbed（`youtube.com/oembed`、`publish.x.com/oembed`）；Bluesky 用官方公開 API（`resolveHandle` 再 `getPosts`）；Threads 以 `facebookexternalhit` 讀原站的 og 標籤；TikTok、Reddit、Pixiv 讀修復服務頁面的 og 標籤，因為原站不給（2026-10-16 從本機實測：TikTok oEmbed 回 429、Reddit `.json` 與 oEmbed 回 403、Threads oEmbed 沒有內文）。og 標籤只讀回應前 64 KB 就取消讀取，Threads 的 og 標籤在 544 KB 頁面的約 2 KB 處（同日實測）。每個上游請求 5 秒逾時，整個摘要 10 秒內沒完成就放棄，低於 `waitUntil` 的 30 秒上限。摘要失敗、逾時或平台不在清單裡時照樣寫入，只是沒有這兩個欄位。但摘要和寫入在同一個 promise 裡，若解析讓整個請求超過 CPU 上限而被中止，這筆紀錄會整筆遺失；這是接受的風險，量測見 `cpu-budget-10ms`。metadata 依序保留網址、作者、內文，作者和內文以 UTF-8 位元組截斷成前綴；網址放不下時也不放摘要，因為紀錄頁顯示不出這筆，搜尋卻會比對到它。因為要等摘要，寫入發生在回應之後，每次轉換仍只寫一次。

分享連結轉址 `GET /<原網域>/<路徑>` 和 `/media/` 不寫紀錄，所以手動把 `https://` 換成 Worker 網址產生的連結不會被記到，這是接受的代價。沒有綁定 KV 時 Worker 完全不寫入，行為和沒有這個功能時相同，所以用 Deploy 按鈕產生的新部署仍然不需要任何設定。紀錄包含所有使用這個部署的人的連結；怎麼讀取紀錄、誰能讀取，不在這條規格裡。

違反時不會被察覺：KV 免費方案每天只能寫 1,000 次，若在轉址端點記錄，爬蟲抓預覽和收件人點開會在流量高的某天吃光額度，之後的寫入默默失敗；沒帶 TTL 的紀錄會一直累積到 1 GB 才開始寫不進去；寫入若在回應路徑上被等待而拋錯，爬蟲拿到錯誤只會默默不顯示預覽。

由 `test/shared-links-logged-to-kv-at-conversion.test.ts` 與 `test/summary.test.ts` 檢查（即 `verify` 指令）：只有 `GET /?url=`（含 `raw=1`）會呼叫 `put` 且帶 `expirationTtl`；較晚寫入的 key 排序在前；摘要寫進 `author` 和 `text`，截斷後 metadata 不超過 1,024 bytes；摘要失敗或 10 秒未完成時仍寫入不含摘要的紀錄；各平台向上游請求的網址與 User-Agent，以及從 fixture 解析出的作者和內文；og 標籤只讀前 64 KB；metadata 超過 1,024 bytes 時不含原網址，且以位元組而非字元計算；`cloudflare.config.ts` 只在 `LOG_SHARED_LINKS=1` 時宣告 `SHARED_LINKS` 綁定；沒有綁定時不排程任何寫入；`put` 同步拋錯、非同步拒絕或 `waitUntil` 拋錯時，回應與沒有綁定時相同；`put` 永不結束時回應也不延遲；分享連結轉址與失敗的轉換都不寫入。
