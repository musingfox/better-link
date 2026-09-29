import { expect, spyOn, test } from "bun:test";
import { createWorker } from "../src/index";
import { parsePostPage } from "../src/facebook";
import { parseEmbed } from "../src/instagram";
import { fakeCache } from "./support/fake-cache";

const DISCORD = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/instagram/${name}`, import.meta.url)).text();
}

function call(
  app: { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> },
  input: string,
  headers?: HeadersInit,
): Promise<Response> {
  return app.fetch(new Request(input, { headers }), {} as Env, ctx);
}

function htmlResponse(body: string): Promise<Response> {
  return Promise.resolve(new Response(body, { status: 200 }));
}

test("a discord crawler receives an og page pointing at this service", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toContain('<meta property="og:image" content="https://bl.example/media/BsOGulcndj-/1">');
    expect(body).toContain('<meta name="twitter:image" content="https://bl.example/media/BsOGulcndj-/1">');
    expect(body).toContain('<meta property="og:title" content="@world_record_egg">');
    expect(body).toContain('<meta property="og:url" content="https://www.instagram.com/p/BsOGulcndj-/">');
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(body).toContain(
      '<meta http-equiv="refresh" content="0; url=https://www.instagram.com/p/BsOGulcndj-/">',
    );
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("the og page does not embed a cdninstagram url", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/", {
      "User-Agent": DISCORD,
    });
    expect(await res.text()).not.toContain("cdninstagram");
  } finally {
    spy.mockRestore();
  }
});

test("an instagram.com post keeps img_index and points the image at this service", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    const res = await call(
      app,
      "https://bl.example/instagram.com/p/BsOGulcndj-?img_index=2&igsh=xyz",
      { "User-Agent": DISCORD },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      '<meta property="og:url" content="https://instagram.com/p/BsOGulcndj-?img_index=2">',
    );
    expect(body).toContain('<meta property="og:image" content="https://bl.example/media/BsOGulcndj-/1">');
  } finally {
    spy.mockRestore();
  }
});

test("a post with no caption renders an empty og description", async () => {
  const html =
    '<div data-media-type="GraphImage"><span class="UsernameText">u</span><img class="EmbeddedMediaImage" alt="x" src="https://scontent-xyz.cdninstagram.com/v/p.jpg?oe=1"></div>';
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<meta property="og:description" content="">');
  } finally {
    spy.mockRestore();
  }
});

test("a media url redirects to the current signed cdn url", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const mediaUrl = parseEmbed(html)?.media[0]?.url;
  if (mediaUrl === undefined) throw new Error("missing media url");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, "https://bl.example/media/BsOGulcndj-/1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(mediaUrl);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("https://www.instagram.com/p/BsOGulcndj-/embed/captioned/");
  } finally {
    spy.mockRestore();
  }
});

test("a media redirect reuses the post cached for the preview", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const mediaUrl = parseEmbed(html)?.media[0]?.url;
  if (mediaUrl === undefined) throw new Error("missing media url");
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    await call(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/", {
      "User-Agent": DISCORD,
    });
    const res = await call(app, "https://bl.example/media/BsOGulcndj-/1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(mediaUrl);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("a video og page does not embed a cdn address", async () => {
  const html = await fixture("embed-DJvkjAlvNc8.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, "https://bl.example/www.instagram.com/p/DJvkjAlvNc8/", {
      "User-Agent": DISCORD,
    });
    const body = await res.text();
    expect(body).not.toContain("cdninstagram");
    expect(body).not.toContain("fbcdn");
  } finally {
    spy.mockRestore();
  }
});

test("a facebook video og page does not embed a cdn address", async () => {
  const html = await Bun.file(
    new URL("./fixtures/facebook/video-reel-1016339268064528.zh-Hant.html", import.meta.url),
  ).text();
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof fetch,
  );
  try {
    const res = await call(
      app,
      "https://bl.example/www.facebook.com/reel/1016339268064528?mibextid=wwXIfr",
      { "User-Agent": DISCORD },
    );
    const body = await res.text();
    expect(body).not.toContain("fbcdn");
    expect(body).not.toContain("video-tpe");
    expect(body).toContain('content="https://bl.example/media/www.facebook.com/reel/');
  } finally {
    spy.mockRestore();
  }
});

test("a facebook og page does not embed a cdn address", async () => {
  const html = await Bun.file(new URL("./fixtures/facebook/post-1Fu5ScGFUZ.zh-Hant.html", import.meta.url)).text();
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof fetch,
  );
  try {
    const res = await call(
      app,
      "https://bl.example/www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol?mibextid=wwXIfr",
      { "User-Agent": DISCORD },
    );
    const body = await res.text();
    expect(body).not.toContain("fbcdn");
    expect(body).not.toContain("scontent");
    expect(body).toContain('content="https://bl.example/media/www.facebook.com/');
  } finally {
    spy.mockRestore();
  }
});

const MANNY_MEDIA =
  "https://bl.example/media/www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";
const MANNY_SHARE =
  "https://bl.example/www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol?mibextid=wwXIfr";
const MANNY_PLUGIN =
  "https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fmannynewsletter%2Fposts%2Fpfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";
const STORY_PLUGIN =
  "https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fstory.php%3Fstory_fbid%3D1%26id%3D2";

function facebookFixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/facebook/${name}`, import.meta.url)).text();
}

