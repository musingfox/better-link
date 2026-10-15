---
id: shared-links-logged-to-kv-at-conversion
status: accepted
scope:
  - "cloudflare.config.ts"
  - "src/index.ts"
verify: null
related: [free-plan-bindings-only, fail-open-to-original, tracking-params-cleaned-at-conversion]
source: null
adr: null
---
紀錄分享連結是可選功能：預設不啟用，啟用後只在 `GET /?url=` 成功產生分享連結時寫進一個 Workers KV 命名空間，每一筆都帶 `expirationTtl`，而且寫入成功與否都不能改變回應。

`cloudflare.config.ts` 只在建置時的環境變數有設定時才宣告 `bindings.kv()`，部署的人在 Workers Builds 的建置變數裡設定它來啟用；在 Cloudflare 後台手動加的綁定會在下次部署時被設定檔覆蓋，所以不能當作啟用方式。預設匯出必須維持一般物件，因為 `test/config.test.ts` 直接讀它。Worker 在執行時看 `env` 有沒有這個綁定來決定要不要寫。寫入放在 `ctx.waitUntil` 裡，所以 `src/index.ts` 的 `createWorker` 要把 `env` 和 `ctx` 傳下去。key 以時間戳開頭，因為 KV 列出 key 時依 UTF-8 位元組排序，這樣一次 list 就是時間順序。清過追蹤碼的原網址和時間放在 key 的 metadata（上限 1,024 bytes），list 回來就能直接讀，不用逐筆 get。舊資料靠 TTL 自動淘汰，不另寫清理機制。

分享連結轉址 `GET /<原網域>/<路徑>` 和 `/media/` 不寫紀錄，所以手動把 `https://` 換成 Worker 網址產生的連結不會被記到，這是接受的代價。沒有綁定 KV 時 Worker 完全不寫入，行為和沒有這個功能時相同，所以用 Deploy 按鈕產生的新部署仍然不需要任何設定。紀錄包含所有使用這個部署的人的連結；怎麼讀取紀錄、誰能讀取，不在這條規格裡。

違反時不會被察覺：KV 免費方案每天只能寫 1,000 次，若在轉址端點記錄，爬蟲抓預覽和收件人點開會在流量高的某天吃光額度，之後的寫入默默失敗；沒帶 TTL 的紀錄會一直累積到 1 GB 才開始寫不進去；寫入若在回應路徑上被等待而拋錯，爬蟲拿到錯誤只會默默不顯示預覽。

目前沒有 check，因為這個介面還不存在。實作落地後，在 worker 測試裡用假的 KV 斷言三件事即可綁定：只有 `GET /?url=` 會呼叫 `put` 且帶 `expirationTtl`、沒有綁定時回應不變、`put` 拋錯時回應不變。
