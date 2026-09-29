# better-link

English | [繁體中文](README.zh-TW.md)

Turns social media post URLs into clean share links that show a proper preview in chat apps.

Instagram and Facebook links pasted into Discord or Telegram often show no preview, or carry tracking parameters such as `igsh` and `fbclid`. better-link is a Cloudflare Worker that does three things:

- Strips tracking parameters and expands Instagram / Facebook `/share/` short links.
- For Instagram posts and Facebook posts and videos, fetches the data itself and serves an og preview page. For multi-image posts you can pick which image to show.
- For X / Twitter, TikTok, Bluesky, Reddit, Pixiv and Threads, hands crawlers off to existing fix services.

When a regular user opens a share link, they get a 302 to the cleaned original URL and never see an intermediate page.

## Usage

The examples below assume the Worker is deployed at `https://link.example`.

### Create a share link

```sh
curl 'https://link.example/?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FABC%2F%3Figsh%3Dxyz'
# https://link.example/www.instagram.com/p/ABC/
```

The `url` parameter must be percent-encoded. Add `raw=1` to get only the cleaned original URL:

```sh
curl 'https://link.example/?url=https%3A%2F%2Fx.com%2Fjack%2Fstatus%2F20%3Fs%3D20&raw=1'
# https://x.com/jack/status/20
```

You can also skip the API and replace `https://` in the original URL with `https://link.example/`. This path also strips tracking parameters, but does not expand `/share/` short links.

### Endpoints

| Request | Response |
| --- | --- |
| `GET /?url=<url>[&raw=1]` | `200 text/plain` with the share link; `400` for an invalid URL |
| `GET /<original host>/<path>` | Crawlers: og preview page or 302 to a fix service. Regular browsers: 302 to the original URL |
| `GET /www.instagram.com/p/<code>/<n>` | The n-th image of a multi-image post (1-based) |
| `GET /media/...` | 302 to a freshly signed CDN image or video URL, used by og tags |

If fetching or parsing fails, a share link always 302s to the cleaned original URL. The worst case is a missing preview, never an error page.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev      # run the Worker locally
bun run check    # typecheck + unit tests
bun run smoke    # end-to-end tests against real Instagram / Facebook, needs network
```

Deploy with wrangler (`bunx wrangler deploy`); configuration lives in `wrangler.jsonc`. The project only uses features of the Workers free plan and needs no bindings.

Design constraints are written in [`docs/spec/`](docs/spec/) (in Traditional Chinese), e.g. the 10ms CPU limit per request, falling back to the original URL on failure, and never putting expiring CDN URLs directly in og tags. Read the relevant specs before changing code. Instructions for AI agents are in [`CLAUDE.md`](CLAUDE.md) (`AGENTS.md` is a symlink to it).
