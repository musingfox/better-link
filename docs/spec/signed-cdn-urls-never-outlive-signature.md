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

`/media/<shortcode>/<n>` 與 `/media/www.facebook.com/<路徑>?<query>` 在請求當下重新取得帶簽章的 CDN 網址，再以 `Cache-Control: no-store` 的 302 轉過去。`/media/www.facebook.com/<路徑>?<query>` 也服務 Facebook 影片（reel、`/<page>/videos/`、`/watch/?v=`）。Cache API 的保存時間是 24 小時；Facebook 貼文圖的 `oe` 在 2026-09-28 量到約 104–108 小時後過期（n=122）。Facebook 影片的 `oe` 在 2026-09-29 量到抓取後 32–108 小時過期（n=112），所以 24 小時快取最少仍有約 8 小時餘裕。

分享連結的 og HTML 可以快取 24 小時，因為裡面只有 `/media/` 網址。Instagram 媒體網址的簽章 `oe` 在 2026-09-28 量到：圖片約 104–108 小時、影片 32–106 小時後過期，所以 24 小時快取最少仍有約 8 小時餘裕；快取時間不可再拉長。

違反時不會被察覺：直接把 CDN 網址寫進 og 標籤的版本，在貼上當下完全正常。幾天後 Discord 重新抓預覽時簽章已經過期，舊訊息的圖片和影片默默變成破圖。