test("a facebook media url redirects to the current signed image", async () => {
  const html = await facebookFixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const image = (await parsePostPage(html))?.media[0]?.url;
  if (image === undefined) throw new Error("missing image");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, MANNY_MEDIA);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(image);
    expect(res.headers.get("location")?.startsWith("https://scontent.xx.fbcdn.net/v/t39.30808-6/823798199_")).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(MANNY_PLUGIN);
  } finally {
    spy.mockRestore();
  }
});

test("a facebook media redirect reuses the preview cache", async () => {
  const html = await facebookFixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const image = (await parsePostPage(html))?.media[0]?.url;
  if (image === undefined) throw new Error("missing image");
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof fetch,
  );
  try {
    await call(app, MANNY_SHARE, { "User-Agent": DISCORD });
    const res = await call(app, MANNY_MEDIA);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(image);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("a facebook story media url redirects to the signed image", async () => {
  const html = await facebookFixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, "https://bl.example/media/www.facebook.com/story.php?story_fbid=1&id=2");
    expect(res.status).toBe(302);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(STORY_PLUGIN);
  } finally {
    spy.mockRestore();
  }
});

test("a facebook media url that is not a post is not found", async () => {
  const urls = [
    "https://bl.example/media/www.facebook.com/1",
    "https://bl.example/media/www.facebook.com/story.php",
    "https://bl.example/media/www.facebook.com/reel/1016339268064528",
    "https://bl.example/media/www.facebook.com.evil.example/a/posts/1",
  ];
  for (const url of urls) {
    const app = createWorker({ cache: () => fakeCache().cache });
    const spy = spyOn(globalThis, "fetch").mockImplementation(
      (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
    );
    try {
      const res = await call(app, url);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe("not found");
      expect(res.headers.get("location")).toBeNull();
      expect(spy).toHaveBeenCalledTimes(0);
    } finally {
      spy.mockRestore();
    }
  }
});

test("a facebook media url is not found when the post has no image", async () => {
  const html = await facebookFixture("unavailable.zh-Hant.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, MANNY_MEDIA);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("a non-facebook media path still uses the instagram route", async () => {
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, "https://bl.example/media/fb/1");
    expect(res.status).toBe(404);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("https://www.instagram.com/p/fb/embed/captioned/");
  } finally {
    spy.mockRestore();
  }
});

test("a facebook media url is not found when the cache binding throws", async () => {
  const app = createWorker({
    cache: () => {
      throw new Error("no cache");
    },
  });
  const res = await call(app, MANNY_MEDIA);
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("not found");
});
