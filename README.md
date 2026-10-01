# better-link

English | [繁體中文](README.zh-TW.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/musingfox/better-link)

Turns social media post URLs into clean share links that show a proper preview in chat apps.

Instagram and Facebook links pasted into Discord or Telegram often show no preview, or carry tracking parameters such as `igsh` and `fbclid`. better-link is a Cloudflare Worker that does three things:

- Strips tracking parameters and expands Instagram / Facebook `/share/` short links.
- For Instagram posts and Facebook posts and videos, fetches the data itself and serves an og preview page. For multi-image posts you can pick which image to show.
- For X / Twitter, TikTok, Bluesky, Reddit, Pixiv and Threads, hands crawlers off to existing fix services.

It offers two modes: clean the URL only, or also get a share link that embeds properly. See below.

## Two modes

better-link produces two kinds of links. Pick based on whether you want better-link to stay in the path.

| | Clean only | Share link with embed |
| --- | --- | --- |
| How to get it | `GET /?url=<url>&raw=1` | `GET /?url=<url>`, or replace `https://` with `https://link.example/` |
| What you get | `https://www.instagram.com/p/ABC/` | `https://link.example/www.instagram.com/p/ABC/` |
| Tracking parameters | Removed | Removed |
| `/share/` short links | Expanded | Expanded (via `/?url=` only) |
| Preview in chat apps | Whatever the platform gives you, often none for Instagram / Facebook | og preview from better-link or a fix service |
| Depends on better-link after sharing | No, it is the platform's own URL | Yes, every open goes through the Worker |

In both modes a person who opens the link ends up on the cleaned original URL. The difference is only what crawlers see.

### Clean only

Returns the cleaned original URL as plain text. Use this when you want to drop tracking parameters and keep a plain platform URL, for example to archive or to share where previews do not matter.

```sh
curl 'https://link.example/?url=https%3A%2F%2Fx.com%2Fjack%2Fstatus%2F20%3Fs%3D20&raw=1'
# https://x.com/jack/status/20
```

### Share link with embed

Returns a link on the better-link domain. When a chat app's crawler fetches it, better-link answers depending on the platform:

- Instagram posts, Facebook posts and videos: the Worker fetches the post itself and returns og / twitter card HTML. For multi-image Instagram posts, append `/<n>` to pick the n-th image (1-based).
- X / Twitter, TikTok, Bluesky, Reddit, Pixiv, Threads: 302 to an existing fix service that renders the embed.
- Everything else: 302 to the cleaned original URL, so no better preview than the original.

Regular browsers always get a 302 to the cleaned original URL and never see an intermediate page. If fetching or parsing fails, crawlers also get that 302: the worst case is a missing preview, never an error page.

```sh
curl 'https://link.example/?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FABC%2F%3Figsh%3Dxyz'
# https://link.example/www.instagram.com/p/ABC/
```

You can also skip the API and replace `https://` in the original URL with `https://link.example/`. This also strips tracking parameters, but does not expand `/share/` short links.

The `url` parameter must be percent-encoded in both modes. The examples assume the Worker is deployed at `https://link.example`.

## Endpoints

| Request | Response |
| --- | --- |
| `GET /?url=<url>[&raw=1]` | `200 text/plain` with the link; `400` for an invalid URL |
| `GET /<original host>/<path>` | Crawlers: og preview page or 302 to a fix service. Regular browsers: 302 to the original URL |
| `GET /www.instagram.com/p/<code>/<n>` | The n-th image of a multi-image post (1-based) |
| `GET /media/...` | 302 to a freshly signed CDN image or video URL, used by og tags |

## Deploy your own

Click the button to deploy your own copy to Cloudflare:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/musingfox/better-link)

Cloudflare copies this repository into your GitHub or GitLab account, builds it and deploys the Worker, and connects Workers Builds so that every push to the copy redeploys it. You only need a Cloudflare account; the Workers free plan is enough, and there are no bindings, variables or secrets to fill in. You can rename the Worker on the setup page.

Once deployed, the Worker is reachable at `https://better-link.<your-subdomain>.workers.dev` (or under the name you picked). Use that as `https://link.example` in the examples above, or attach a custom domain in the Cloudflare dashboard.

To deploy manually instead:

```sh
bun install
npx cf auth login   # once; cf does not reuse a Wrangler login
bun run deploy      # cf deploy
```

## Development

Requires [Bun](https://bun.sh) and Node.js 22.18 or later.

```sh
bun install
bun run dev      # run the Worker locally
bun run check    # typecheck + unit tests
bun run smoke    # end-to-end tests against real Instagram / Facebook, needs network
```

Configuration lives in `cloudflare.config.ts`. The project only uses features of the Workers free plan and needs no bindings.

Design constraints are written in [`docs/spec/`](docs/spec/) (in Traditional Chinese), e.g. the 10ms CPU limit per request, falling back to the original URL on failure, and never putting expiring CDN URLs directly in og tags. Read the relevant specs before changing code. Instructions for AI agents are in [`CLAUDE.md`](CLAUDE.md) (`AGENTS.md` is a symlink to it).
