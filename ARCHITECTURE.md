# Architecture

## Bird's-eye view

better-link is a single Cloudflare Worker with three kinds of request. A conversion (`GET /?url=`) returns a cleaned share link. A share link (`GET /<original host>/<path>`) sends people to the cleaned original URL and gives crawlers a preview. A media request (`GET /media/...`) redirects to a freshly signed CDN URL. For Instagram and Facebook the Worker fetches and parses the post itself; for other platforms in the fix-service table it hands crawlers to a fix service.

## Codemap

- `src/index.ts` is the only entry point. `createWorker` routes `/` to `convert`, paths under `/media/` to `mediaRedirect`, `/log` to `sharedLinkLogPage` when the log binding exists, and every other path to `shareRedirect`.
- `src/clean.ts` removes tracking parameters (`cleanUrl`).
- `src/expand.ts` expands `/share/` short links (`expandShareLink`) and decides which URLs can be converted (`isShareable`).
- `src/crawler.ts` tells crawlers from people by User-Agent (`isCrawler`).
- `src/fix-services.ts` maps other platforms to fix services (`fixServiceUrl`).
- `src/instagram.ts` fetches the `/embed/captioned/` page and parses it into a `Post` (`instagramPost`, `parseEmbed`). The `Post` and `PostCache` types live here.
- `src/facebook.ts` fetches `plugins/post.php` and `plugins/video.php` and parses them into a `Post` (`facebookPost`, `facebookVideo`).
- `src/og.ts` renders a `Post` into og and twitter card HTML (`renderOgPage`).
- `cloudflare.config.ts` holds the Worker settings that `cf` reads. It declares the `SHARED_LINKS` KV binding only when the build variable `LOG_SHARED_LINKS` is `1`.
- `src/shared-link-log.ts` (`logSharedLink`) writes one record per successful `GET /?url=` to `env.SHARED_LINKS` through `ctx.waitUntil`. Without the binding it does nothing.
- `src/shared-link-log-page.ts` (`sharedLinkLogPage`) renders `GET /log`: cursor pages of 30 keys (newest first, since keys start with an inverted timestamp), a URL search bounded to three `list` calls, and previews that point at the same `/media/` URLs as the share link's og page. It answers only when Cloudflare Access set `ctx.access`. Without the binding `/log` falls through to `shareRedirect`.

## Invariants

The rules a change must not break are in `docs/spec/`. Each spec's `scope` names the files it constrains.

## Cross-cutting concerns

- Caching: `instagram.ts` and `facebook.ts` store parsed posts with the Cache API through `PostCache`. `createWorker({ cache })` takes the cache as a dependency.
- Testing: tests pass a fake cache from `test/support/fake-cache.ts` and a fake KV binding from `test/support/fake-kv.ts`, and replace `fetch` with `spyOn(globalThis, "fetch")`. Upstream pages are saved under `test/fixtures/`, and every parsing test runs against them without the network.
