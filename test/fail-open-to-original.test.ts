import { expect, spyOn, test } from "bun:test";
import { createWorker } from "../src/index";
import { fakeCache } from "./support/fake-cache";

const DISCORD = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";
const POST = "https://bl.example/www.instagram.com/p/BsOGulcndj-/?img_index=2&igsh=xyz";
const CLEANED = "https://www.instagram.com/p/BsOGulcndj-/?img_index=2";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/instagram/${name}`, import.meta.url)).text();
}

async function expectOpen(
  impl: () => Promise<Response>,
  fetches: number,
  requestUrl = POST,
  location = CLEANED,
): Promise<ReturnType<typeof fakeCache>> {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(impl as unknown as typeof fetch);
  try {
    const res = await app.fetch(new Request(requestUrl, { headers: { "User-Agent": DISCORD } }), {} as Env, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(location);
    expect(await res.text()).toBe("");
    expect(spy).toHaveBeenCalledTimes(fetches);
  } finally {
    spy.mockRestore();
  }
  return fake;
}

test("a crawler is redirected when instagram returns 403", async () => {
  await expectOpen(() => Promise.resolve(new Response(null, { status: 403 })), 1);
});

test("a crawler is redirected when instagram returns 500", async () => {
  await expectOpen(() => Promise.resolve(new Response(null, { status: 500 })), 1);
});

test("a crawler is redirected when the embed page is broken", async () => {
  const html = await fixture("embed-B7Y6Y3dF9sq.html");
  await expectOpen(() => Promise.resolve(new Response(html, { status: 200 })), 1);
});

test("a crawler receives an og page for a carousel", async () => {
  const html = await fixture("embed-DOBXTYNklfi.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof fetch,
  );
  try {
    const res = await app.fetch(
      new Request("https://bl.example/www.instagram.com/p/DOBXTYNklfi/", { headers: { "User-Agent": DISCORD } }),
      {} as Env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("a crawler is redirected when instagram sends the login page", async () => {
  await expectOpen(
    () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: "https://www.instagram.com/accounts/login/" },
        }),
      ),
    1,
  );
});

test("a crawler is redirected when the instagram fetch fails", async () => {
  await expectOpen(() => Promise.reject(new TypeError("fetch failed")), 1);
});

test("a crawler is redirected when the cache binding throws", async () => {
  const app = createWorker({
    cache: () => {
      throw new Error("no cache");
    },
  });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
  );
  try {
    const res = await app.fetch(new Request(POST, { headers: { "User-Agent": DISCORD } }), {} as Env, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(CLEANED);
    expect(await res.text()).toBe("");
    expect(spy).toHaveBeenCalledTimes(0);
  } finally {
    spy.mockRestore();
  }
});

test("a crawler is redirected when the embed video is blocked", async () => {
  const html = await fixture("embed-Dd0M_ifNfXO.html");
  const fake = await expectOpen(() => Promise.resolve(new Response(html, { status: 200 })), 1);
  expect(fake.entries.size).toBe(0);
});

test("a crawler on an instagram item link is sent to the post when fetch fails", async () => {
  await expectOpen(
    () => Promise.reject(new TypeError("fetch failed")),
    1,
    "https://bl.example/www.instagram.com/p/DOBXTYNklfi/2",
    "https://www.instagram.com/p/DOBXTYNklfi/",
  );
});

test("a crawler on a reel item link is sent to the reel when fetch fails", async () => {
  await expectOpen(
    () => Promise.reject(new TypeError("fetch failed")),
    1,
    "https://bl.example/www.instagram.com/reel/DJvkjAlvNc8/2",
    "https://www.instagram.com/reel/DJvkjAlvNc8/",
  );
});

test("a crawler on a reel is sent to that reel when fetch fails", async () => {
  await expectOpen(
    () => Promise.reject(new TypeError("fetch failed")),
    1,
    "https://bl.example/www.instagram.com/reel/DJvkjAlvNc8",
    "https://www.instagram.com/reel/DJvkjAlvNc8",
  );
});

test("a crawler asking for a missing carousel item is sent to the post", async () => {
  const html = await fixture("embed-DOBXTYNklfi.html");
  await expectOpen(
    () => Promise.resolve(new Response(html, { status: 200 })),
    1,
    "https://bl.example/www.instagram.com/p/DOBXTYNklfi/3?igsh=x",
    "https://www.instagram.com/p/DOBXTYNklfi/",
  );
});

test("a crawler on a blocked reel is sent to the reel", async () => {
  const html = await fixture("embed-Dd0M_ifNfXO.html");
  const fake = await expectOpen(
    () => Promise.resolve(new Response(html, { status: 200 })),
    1,
    "https://bl.example/www.instagram.com/reel/Dd0M_ifNfXO/?igsh=x",
    "https://www.instagram.com/reel/Dd0M_ifNfXO/",
  );
  expect(fake.entries.size).toBe(0);
});

const MANNY = "https://www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";
const MANNY_SHARE =
  "https://bl.example/www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol?mibextid=wwXIfr";
const MANNY_KEY =
  "https://bl.example/__cache/facebook/v1/www.facebook.com%2Fmannynewsletter%2Fposts%2Fpfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";
const PLUGIN_PREFIX = "https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2F";

function facebookFixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/facebook/${name}`, import.meta.url)).text();
}

