---
id: tracking-params-cleaned-at-conversion
status: accepted
scope:
  - "src/**"
verify: check:bun test ./test/clean.test.ts ./test/expand.test.ts
related: [fail-open-to-original]
source: better-link-design-spec
adr: null
---
追蹤碼在產生分享連結時清除：Worker 支援的平台用白名單，其他網址用黑名單，Facebook 和 Instagram 的 `/share/` 短連結在轉換時展開成正式網址。

白名單只保留有功能的參數：Instagram 的 `img_index`，YouTube 的 `v`、`t`、`list`、`index`。黑名單至少包含 `utm_*`、`fbclid`、`gclid`、`igsh`、`igshid`、`mibextid`、`si`、`rdid`、`share_url`、`__cft__`、`__tn__`、`is_from_webapp`、`sender_device`、`refsrc`、`_rdr`；X 與 Twitter 網域另外去掉分享參數 `s`、`t`（只限這些網域，其他網站的 `s`、`t` 可能有功能）；Threads 網域另外去掉分享參數 `xmt`，理由相同。黑名單寫在 `src/clean.ts`，展開寫在 `src/expand.ts`。短連結用 HEAD 請求加 `Go-http-client/1.1` UA 取 `Location` 展開；Instagram 轉到 `/accounts/login` 代表展開失敗；Facebook 展開後還要再去掉 `rdid` 和 `share_url`。

清除規則只寫在 Worker 一處。非爬蟲請求 302 回去的原網址，和失敗時 302 回去的原網址，都經過同一套規則。例外有兩個：展開失敗時（沒有轉址、轉到登入頁或 `unsupportedbrowser`、轉到其他平台、逾時 5 秒、超過 3 次請求），`GET /?url=` 退回用清過 query 的短連結產生分享連結，這是 2026-09-28 的人工決定；分享連結轉址端點 `GET /<原網域>/<路徑>` 不展開短連結。

違反時不會被察覺：沒清乾淨的連結照樣能開、預覽照樣顯示，但 `igsh` 和短連結帶著分享者身分被散出去，使用者無從察覺。

