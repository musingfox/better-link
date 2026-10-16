import { expect, test } from "bun:test";
import type { Fetcher } from "../src/expand";
import { facebookPost } from "../src/facebook";
import { readHead, summarize } from "../src/summary";
import { fakeCache } from "./support/fake-cache";

const ORIGIN = "https://bl.example";
const FB_POST =
  "https://www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";

function fixture(path: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/${path}`, import.meta.url)).text();
}

type Call = { url: string; userAgent: string | null };

function serving(routes: Record<string, string>): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: Fetcher = (input, init) => {
    calls.push({ url: input, userAgent: new Headers(init.headers).get("User-Agent") });
    const prefix = Object.keys(routes).find((route) => input.startsWith(route));
    const body = prefix === undefined ? undefined : routes[prefix];
    return Promise.resolve(body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 }));
  };
  return { fetcher, calls };
}

async function summaryOf(url: string, routes: Record<string, string>) {
  const { fetcher, calls } = serving(routes);
  const summary = await summarize(new URL(url), { origin: ORIGIN, cache: fakeCache().cache, fetcher });
  return { summary, calls };
}

test("Instagram uses the embed page the share link parses", async () => {
  const html = await fixture("instagram/embed-BsOGulcndj-.html");
  const { summary } = await summaryOf("https://www.instagram.com/p/BsOGulcndj-/", { "https://www.instagram.com/": html });
  expect(summary?.author).toBe("world_record_egg");
  expect(summary?.text).toStartWith("Let’s set a world record together");
});

test("Facebook uses the plugin page the share link parses", async () => {
  const html = await fixture("facebook/post-1Fu5ScGFUZ.zh-Hant.html");
  const fetcher: Fetcher = () => Promise.resolve(new Response(html, { status: 200 }));
  const post = await facebookPost(new URL(FB_POST), { origin: ORIGIN, cache: fakeCache().cache, fetcher });
  const { summary } = await summaryOf(FB_POST, { "https://www.facebook.com/": html });
  expect(post).not.toBeNull();
  expect(summary).toEqual({ author: post?.username ?? "", text: post?.caption ?? "" });
});

test("YouTube uses the official oEmbed", async () => {
  const { summary, calls } = await summaryOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ", {
    "https://www.youtube.com/oembed?": await fixture("summary/youtube-oembed.json"),
  });
  expect(calls[0]?.url).toBe(
    "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json",
  );
  expect(summary).toEqual({ author: "Rick Astley", text: "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)" });
});

test("X uses the official oEmbed and keeps only the post text", async () => {
  const { summary, calls } = await summaryOf("https://x.com/jack/status/20", {
    "https://publish.x.com/oembed?": await fixture("summary/x-oembed.json"),
  });
  expect(calls[0]?.url).toBe("https://publish.x.com/oembed?url=https%3A%2F%2Fx.com%2Fjack%2Fstatus%2F20&omit_script=1");
  expect(summary).toEqual({ author: "jack", text: "just setting up my twttr" });
});

test("Bluesky resolves the handle and reads the post from the public API", async () => {
  const { summary, calls } = await summaryOf("https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l", {
    "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?": await fixture("summary/bluesky-resolve-handle.json"),
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?": await fixture("summary/bluesky-get-posts.json"),
  });
  expect(calls.map((call) => call.url)).toEqual([
    "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=bsky.app",
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=at%3A%2F%2Fdid%3Aplc%3Az72i7hdynmk6r22z27h6tvur%2Fapp.bsky.feed.post%2F3l6oveex3ii2l",
  ]);
  expect(summary?.author).toBe("Bluesky (@bsky.app)");
  expect(summary?.text).not.toBe("");
});

test("Threads reads the og tags of the original page as a crawler", async () => {
  const { summary, calls } = await summaryOf("https://www.threads.com/@zuck/post/CuP48CiS5sx", {
    "https://www.threads.com/": await fixture("summary/threads.html"),
  });
  expect(calls[0]?.userAgent).toBe("facebookexternalhit/1.1");
  expect(summary).toEqual({ author: "", text: "Mark Zuckerberg (@zuck) on Threads\nLet's do this. Welcome to Threads. 🔥" });
});

test("TikTok, Reddit and Pixiv read the og tags of their fix service", async () => {
  const tiktok = await summaryOf("https://www.tiktok.com/@scout2015/video/6718335390845095173", {
    "https://tnktok.com/": await fixture("summary/tiktok-tnktok.html"),
  });
  expect(tiktok.calls[0]?.url).toBe("https://tnktok.com/@scout2015/video/6718335390845095173");
  expect(tiktok.summary).toEqual({
    author: "",
    text: "Scout, Suki & Stella (@scout2015)\nScramble up ur name & I’ll try to guess it😍❤️ #foryoupage #petsoftiktok #aesthetic",
  });

  const reddit = await summaryOf("https://www.reddit.com/r/announcements/comments/3t0gc0/", {
    "https://vxreddit.com/": await fixture("summary/reddit-vxreddit.html"),
  });
  expect(reddit.summary?.author).toBe("u/rotoreuters on r/betternews - ⬆️ 1 | 💬 0");
  expect(reddit.summary?.text).toStartWith("Protests in South Korea that the media isn't covering.");

  const pixiv = await summaryOf("https://www.pixiv.net/artworks/44298467", {
    "https://phixiv.net/": await fixture("summary/pixiv-phixiv.html"),
  });
  expect(pixiv.summary?.author).toBe("");
  expect(pixiv.summary?.text).toStartWith("うごイラはじめました by (@pixiv事務局)\n");
  expect(pixiv.summary?.text).toContain("#うごイラ");
});

test("an upstream error or an unknown platform gives no summary", async () => {
  expect((await summaryOf("https://www.youtube.com/watch?v=gone", {})).summary).toBeNull();
  expect((await summaryOf("https://bsky.app/profile/nobody.example/post/abc", {})).summary).toBeNull();
  const other = await summaryOf("https://example.com/post/1", {});
  expect(other.summary).toBeNull();
  expect(other.calls).toHaveLength(0);
});

test("readHead stops reading after the limit and cancels the rest", async () => {
  let pulled = 0;
  let cancelled = false;
  const chunk = new Uint8Array(16_384).fill(97);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const head = await readHead(new Response(body), 65_536);
  expect(head.length).toBe(65_536);
  expect(cancelled).toBe(true);
  expect(pulled).toBeLessThanOrEqual(65_536 + 2 * 16_384);
});

test("summary parsing timing (warning only, never fails)", async () => {
  const cases: [string, string, Record<string, string>][] = [
    ["threads", "https://www.threads.com/@zuck/post/CuP48CiS5sx", { "https://www.threads.com/": await fixture("summary/threads.html") }],
    ["tiktok", "https://www.tiktok.com/@scout2015/video/6718335390845095173", { "https://tnktok.com/": await fixture("summary/tiktok-tnktok.html") }],
    ["x", "https://x.com/jack/status/20", { "https://publish.x.com/": await fixture("summary/x-oembed.json") }],
  ];
  for (const [name, url, routes] of cases) {
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      await summaryOf(url, routes);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = ((samples[24] ?? 0) + (samples[25] ?? 0)) / 2;
    if (median > 2) console.warn(`summary median ${name} ${median} ms`);
  }
});
