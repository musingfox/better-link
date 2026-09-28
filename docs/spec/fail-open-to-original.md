---
id: fail-open-to-original
status: accepted
scope:
  - "src/**"
verify: check:bun test ./test/fail-open-to-original.test.ts
related: [cpu-budget-10ms, tracking-params-cleaned-at-conversion]
source: better-link-design-spec
adr: null
---
分享連結端點 `GET /<原網域>/<路徑>` 在抓取或解析失敗時，一律 302 回清理後的原網址，不回錯誤頁，也不回缺少媒體的 og 頁。

抓取和解析包在同一個失敗邊界裡。邊界內的例外、上游非 200 回應、找不到必要欄位，都走同一個 302。已知的失敗訊號包括：Instagram 被導到 `/accounts/login` 或 `unsupportedbrowser`、embed 頁只顯示 `WatchOnInstagram`、Facebook 頁面出現「已無法取得使用」或 "isn't available"。

這條只管分享連結端點。`GET /?url=` 轉換端點和 `/media/` 端點的錯誤處理不在範圍內。

違反時不會被察覺：分享連結的主要消費者是 Discord 和 Telegram 的爬蟲，拿到錯誤頁或缺欄位的 og 頁只會默默不顯示預覽；點進連結的人則看到錯誤頁而不是原貼文，通常不會回報。

