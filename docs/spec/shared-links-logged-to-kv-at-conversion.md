---
id: shared-links-logged-to-kv-at-conversion
status: accepted
scope:
  - "cloudflare.config.ts"
  - "src/index.ts"
  - "src/shared-link-log.ts"
verify: check:bun test ./test/shared-links-logged-to-kv-at-conversion.test.ts
related: [free-plan-bindings-only, fail-open-to-original, tracking-params-cleaned-at-conversion]
source: null
adr: null
---
紀錄分享連結是可選功能：預設不啟用，啟用後只在 `GET /?url=` 成功產生分享連結時寫進一個 Workers KV 命名空間，`raw=1` 的請求同樣會記錄（並在 metadata 標記 `raw`），每一筆都帶 `expirationTtl`，而且寫入成功與否都不能改變回應。

`cloudflare.config.ts` 只在建置時的環境變數有設定時才宣告 `bindings.kv()`，部署的人在 Workers Builds 的建置變數裡設定它來啟用；在 Cloudflare 後台手動加的綁定會在下次部署時被設定檔覆蓋，所以不能當作啟用方式。預設匯出必須維持一般物件，因為 `test/config.test.ts` 直接讀它。Worker 在執行時看 `env` 有沒有這個綁定來決定要不要寫。寫入放在 `ctx.waitUntil` 裡，所以 `src/index.ts` 的 `createWorker` 要把 `env` 和 `ctx` 傳下去。key 以時間戳開頭，因為 KV 列出 key 時依 UTF-8 位元組排序，這樣一次 list 就是時間順序。清過追蹤碼的原網址和時間放在 key 的 metadata（上限 1,024 bytes，以 UTF-8 位元組計算），list 回來就能直接讀，不用逐筆 get；超過上限時 metadata 只留時間，原網址仍放在 value，`raw=1` 的紀錄則在 metadata 加上 `raw: true`。舊資料靠 TTL 自動淘汰，不另寫清理機制。

分享連結轉址 `GET /<原網域>/<路徑>` 和 `/media/` 不寫紀錄，所以手動把 `https://` 換成 Worker 網址產生的連結不會被記到，這是接受的代價。沒有綁定 KV 時 Worker 完全不寫入，行為和沒有這個功能時相同，所以用 Deploy 按鈕產生的新部署仍然不需要任何設定。紀錄包含所有使用這個部署的人的連結；怎麼讀取紀錄、誰能讀取，不在這條規格裡。

違反時不會被察覺：KV 免費方案每天只能寫 1,000 次，若在轉址端點記錄，爬蟲抓預覽和收件人點開會在流量高的某天吃光額度，之後的寫入默默失敗；沒帶 TTL 的紀錄會一直累積到 1 GB 才開始寫不進去；寫入若在回應路徑上被等待而拋錯，爬蟲拿到錯誤只會默默不顯示預覽。

由 `test/shared-links-logged-to-kv-at-conversion.test.ts` 檢查（即 `verify` 指令）：只有 `GET /?url=`（含 `raw=1`）會呼叫 `put` 且帶 `expirationTtl`；metadata 超過 1,024 bytes 時不含原網址，且以位元組而非字元計算；`cloudflare.config.ts` 只在 `LOG_SHARED_LINKS=1` 時宣告 `SHARED_LINKS` 綁定；沒有綁定時不排程任何寫入；`put` 同步拋錯、非同步拒絕或 `waitUntil` 拋錯時，回應與沒有綁定時相同；`put` 永不結束時回應也不延遲；分享連結轉址與失敗的轉換都不寫入。