async function expectFacebookOpen(impl: () => Promise<Response>): Promise<ReturnType<typeof fakeCache>> {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(impl as unknown as typeof fetch);
  try {
    const res = await app.fetch(new Request(MANNY_SHARE, { headers: { "User-Agent": DISCORD } }), {} as Env, ctx);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toStartWith(PLUGIN_PREFIX);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(MANNY);
    expect(await res.text()).toBe("");
  } finally {
    spy.mockRestore();
  }
  return fake;
}

test("a crawler is redirected when a facebook post is unavailable in traditional chinese", async () => {
  const html = await facebookFixture("unavailable.zh-Hant.html");
  const fake = await expectFacebookOpen(() => Promise.resolve(new Response(html, { status: 200 })));
  expect(fake.entries.size).toBe(0);
});

test("a crawler is redirected when a facebook post is unavailable in english", async () => {
  const html = await facebookFixture("unavailable.en.html");
  await expectFacebookOpen(() => Promise.resolve(new Response(html, { status: 200 })));
});

test("a crawler is redirected when a facebook plugin page is an empty shell", async () => {
  const html = await facebookFixture("empty-shell.html");
  await expectFacebookOpen(() => Promise.resolve(new Response(html, { status: 200 })));
});

test("a crawler is redirected when a facebook post has no image", async () => {
  const html = await facebookFixture("post-personal-text-link.zh-Hant.html");
  await expectFacebookOpen(() => Promise.resolve(new Response(html, { status: 200 })));
});

test("a crawler is redirected when a facebook reel plugin page has no post image", async () => {
  const html = await facebookFixture("reel-via-post-php.zh-Hant.html");
  await expectFacebookOpen(() => Promise.resolve(new Response(html, { status: 200 })));
});

test("a crawler is redirected when facebook returns 500", async () => {
  await expectFacebookOpen(() => Promise.resolve(new Response(null, { status: 500 })));
});

test("a crawler is redirected when facebook redirects to login", async () => {
  await expectFacebookOpen(() =>
    Promise.resolve(new Response(null, { status: 302, headers: { Location: "https://www.facebook.com/login/" } })),
  );
});

test("a crawler is redirected when the facebook fetch fails", async () => {
  await expectFacebookOpen(() => Promise.reject(new TypeError("fetch failed")));
});

test("a crawler is redirected when the facebook cache binding throws", async () => {
  const app = createWorker({
    cache: () => {
      throw new Error("no cache");
    },
  });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
  );
  try {
    const res = await app.fetch(new Request(MANNY_SHARE, { headers: { "User-Agent": DISCORD } }), {} as Env, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(MANNY);
    expect(spy).toHaveBeenCalledTimes(0);
  } finally {
    spy.mockRestore();
  }
});

const REEL = "https://www.facebook.com/reel/1016339268064528";
const REEL_SHARE = "https://bl.example/www.facebook.com/reel/1016339268064528?mibextid=wwXIfr";
const VIDEO_PLUGIN_PREFIX = "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2F";

async function expectFacebookVideoOpen(impl: () => Promise<Response>): Promise<ReturnType<typeof fakeCache>> {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(impl as unknown as typeof fetch);
  try {
    const res = await app.fetch(new Request(REEL_SHARE, { headers: { "User-Agent": DISCORD } }), {} as Env, ctx);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toStartWith(VIDEO_PLUGIN_PREFIX);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(REEL);
    expect(await res.text()).toBe("");
  } finally {
    spy.mockRestore();
  }
  return fake;
}

test("a crawler is redirected when a facebook video is unavailable in traditional chinese", async () => {
  const html = await facebookFixture("video-unavailable.zh-Hant.html");
  const fake = await expectFacebookVideoOpen(() => Promise.resolve(new Response(html, { status: 200 })));
  expect(fake.entries.size).toBe(0);
});

test("a crawler is redirected when a facebook video embed is blocked", async () => {
  const html = await facebookFixture("video-embed-blocked.zh-Hant.html");
  await expectFacebookVideoOpen(() => Promise.resolve(new Response(html, { status: 200 })));
});

test("a crawler is redirected when a facebook video page is an empty shell", async () => {
  const html = await facebookFixture("video-empty-shell.html");
  await expectFacebookVideoOpen(() => Promise.resolve(new Response(html, { status: 200 })));
});

test("a crawler is redirected when facebook video.php returns 500", async () => {
  await expectFacebookVideoOpen(() => Promise.resolve(new Response(null, { status: 500 })));
});

test("a crawler is redirected when facebook video.php redirects to login", async () => {
  await expectFacebookVideoOpen(() =>
    Promise.resolve(new Response(null, { status: 302, headers: { Location: "https://www.facebook.com/login/" } })),
  );
});

test("a crawler is redirected when the facebook video fetch fails", async () => {
  await expectFacebookVideoOpen(() => Promise.reject(new TypeError("fetch failed")));
});

test("a crawler is redirected when the facebook video cache binding throws", async () => {
  const app = createWorker({
    cache: () => {
      throw new Error("no cache");
    },
  });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
  );
  try {
    const res = await app.fetch(new Request(REEL_SHARE, { headers: { "User-Agent": DISCORD } }), {} as Env, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(REEL);
    expect(spy).toHaveBeenCalledTimes(0);
  } finally {
    spy.mockRestore();
  }
});

test("a crawler is redirected when the facebook cache entry is not json", async () => {
  const fake = fakeCache();
  fake.entries.set(MANNY_KEY, new Response("not json"));
  const app = createWorker({ cache: () => fake.cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
  );
  try {
    const res = await app.fetch(new Request(MANNY_SHARE, { headers: { "User-Agent": DISCORD } }), {} as Env, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(MANNY);
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(1);
  } finally {
    spy.mockRestore();
  }
});
