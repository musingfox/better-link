---
id: signed-cdn-urls-never-outlive-signature
status: accepted
scope:
  - "src/**"
verify: null
related: [free-plan-bindings-only]
source: better-link-design-spec
adr: null
---
og 標籤裡的圖片和影片網址一律指向本服務的 `/media/...`，不直接放 CDN 網址；任何含有 CDN 網址的快取項目，保存時間都要短於簽章期限。

`/media/...` 在請求當下重新取得帶簽章的 CDN 網址，再 302 過去。Cache API 的保存時間是 24 小時；Facebook 媒體網址大約 4 天後過期。

分享連結的 og HTML 可以快取 24 小時，因為裡面只有 `/media/` 網址。Instagram 媒體網址的過期期限還沒量過，在量到之前同樣適用 24 小時。

違反時不會被察覺：直接把 CDN 網址寫進 og 標籤的版本，在貼上當下完全正常。幾天後 Discord 重新抓預覽時簽章已經過期，舊訊息的圖片和影片默默變成破圖。

這條目前沒有可執行的 verify，因為端點還不存在。端點實作後，寫單元測試斷言 og:image 和 og:video 的值都以本服務的 `/media/` 開頭，再用 check 執行該測試檔綁定。
