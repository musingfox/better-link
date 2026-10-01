---
id: cpu-budget-10ms
status: accepted
scope:
  - "src/**"
verify: check:bun test ./test/facebook.test.ts ./test/facebook-video.test.ts ./test/instagram.test.ts -t "10 ms|cpu budget|timing"
related: [free-plan-bindings-only, fail-open-to-original]
source: better-link-design-spec
adr: null
---
每個請求的 CPU 時間必須在 10ms 以內，subrequest 不超過 50 個。

等待 `fetch()` 不算 CPU 時間，真正花 CPU 的是解析上游頁面，例如約 300KB 的 Instagram embed 頁。解析只取需要的欄位：Instagram 單圖取 `EmbeddedMediaImage` 的 `src`、`UsernameText`、`Caption`；影片和多圖取頁尾 `contextJSON`（約在 250KB 處，用 `indexOf` 定位後解碼）；Facebook 取 `hd_src`、`sd_src`。不建完整 DOM，也不在 Worker 裡處理圖片或影片。2026-09-28 部署實測，冷抓取加解析約 285KB 的 embed 頁 CPU 為 1–2 ms。2026-09-28 至 29 在正式環境用 `wrangler tail` 量冷抓取，Facebook 貼文最高 9 ms、Instagram 大型多圖最高 8 ms，其他 1–4 ms（樣本數未記錄），餘裕很小。

限制來源是 https://developers.cloudflare.com/workers/platform/limits/ 。拼圖和影片代理因此不在範圍內；新功能若需要在 Worker 裡做影像處理或大量文字處理，要先寫 ADR 重新決定。

違反時不會被察覺：本機 `cf dev` 沒有免費方案的 CPU 上限，超標的程式在開發時完全正常。部署後超標的請求會失敗，而爬蟲拿到失敗只是不顯示預覽，沒有人會回報。

verify 跑的是對 fixture 的本機計時測試：Facebook 解析的中位數超過 10ms 就失敗，Instagram 超過 2ms 只印警告。這只是警示，本機 CPU 時間和 Cloudflare 上的不同，實際 CPU 時間仍要從 Workers Logs 或 `wrangler tail` 觀察。超標的請求會回 Error 1102，在儀表板 Metrics > Errors > Invocation Statuses 記為 Exceeded CPU Time Limits（outcome 為 `exceededCpu`），來源同上方的 limits 頁。
