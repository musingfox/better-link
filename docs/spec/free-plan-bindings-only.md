---
id: free-plan-bindings-only
status: accepted
scope:
  - "wrangler.toml"
  - "wrangler.json"
  - "wrangler.jsonc"
  - "src/**"
verify: null
related: [cpu-budget-10ms, signed-cdn-urls-never-outlive-signature]
source: better-link-design-spec
adr: null
---
只使用 Workers 免費方案內含的功能，不宣告 KV、R2、D1、Durable Objects、Queues 或任何付費 binding。

需要暫存的資料一律用 Cache API（`caches.default` 的 `put` 和 `match`）。wrangler 設定檔裡不出現任何儲存類 binding。

環境變數和 secrets 不算 binding，可以使用。Cache API 只存在寫入它的資料中心、不會同步到其他地方，這是接受的代價，不是要修的問題。

違反時不會被察覺：KV 免費方案每天只能寫 1,000 次，加了 KV 的版本在開發和低流量時一切正常，要到某天額度用完才開始默默寫入失敗。

這條目前沒有可執行的 verify，因為 wrangler 設定檔還不存在。設定檔建立後，改成 check：對設定檔 grep `kv_namespaces|r2_buckets|d1_databases|durable_objects|queues` 必須沒有結果。
