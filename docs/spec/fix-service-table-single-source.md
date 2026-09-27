---
id: fix-service-table-single-source
status: accepted
scope:
  - "src/**"
verify: null
related: []
source: better-link-design-spec
adr: null
---
其他平台要轉到哪個修正服務，只由一張對照表決定。

2026-09-27 確認可用的對照是：X 和 Twitter 轉 `fixupx.com`，TikTok 轉 `tnktok.com`，Bluesky 轉 `bskx.app`，Reddit 轉 `vxreddit.com`，Pixiv 轉 `phixiv.net`，Threads 轉 `fixthreads.seria.moe`。平台辨識和 302 目的地都查這張表，其他程式碼不寫死任何修正服務的網域。

表裡的網域隨時可以改，這條只要求它存在一處。Instagram 和 Facebook 不在表中，由 Worker 自己抓資料。

違反時不會被察覺：修正服務常關站或換網域。網域若散在兩處，改表之後另一處仍指向失效的服務，兩條路徑都還能執行，只是其中一條的預覽默默消失。

這條目前沒有可執行的 verify，因為對照表還不存在。對照表建立後，改成 check：每個修正服務網域在 `src/` 下只出現在對照表那一個檔案（測試檔除外）。
