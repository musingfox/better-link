---
id: cpu-budget-10ms
status: accepted
scope:
  - "src/**"
verify: null
related: [free-plan-bindings-only, fail-open-to-original]
source: better-link-design-spec
adr: null
---
每個請求的 CPU 時間必須在 10ms 以內，subrequest 不超過 50 個。

等待 `fetch()` 不算 CPU 時間，真正花 CPU 的是解析上游頁面，例如約 300KB 的 Instagram embed 頁。解析只取需要的欄位（`EmbeddedMediaImage` 或 `EmbeddedMediaVideo` 的 `src`、`UsernameText`、`Caption`、`hd_src`、`sd_src`），不建完整 DOM，也不在 Worker 裡處理圖片或影片。

限制來源是 https://developers.cloudflare.com/workers/platform/limits/ 。拼圖和影片代理因此不在範圍內；新功能若需要在 Worker 裡做影像處理或大量文字處理，要先寫 ADR 重新決定。

違反時不會被察覺：本機 `wrangler dev` 沒有免費方案的 CPU 上限，超標的程式在開發時完全正常。部署後超標的請求會失敗，而爬蟲拿到失敗只是不顯示預覽，沒有人會回報。

這條目前沒有可執行的 verify，因為 CPU 時間只能從 Workers Logs 觀察（設計文件驗收第 4 步）。存下上游頁面當 fixture 後，可以加本機計時測試當警示，但本機 CPU 時間和 Cloudflare 上的不同，不能取代 Workers Logs。
