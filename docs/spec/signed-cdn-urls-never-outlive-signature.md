---
id: signed-cdn-urls-never-outlive-signature
status: accepted
scope:
  - "src/**"
verify: check:bun test ./test/signed-cdn-urls-never-outlive-signature.test.ts
related: [free-plan-bindings-only]
source: better-link-design-spec
adr: null
---
og 標籤裡的圖片和影片網址一律指向本服務的 `/media/...`，不直接放 CDN 網址；任何含有 CDN 網址的快取項目，保存時間都要短於簽章期限。

`/media/<shortcode>/<n>` 在請求當下重新取得帶簽章的 CDN 網址，再以 `Cache-Control: no-store` 的 302 轉過去。Cache API 的保存時間是 24 小時；Facebook 媒體網址大約 4 天後過期。

分享連結的 og HTML 可以快取 24 小時，因為裡面只有 `/media/` 網址。Instagram 媒體網址的過期期限還沒量過，在量到之前同樣適用 24 小時。

違反時不會被察覺：直接把 CDN 網址寫進 og 標籤的版本，在貼上當下完全正常。幾天後 Discord 重新抓預覽時簽章已經過期，舊訊息的圖片和影片默默變成破圖。

