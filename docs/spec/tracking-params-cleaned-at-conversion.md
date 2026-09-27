---
id: tracking-params-cleaned-at-conversion
status: accepted
scope:
  - "src/**"
verify: null
related: [fail-open-to-original]
source: better-link-design-spec
adr: null
---
追蹤碼在產生分享連結時清除：Worker 支援的平台用白名單，其他網址用黑名單，Facebook 和 Instagram 的 `/share/` 短連結在轉換時展開成正式網址。

白名單只保留有功能的參數，例如 Instagram 的 `img_index`、YouTube 的 `v` 和 `t`。黑名單至少包含 `utm_*`、`fbclid`、`gclid`、`igsh`、`igshid`、`mibextid`、`si`、`rdid`、`share_url`、`__cft__`、`__tn__`、`is_from_webapp`、`sender_device`。短連結用 HEAD 請求加 `Go-http-client/1.1` UA 取 `Location` 展開；Instagram 轉到 `/accounts/login` 代表展開失敗；Facebook 展開後還要再去掉 `rdid` 和 `share_url`。

清除規則只寫在 Worker 一處。非爬蟲請求 302 回去的原網址，和失敗時 302 回去的原網址，都經過同一套規則。

違反時不會被察覺：沒清乾淨的連結照樣能開、預覽照樣顯示，但 `igsh` 和短連結帶著分享者身分被散出去，使用者無從察覺。

這條目前沒有可執行的 verify，因為清除函式還不存在。設計文件要求它有固定輸入和預期輸出的單元測試；測試寫好後，用 check 執行該測試檔綁定。
