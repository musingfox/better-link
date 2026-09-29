import { fileURLToPath } from "node:url";
import { expect, spyOn, test } from "bun:test";
import { cleanUrl } from "../src/clean";
import worker, { createWorker } from "../src/index";
import { parseEmbed } from "../src/instagram";
import { fakeCache } from "./support/fake-cache";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

function call(input: string, headers?: HeadersInit): Promise<Response> {
  return worker.fetch(new Request(input, { headers }), {} as Env, ctx);
}

const FB_POST_LOC =
  "https://www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol?rdid=VGXEydyR2cRY58Er&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fp%2F1Fu5ScGFUZ%2F";
const FB_REEL_LOC =
  "https://www.facebook.com/reel/1016339268064528?rdid=yW04JMxj7FGRfmRn&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fv%2F1HSGH1rf7o%2F";
const IG_REEL_LOC = "https://www.instagram.com/reel/DJvkjAlvNc8/?igsh=QkFfQVp3Q3ZnTw%3D%3D";
const M_LOC =
  "https://m.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol?rdid=JoOqIJIyWQqLPTAT&share_url=https%3A%2F%2Fm.facebook.com%2Fshare%2Fp%2F1Fu5ScGFUZ%2F&refsrc=deprecated&_rdr";

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

function stubFetch(impl: () => Promise<Response>) {
  return spyOn(globalThis, "fetch").mockImplementation(impl as unknown as typeof fetch);
}

test("missing url is a plain-text 400 that mentions ?url=", async () => {
  const res = await call("https://bl.example/");
  expect(res.status).toBe(400);
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await res.text()).toContain("?url=");
});

test("empty url is rejected", async () => {
  expect((await call("https://bl.example/?url=")).status).toBe(400);
});

test("an unparseable url is rejected", async () => {
  expect((await call("https://bl.example/?url=not%20a%20url")).status).toBe(400);
});

test("a javascript url is rejected", async () => {
  expect((await call("https://bl.example/?url=javascript%3Aalert(1)")).status).toBe(400);
});

test("a non-http scheme is rejected", async () => {
  expect((await call("https://bl.example/?url=ftp%3A%2F%2Fexample.com%2Fa")).status).toBe(400);
});

test("a url without a scheme is rejected and not given one", async () => {
  expect((await call("https://bl.example/?url=instagram.com%2Fp%2FABC%2F")).status).toBe(400);
});

test("a non-default port is rejected", async () => {
  expect((await call("https://bl.example/?url=https%3A%2F%2Fwww.example.com%3A8443%2Fa")).status).toBe(400);
});

test("userinfo is rejected and never echoed", async () => {
  const res = await call("https://bl.example/?url=https%3A%2F%2Falice%3As3cr3t%40example.com%2Fa");
  expect(res.status).toBe(400);
  const body = await res.text();
  expect(body).not.toContain("alice");
  expect(body).not.toContain("s3cr3t");
});

test("a hostname without a dot is rejected", async () => {
  expect((await call("https://bl.example/?url=https%3A%2F%2Flocalhost%2Fa")).status).toBe(400);
});

test("a youtube url becomes a plain-text share link on this origin", async () => {
  const res = await call(
    "https://bl.example/?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ%26t%3D42%26si%3Dabc",
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await res.text()).toBe("https://bl.example/www.youtube.com/watch?v=dQw4w9WgXcQ&t=42");
});

test("facebook tracking parameters are removed from the share link", async () => {
  const res = await call(
    "https://bl.example/?url=https%3A%2F%2Fwww.facebook.com%2Freel%2F1016339268064528%3Fmibextid%3DwwXIfr",
  );
  expect(await res.text()).toBe("https://bl.example/www.facebook.com/reel/1016339268064528");
});

test("the original scheme and fragment are not carried", async () => {
  const res = await call(
    "https://bl.example/?url=http%3A%2F%2Fexample.com%2Fa%3Futm_source%3Dx%26id%3D1%23frag",
  );
  expect(await res.text()).toBe("https://bl.example/example.com/a?id=1");
});

test("the share link uses the request origin", async () => {
  const res = await call("http://localhost:8787/?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FABC%2F%3Figsh%3Dx");
  expect(await res.text()).toBe("http://localhost:8787/www.instagram.com/p/ABC/");
});

test("a url with no path still gets a slash", async () => {
  const res = await call("https://bl.example/?url=https%3A%2F%2Fwww.youtube.com");
  expect(await res.text()).toBe("https://bl.example/www.youtube.com/");
});

test("the share link body has no trailing newline", async () => {
  const res = await call("https://bl.example/?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc");
  const body = await res.text();
  expect(body).toBe("https://bl.example/www.youtube.com/watch?v=abc");
  expect(body.endsWith("\n")).toBe(false);
});

test("the default https port is accepted", async () => {
  const res = await call("https://bl.example/?url=https%3A%2F%2Fwww.example.com%3A443%2Fa");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("https://bl.example/www.example.com/a");
});

test("favicon is a plain-text 404 with no location", async () => {
  const res = await call("https://bl.example/favicon.ico");
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(res.headers.get("location")).toBeNull();
  expect(await res.text()).toBe("not found");
});

test("robots.txt is not a share link", async () => {
  expect((await call("https://bl.example/robots.txt")).status).toBe(404);
});

test("a media path is not a share link", async () => {
  expect((await call("https://bl.example/media/abc123")).status).toBe(404);
});

test("a media index past a single image is not found", async () => {
  const html = await Bun.file(new URL("./fixtures/instagram/embed-BsOGulcndj-.html", import.meta.url)).text();
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/media/BsOGulcndj-/2");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("not found");
    expect(res.headers.get("location")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("a media url with a trailing slash is not found", async () => {
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await call("https://bl.example/media/BsOGulcndj-/1/");
    expect(res.status).toBe(404);
    expect(spy).toHaveBeenCalledTimes(0);
  } finally {
    spy.mockRestore();
  }
});

test("a media url with an invalid shortcode is not found", async () => {
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await call("https://bl.example/media/bad.id/1");
    expect(res.status).toBe(404);
    expect(spy).toHaveBeenCalledTimes(0);
  } finally {
    spy.mockRestore();
  }
});

test("a media url is not found when instagram refuses the embed", async () => {
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(null, { status: 403 })));
  try {
    const res = await callWorker(app, "https://bl.example/media/BsOGulcndj-/1");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("not found");
    expect(res.headers.get("location")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("a carousel's first item redirects to that item's cdn url", async () => {
  const html = await Bun.file(
    new URL("./fixtures/instagram/embed-DOBXTYNklfi.html", import.meta.url),
  ).text();
  const mediaUrl = parseEmbed(html)?.media[0]?.url;
  if (mediaUrl === undefined) throw new Error("missing media url");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/media/DOBXTYNklfi/1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(mediaUrl);
    expect(res.headers.get("cache-control")).toBe("no-store");
  } finally {
    spy.mockRestore();
  }
});

test("a host segment without a following slash is not a share link", async () => {
  expect((await call("https://bl.example/www.youtube.com")).status).toBe(404);
});

test("an empty host segment is not a share link", async () => {
  expect((await call("https://bl.example//www.example.com/a")).status).toBe(404);
});

test("localhost is not a share link", async () => {
  expect((await call("https://bl.example/localhost/a")).status).toBe(404);
});

test("a host segment with a non-default port is not a share link", async () => {
  expect((await call("https://bl.example/www.example.com:8443/a")).status).toBe(404);
});

test("userinfo in the path is not echoed", async () => {
  const res = await call("https://bl.example/alice:s3cr3t@evil.example/x");
  expect(res.status).toBe(404);
  const body = await res.text();
  expect(body).not.toContain("s3cr3t");
  expect(body).not.toContain("evil");
});

test("an encoded at-sign in the host segment is not a share link", async () => {
  expect((await call("https://bl.example/good.example%40evil.example/x")).status).toBe(404);
});

test("a share link redirects to the cleaned https url", async () => {
  const res = await call("https://bl.example/www.facebook.com/reel/1016339268064528");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://www.facebook.com/reel/1016339268064528");
});

test("a share link is cleaned again instead of trusting the query", async () => {
  const res = await call("https://bl.example/www.youtube.com/watch?v=abc&t=10&si=zz&utm_source=x");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://www.youtube.com/watch?v=abc&t=10");
});

test("opening a converted share link lands on the cleaned original", async () => {
  const original = "https://www.instagram.com/p/ABC/?img_index=2&igsh=xyz";
  const share = await (await call(`https://bl.example/?url=${encodeURIComponent(original)}`)).text();
  const res = await call(share);
  expect(res.status).toBe(302);
  const location = res.headers.get("location");
  expect(location).toBe("https://www.instagram.com/p/ABC/?img_index=2");
  expect(location).toBe(cleanUrl(new URL(original)).href);
});

test("a discord crawler on an instagram post is sent back when fetch fails", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/ABC/", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/p/ABC/");
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("the host segment is matched case-insensitively", async () => {
  const res = await call("https://bl.example/WWW.Example.COM/a");
  expect(res.headers.get("location")).toBe("https://www.example.com/a");
});

test("encoded path bytes are preserved in the redirect", async () => {
  const res = await call("https://bl.example/www.example.com/a%2Fb/%E4%B8%AD");
  expect(res.headers.get("location")).toBe("https://www.example.com/a%2Fb/%E4%B8%AD");
});

test("encoded query bytes are preserved while tracking parameters are removed", async () => {
  const res = await call("https://bl.example/example.com/a?q=a%20b&r=c~d&t=x+y&fbclid=1");
  expect(res.headers.get("location")).toBe("https://example.com/a?q=a%20b&r=c~d&t=x+y");
});

test("a host with only a slash redirects to the site root", async () => {
  const res = await call("https://bl.example/www.youtube.com/");
  expect(res.headers.get("location")).toBe("https://www.youtube.com/");
});

test("tracking parameter names appear only in the cleaner module", async () => {
  const pattern = /fbclid|igsh|img_index|utm_/;
  const root = new URL("../src/", import.meta.url);
  const matches: string[] = [];
  for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: fileURLToPath(root.href) })) {
    const text = await Bun.file(new URL(file, root)).text();
    if (pattern.test(text)) matches.push(file);
  }
  expect(matches).toContain("clean.ts");
  expect(matches.filter((file) => file !== "clean.ts")).toEqual([]);
});

test("a facebook post share link converts to the cleaned canonical share link", async () => {
  const spy = stubFetch(() => Promise.resolve(redirectTo(FB_POST_LOC)));
  try {
    const res = await call(
      `https://bl.example/?url=${encodeURIComponent("https://www.facebook.com/share/p/1Fu5ScGFUZ/")}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(
      "https://bl.example/www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol",
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("https://www.facebook.com/share/p/1Fu5ScGFUZ/");
  } finally {
    spy.mockRestore();
  }
});

test("a facebook reel share link converts to the cleaned reel share link", async () => {
  const spy = stubFetch(() => Promise.resolve(redirectTo(FB_REEL_LOC)));
  try {
    const res = await call(
      `https://bl.example/?url=${encodeURIComponent("https://www.facebook.com/share/v/1HSGH1rf7o/")}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("https://bl.example/www.facebook.com/reel/1016339268064528");
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("an instagram reel share link converts to the cleaned reel share link", async () => {
  const spy = stubFetch(() => Promise.resolve(redirectTo(IG_REEL_LOC)));
  try {
    const res = await call(
      `https://bl.example/?url=${encodeURIComponent("https://www.instagram.com/share/reel/_gdkGEJBn/")}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("https://bl.example/www.instagram.com/reel/DJvkjAlvNc8/");
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("a mobile facebook share link converts to the cleaned mobile canonical url", async () => {
  const spy = stubFetch(() => Promise.resolve(redirectTo(M_LOC)));
  try {
    const res = await call(
      `https://bl.example/?url=${encodeURIComponent("https://m.facebook.com/share/p/1Fu5ScGFUZ/")}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(
      "https://bl.example/m.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol",
    );
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("a share link that does not redirect converts from the cleaned short link", async () => {
  const spy = stubFetch(() => Promise.resolve(new Response(null, { status: 200 })));
  try {
    const res = await call(
      `https://bl.example/?url=${encodeURIComponent("https://www.facebook.com/share/p/1Fu5ScGFUZ/?mibextid=wwXIfr")}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("https://bl.example/www.facebook.com/share/p/1Fu5ScGFUZ/");
  } finally {
    spy.mockRestore();
  }
});

test("a failed share-link fetch converts from the cleaned short link", async () => {
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await call(
      `https://bl.example/?url=${encodeURIComponent("https://www.instagram.com/share/reel/_gdkGEJBn/?igsh=QkFfQVp3Q3ZnTw%3D%3D")}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("https://bl.example/www.instagram.com/share/reel/_gdkGEJBn/");
  } finally {
    spy.mockRestore();
  }
});

test("an unsupported-browser redirect converts from the cleaned short link", async () => {
  const spy = stubFetch(() => Promise.resolve(redirectTo("https://www.facebook.com/unsupportedbrowser")));
  try {
    const res = await call(
      `https://bl.example/?url=${encodeURIComponent("https://www.facebook.com/share/p/1Fu5ScGFUZ/")}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("https://bl.example/www.facebook.com/share/p/1Fu5ScGFUZ/");
  } finally {
    spy.mockRestore();
  }
});

test("share-link expansion sends only the fixed upstream user agent", async () => {
  const spy = stubFetch(() => Promise.resolve(redirectTo(FB_POST_LOC)));
  try {
    await call(
      `https://bl.example/?url=${encodeURIComponent("https://www.facebook.com/share/p/1Fu5ScGFUZ/")}`,
      {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        Cookie: "c_user=1; xs=s3cr3t",
        Authorization: "Bearer s3cr3t",
      },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0]?.[1];
    expect([...(new Headers(init?.headers).keys())]).toEqual(["user-agent"]);
    expect(new Headers(init?.headers).get("user-agent")).toBe("Go-http-client/1.1");
    expect(
      JSON.stringify([spy.mock.calls[0]?.[0], [...new Headers(spy.mock.calls[0]?.[1]?.headers)]]),
    ).not.toContain("s3cr3t");
  } finally {
    spy.mockRestore();
  }
});

test("an aborted share-link fetch converts from the cleaned short link", async () => {
  const spy = stubFetch(() => Promise.reject(new DOMException("The operation was aborted.", "AbortError")));
  try {
    const res = await call(
      `https://bl.example/?url=${encodeURIComponent("https://www.facebook.com/share/p/1Fu5ScGFUZ/")}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("https://bl.example/www.facebook.com/share/p/1Fu5ScGFUZ/");
  } finally {
    spy.mockRestore();
  }
});

test("opening a facebook share path redirects to the cleaned short link without fetching", async () => {
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await call("https://bl.example/www.facebook.com/share/p/1Fu5ScGFUZ/?mibextid=wwXIfr");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.facebook.com/share/p/1Fu5ScGFUZ/");
    expect(spy).toHaveBeenCalledTimes(0);
  } finally {
    spy.mockRestore();
  }
});

test("opening an instagram share path redirects to the cleaned short link without fetching", async () => {
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await call(
      "https://bl.example/www.instagram.com/share/reel/_gdkGEJBn/?igsh=QkFfQVp3Q3ZnTw%3D%3D",
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/share/reel/_gdkGEJBn/");
    expect(spy).toHaveBeenCalledTimes(0);
  } finally {
    spy.mockRestore();
  }
});

const DISCORD = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";

test("a discord crawler on x.com is redirected to the fix service", async () => {
  const res = await call("https://bl.example/x.com/jack/status/20", { "User-Agent": DISCORD });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://fixupx.com/jack/status/20");
});

test("a discord crawler on tiktok is redirected to the fix service", async () => {
  const res = await call("https://bl.example/www.tiktok.com/@scout2015/video/6718335390845095173", {
    "User-Agent": DISCORD,
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(
    "https://tnktok.com/@scout2015/video/6718335390845095173",
  );
});

test("a discord crawler on bluesky is redirected to the fix service", async () => {
  const res = await call("https://bl.example/bsky.app/profile/bsky.app/post/3mw2cdr44fc2a", {
    "User-Agent": DISCORD,
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://bskx.app/profile/bsky.app/post/3mw2cdr44fc2a");
});

test("a discord crawler on reddit is redirected to the fix service", async () => {
  const res = await call("https://bl.example/www.reddit.com/r/IAmA/comments/z1c9z/", {
    "User-Agent": DISCORD,
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://vxreddit.com/r/IAmA/comments/z1c9z/");
});

test("a discord crawler on pixiv is redirected to the fix service", async () => {
  const res = await call("https://bl.example/www.pixiv.net/en/artworks/150105774", {
    "User-Agent": DISCORD,
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://phixiv.net/en/artworks/150105774");
});

test("a discord crawler on threads is redirected to the fix service", async () => {
  const res = await call("https://bl.example/www.threads.com/@zuck/post/CuP48CiS5sx", {
    "User-Agent": DISCORD,
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://fixthreads.seria.moe/@zuck/post/CuP48CiS5sx");
});

test("a telegram crawler keeps the functional query on the fix service", async () => {
  const res = await call("https://bl.example/twitter.com/jack/status/20?s=20&utm_source=x&fbclid=1", {
    "User-Agent": "TelegramBot (like TwitterBot)",
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://fixupx.com/jack/status/20?s=20");
});

test("a discord crawler keeps a pixiv illustration query on the fix service", async () => {
  const res = await call(
    "https://bl.example/www.pixiv.net/member_illust.php?mode=medium&illust_id=150105774",
    { "User-Agent": DISCORD },
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(
    "https://phixiv.net/member_illust.php?mode=medium&illust_id=150105774",
  );
});

test("a discord crawler matches the source host regardless of letter case", async () => {
  const res = await call("https://bl.example/X.COM/jack/status/20", { "User-Agent": DISCORD });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://fixupx.com/jack/status/20");
});

test("a discord crawler keeps a double slash on the fix service host", async () => {
  const res = await call("https://bl.example/x.com//evil.example/a", { "User-Agent": DISCORD });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://fixupx.com//evil.example/a");
});

test("a discord crawler on a listed host root is redirected to the fix service root", async () => {
  const res = await call("https://bl.example/x.com/", { "User-Agent": DISCORD });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://fixupx.com/");
});

test("a discord crawler on a listed host does not fetch", async () => {
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await call("https://bl.example/vm.tiktok.com/ZMabc123/", { "User-Agent": DISCORD });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://tnktok.com/ZMabc123/");
    expect(spy).toHaveBeenCalledTimes(0);
  } finally {
    spy.mockRestore();
  }
});

test("a crawler redirect does not leak request headers", async () => {
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await call("https://bl.example/x.com/jack/status/20", {
      "User-Agent": DISCORD,
      Cookie: "session=s3cr3t",
      Authorization: "Bearer s3cr3t",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe("https://fixupx.com/jack/status/20");
    expect(spy).toHaveBeenCalledTimes(0);
    const body = await res.text();
    const dumped = `${location}\n${body}\n${[...res.headers].map(([name, value]) => `${name}: ${value}`).join("\n")}`;
    expect(dumped).not.toContain("s3cr3t");
    expect(dumped).not.toContain(DISCORD);
  } finally {
    spy.mockRestore();
  }
});

test("a crawler still gets not found when the host has no slash", async () => {
  const res = await call("https://bl.example/x.com", { "User-Agent": DISCORD });
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("not found");
  expect(res.headers.get("location")).toBeNull();
});

test("a crawler still gets not found for a host without a dot", async () => {
  const res = await call("https://bl.example/localhost/a", { "User-Agent": DISCORD });
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("not found");
});

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

test("a desktop browser on x.com gets the cleaned original", async () => {
  const res = await call("https://bl.example/x.com/jack/status/20?s=20&utm_source=x", {
    "User-Agent": CHROME,
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://x.com/jack/status/20?s=20");
});

test("a share link with no user agent stays on the cleaned original", async () => {
  const res = await call("https://bl.example/www.tiktok.com/@scout2015/video/6718335390845095173");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(
    "https://www.tiktok.com/@scout2015/video/6718335390845095173",
  );
});

test("an empty user agent stays on the cleaned original", async () => {
  const res = await call("https://bl.example/bsky.app/profile/bsky.app/post/3mw2cdr44fc2a", {
    "User-Agent": "",
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://bsky.app/profile/bsky.app/post/3mw2cdr44fc2a");
});

test("a crawler on facebook gets the cleaned original", async () => {
  const res = await call(
    "https://bl.example/www.facebook.com/reel/1016339268064528?mibextid=wwXIfr",
    { "User-Agent": DISCORD },
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://www.facebook.com/reel/1016339268064528");
});

test("a crawler on youtube gets the cleaned original", async () => {
  const res = await call("https://bl.example/www.youtube.com/watch?v=abc&si=zz", {
    "User-Agent": DISCORD,
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://www.youtube.com/watch?v=abc");
});

test("a crawler on a fix service host gets that host back", async () => {
  const res = await call("https://bl.example/fixupx.com/jack/status/20", { "User-Agent": DISCORD });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://fixupx.com/jack/status/20");
});

test("a crawler on an unlisted bluesky host gets the cleaned original", async () => {
  const res = await call("https://bl.example/www.bsky.app/profile/x/post/y", {
    "User-Agent": DISCORD,
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://www.bsky.app/profile/x/post/y");
});

test("a crawler on a lookalike host gets the cleaned original", async () => {
  const res = await call("https://bl.example/box.com/x", { "User-Agent": DISCORD });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://box.com/x");
});

test("a desktop browser on a listed host root gets the cleaned original", async () => {
  const res = await call("https://bl.example/x.com/", { "User-Agent": CHROME });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://x.com/");
});

test("a desktop browser still gets not found when the host has no slash", async () => {
  const res = await call("https://bl.example/x.com", { "User-Agent": CHROME });
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("not found");
  expect(res.headers.get("location")).toBeNull();
});

function callWorker(
  app: { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> },
  input: string,
  headers?: HeadersInit,
): Promise<Response> {
  return app.fetch(new Request(input, { headers }), {} as Env, ctx);
}

test("a desktop browser on an instagram post does not fetch or touch the cache", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(
      app,
      "https://bl.example/www.instagram.com/p/BsOGulcndj-/?igsh=x",
      { "User-Agent": CHROME },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/p/BsOGulcndj-/");
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
    expect(fake.calls.put).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("an instagram post with no user agent does not fetch or touch the cache", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/?igsh=x");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/p/BsOGulcndj-/");
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
    expect(fake.calls.put).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("a discord crawler on an instagram reels path does not fetch or touch the cache", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/reels/DJvkjAlvNc8/", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/reels/DJvkjAlvNc8/");
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
    expect(fake.calls.put).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("a browser following an instagram item link lands on the post", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/DOBXTYNklfi/2?igsh=x", {
      "User-Agent": CHROME,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/p/DOBXTYNklfi/");
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
    expect(fake.calls.put).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("a browser keeps img_index when dropping an instagram item number", async () => {
  const res = await call("https://bl.example/instagram.com/p/ABC/2?img_index=3&igsh=x", {
    "User-Agent": CHROME,
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://instagram.com/p/ABC/?img_index=3");
});

test("converting an instagram item link keeps the item number", async () => {
  const res = await call("https://bl.example/?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FABC%2F2");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("https://bl.example/www.instagram.com/p/ABC/2");
});

test("a non-instagram item path keeps its number", async () => {
  const res = await call("https://bl.example/example.com/p/x/2", { "User-Agent": CHROME });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://example.com/p/x/2");
});

test("an instagram item number of zero stays on the path", async () => {
  const res = await call("https://bl.example/www.instagram.com/p/ABC/0", { "User-Agent": CHROME });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://www.instagram.com/p/ABC/0");
});

test("a browser following a reel item link lands on the reel", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/reel/DJvkjAlvNc8/2?igsh=x", {
      "User-Agent": CHROME,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/reel/DJvkjAlvNc8/");
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
    expect(fake.calls.put).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("a browser on a reel keeps the cleaned reel url", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(
      app,
      "https://bl.example/www.instagram.com/reel/DJvkjAlvNc8/?igsh=QkFfQVp3Q3ZnTw%3D%3D",
      { "User-Agent": CHROME },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/reel/DJvkjAlvNc8/");
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
    expect(fake.calls.put).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("a browser on a reel without a trailing slash does not gain one", async () => {
  const res = await call("https://bl.example/www.instagram.com/reel/DJvkjAlvNc8", { "User-Agent": CHROME });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://www.instagram.com/reel/DJvkjAlvNc8");
});

test("a discord crawler on an instagram profile does not fetch", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/world_record_egg/", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/world_record_egg/");
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
    expect(fake.calls.put).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("a discord crawler on an instagram embed path does not fetch", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/embed/", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/p/BsOGulcndj-/embed/");
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
    expect(fake.calls.put).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("a discord crawler on an invalid instagram shortcode does not fetch", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/bad.id/", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/p/bad.id/");
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
    expect(fake.calls.put).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

const SECRET = {
  Cookie: "session=s3cr3t",
  Authorization: "Bearer s3cr3t",
} as const;

async function eggHtml(): Promise<string> {
  return Bun.file(new URL("./fixtures/instagram/embed-BsOGulcndj-.html", import.meta.url)).text();
}

function dumped(res: Response, body: string): string {
  return `${body}\n${[...res.headers].map(([name, value]) => `${name}: ${value}`).join("\n")}`;
}

test("an instagram preview fetch does not forward caller credentials", async () => {
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => eggHtml().then((html) => new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/", {
      "User-Agent": DISCORD,
      ...SECRET,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0]?.[1];
    expect([...(new Headers(init?.headers).keys())]).toEqual(["user-agent"]);
    expect(
      JSON.stringify([spy.mock.calls[0]?.[0], [...new Headers(spy.mock.calls[0]?.[1]?.headers)]]),
    ).not.toContain("s3cr3t");
    const body = await res.text();
    const trace = dumped(res, body);
    expect(trace).not.toContain("s3cr3t");
    expect(trace).not.toContain(DISCORD);
  } finally {
    spy.mockRestore();
  }
});

test("a media fetch does not forward caller credentials", async () => {
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => eggHtml().then((html) => new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/media/BsOGulcndj-/1", {
      "User-Agent": DISCORD,
      ...SECRET,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0]?.[1];
    expect([...(new Headers(init?.headers).keys())]).toEqual(["user-agent"]);
    const trace = dumped(res, await res.text());
    expect(trace).not.toContain("s3cr3t");
  } finally {
    spy.mockRestore();
  }
});

test("caller credentials are not written to the console", async () => {
  const logs = spyOn(console, "log");
  const infos = spyOn(console, "info");
  const warns = spyOn(console, "warn");
  const errors = spyOn(console, "error");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => eggHtml().then((html) => new Response(html, { status: 200 })));
  try {
    await callWorker(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/", {
      "User-Agent": DISCORD,
      ...SECRET,
    });
    await callWorker(app, "https://bl.example/media/BsOGulcndj-/1", {
      "User-Agent": DISCORD,
      ...SECRET,
    });
    const recorded = JSON.stringify([
      logs.mock.calls,
      infos.mock.calls,
      warns.mock.calls,
      errors.mock.calls,
    ]);
    expect(recorded).not.toContain("s3cr3t");
  } finally {
    spy.mockRestore();
    logs.mockRestore();
    infos.mockRestore();
    warns.mockRestore();
    errors.mockRestore();
  }
});

function instagramFixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/instagram/${name}`, import.meta.url)).text();
}

test("a crawler preview of carousel item 2 points at that item", async () => {
  const html = await instagramFixture("embed-DOBXTYNklfi.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/DOBXTYNklfi/2", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toContain('<meta property="og:image" content="https://bl.example/media/DOBXTYNklfi/2">');
    expect(body).toContain('<meta name="twitter:image" content="https://bl.example/media/DOBXTYNklfi/2">');
    expect(body).toContain('<meta property="og:url" content="https://www.instagram.com/p/DOBXTYNklfi/">');
    expect(body).toContain('<meta http-equiv="refresh" content="0; url=https://www.instagram.com/p/DOBXTYNklfi/">');
    expect(body).toContain('<a href="https://www.instagram.com/p/DOBXTYNklfi/">');
  } finally {
    spy.mockRestore();
  }
});

test("a crawler preview without an item number uses the first item", async () => {
  const html = await instagramFixture("embed-DOBXTYNklfi.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/DOBXTYNklfi/", {
      "User-Agent": DISCORD,
    });
    const body = await res.text();
    expect(body).toContain('<meta property="og:image" content="https://bl.example/media/DOBXTYNklfi/1">');
  } finally {
    spy.mockRestore();
  }
});

test("a trailing slash on an item path still selects that item", async () => {
  const html = await instagramFixture("embed-DOBXTYNklfi.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/DOBXTYNklfi/2/", {
      "User-Agent": DISCORD,
    });
    const body = await res.text();
    expect(body).toContain('<meta property="og:image" content="https://bl.example/media/DOBXTYNklfi/2">');
  } finally {
    spy.mockRestore();
  }
});

test("a crawler asking for a missing egg item is sent to the post", async () => {
  const html = await instagramFixture("embed-BsOGulcndj-.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/2", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/p/BsOGulcndj-/");
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("item numbers outside the grammar are not post paths", async () => {
  for (const suffix of ["/0", "/02", "/100"]) {
    const fake = fakeCache();
    const app = createWorker({ cache: () => fake.cache });
    const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    try {
      const res = await callWorker(app, `https://bl.example/www.instagram.com/p/DOBXTYNklfi${suffix}`, {
        "User-Agent": DISCORD,
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`https://www.instagram.com/p/DOBXTYNklfi${suffix}`);
      expect(spy).toHaveBeenCalledTimes(0);
      expect(fake.calls.match).toBe(0);
    } finally {
      spy.mockRestore();
    }
  }
});

test("a carousel item preview does not forward caller credentials", async () => {
  const html = await instagramFixture("embed-DOBXTYNklfi.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/DOBXTYNklfi/2", {
      "User-Agent": DISCORD,
      ...SECRET,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0]?.[1];
    expect([...(new Headers(init?.headers).keys())]).toEqual(["user-agent"]);
    const upstream = JSON.stringify([spy.mock.calls[0]?.[0], [...new Headers(init?.headers)]]);
    expect(upstream).not.toContain("s3cr3t");
    expect(upstream).not.toContain(DISCORD);
    const trace = dumped(res, await res.text());
    expect(trace).not.toContain("s3cr3t");
    expect(trace).not.toContain(DISCORD);
  } finally {
    spy.mockRestore();
  }
});

test("a reel preview fetches the post embed and shares the post cache", async () => {
  const html = await instagramFixture("embed-DJvkjAlvNc8.html");
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const reel = await callWorker(app, "https://bl.example/www.instagram.com/reel/DJvkjAlvNc8/", {
      "User-Agent": DISCORD,
    });
    expect(reel.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("https://www.instagram.com/p/DJvkjAlvNc8/embed/captioned/");
    const post = await callWorker(app, "https://bl.example/www.instagram.com/p/DJvkjAlvNc8/", {
      "User-Agent": DISCORD,
    });
    expect(post.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fake.entries.size).toBe(1);
  } finally {
    spy.mockRestore();
  }
});

test("a reel item past the end is sent to the reel", async () => {
  const html = await instagramFixture("embed-DJvkjAlvNc8.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/reel/DJvkjAlvNc8/2", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.instagram.com/reel/DJvkjAlvNc8/");
    expect(await res.text()).toBe("");
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("reel item numbers outside the grammar are not post paths", async () => {
  for (const suffix of ["/0", "/02", "/100"]) {
    const fake = fakeCache();
    const app = createWorker({ cache: () => fake.cache });
    const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    try {
      const res = await callWorker(app, `https://bl.example/www.instagram.com/reel/DJvkjAlvNc8${suffix}`, {
        "User-Agent": DISCORD,
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`https://www.instagram.com/reel/DJvkjAlvNc8${suffix}`);
      expect(spy).toHaveBeenCalledTimes(0);
      expect(fake.calls.match).toBe(0);
    } finally {
      spy.mockRestore();
    }
  }
});

test("a reel item preview uses the reel landing url and that item", async () => {
  const html = await instagramFixture("embed-DOBXTYNklfi.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/reel/DOBXTYNklfi/2", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<meta property="og:image" content="https://bl.example/media/DOBXTYNklfi/2">');
    expect(body).toContain('<meta property="og:url" content="https://www.instagram.com/reel/DOBXTYNklfi/">');
  } finally {
    spy.mockRestore();
  }
});

test("a reel preview does not forward caller credentials", async () => {
  const html = await instagramFixture("embed-DJvkjAlvNc8.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/reel/DJvkjAlvNc8/", {
      "User-Agent": DISCORD,
      ...SECRET,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0]?.[1];
    expect([...(new Headers(init?.headers).keys())]).toEqual(["user-agent"]);
    const upstream = JSON.stringify([spy.mock.calls[0]?.[0], [...new Headers(init?.headers)]]);
    expect(upstream).not.toContain("s3cr3t");
    expect(upstream).not.toContain(DISCORD);
    const trace = dumped(res, await res.text());
    expect(trace).not.toContain("s3cr3t");
    expect(trace).not.toContain(DISCORD);
  } finally {
    spy.mockRestore();
  }
});

test("a carousel item title counts that item", async () => {
  const html = await instagramFixture("embed-DOBXTYNklfi.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const second = await callWorker(app, "https://bl.example/www.instagram.com/p/DOBXTYNklfi/2", {
      "User-Agent": DISCORD,
    });
    const body = await second.text();
    expect(body).toContain('<meta property="og:title" content="@legday (2/2)">');
    expect(body).toContain("<title>@legday (2/2)</title>");
    expect(body).toContain('<meta name="twitter:title" content="@legday (2/2)">');
    const first = await callWorker(app, "https://bl.example/www.instagram.com/p/DOBXTYNklfi/", {
      "User-Agent": DISCORD,
    });
    expect(await first.text()).toContain('<meta property="og:title" content="@legday (1/2)">');
  } finally {
    spy.mockRestore();
  }
});

test("a single image title is the account name", async () => {
  const html = await instagramFixture("embed-BsOGulcndj-.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/", {
      "User-Agent": DISCORD,
    });
    const body = await res.text();
    expect(body).toContain('<meta property="og:title" content="@world_record_egg">');
    const title = body.match(/<meta property="og:title" content="([^"]*)">/)?.[1];
    expect(title?.includes("(")).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

test("a single video title is the account name", async () => {
  const html = await instagramFixture("embed-DJvkjAlvNc8.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/DJvkjAlvNc8/", {
      "User-Agent": DISCORD,
    });
    expect(await res.text()).toContain('<meta property="og:title" content="@vatsalya_therapy">');
  } finally {
    spy.mockRestore();
  }
});

test("a video preview is a player card for that item", async () => {
  const html = await instagramFixture("embed-DJvkjAlvNc8.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.instagram.com/p/DJvkjAlvNc8/", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<meta property="og:video" content="https://bl.example/media/DJvkjAlvNc8/1">');
    expect(body).toContain('<meta property="og:video:width" content="720">');
    expect(body).toContain('<meta property="og:video:height" content="1280">');
    expect(body).toContain('<meta name="twitter:card" content="player">');
    expect(body).toContain('<meta name="twitter:player:stream" content="https://bl.example/media/DJvkjAlvNc8/1">');
    expect(body).not.toContain("og:image");
    expect(body).not.toContain("twitter:image");
  } finally {
    spy.mockRestore();
  }
});

test("a carousel video item is a player card and the image item stays an image", async () => {
  const html = await instagramFixture("embed-DduKfFmDxsG.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const video = await callWorker(app, "https://bl.example/www.instagram.com/p/DduKfFmDxsG/2", {
      "User-Agent": DISCORD,
    });
    const videoBody = await video.text();
    expect(videoBody).toContain('<meta property="og:video" content="https://bl.example/media/DduKfFmDxsG/2">');
    expect(videoBody).toContain('<meta property="og:video:width" content="720">');
    expect(videoBody).toContain('<meta property="og:video:height" content="900">');
    expect(videoBody).toContain('<meta property="og:title" content="@instagram (2/2)">');
    expect(videoBody).not.toContain("fbcdn");
    expect(videoBody).not.toContain("cdninstagram");
    const image = await callWorker(app, "https://bl.example/www.instagram.com/p/DduKfFmDxsG/1", {
      "User-Agent": DISCORD,
    });
    const imageBody = await image.text();
    expect(imageBody).toContain('<meta property="og:image" content="https://bl.example/media/DduKfFmDxsG/1">');
    expect(imageBody).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(imageBody).not.toContain("og:video");
  } finally {
    spy.mockRestore();
  }
});

test("a reel video card matches the post card except for the reel landing url", async () => {
  const html = await instagramFixture("embed-DJvkjAlvNc8.html");
  async function page(path: string): Promise<string> {
    const app = createWorker({ cache: () => fakeCache().cache });
    const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
    try {
      const res = await callWorker(app, path, { "User-Agent": DISCORD });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      return await res.text();
    } finally {
      spy.mockRestore();
    }
  }
  const pBody = await page("https://bl.example/www.instagram.com/p/DJvkjAlvNc8/");
  const reelBody = await page("https://bl.example/www.instagram.com/reel/DJvkjAlvNc8/");
  expect(reelBody).toBe(pBody.replaceAll("instagram.com/p/DJvkjAlvNc8/", "instagram.com/reel/DJvkjAlvNc8/"));
  expect(reelBody).toContain('<meta property="og:url" content="https://www.instagram.com/reel/DJvkjAlvNc8/">');
  expect(reelBody).toContain('<meta property="og:video" content="https://bl.example/media/DJvkjAlvNc8/1">');
  const indexed = await page("https://bl.example/www.instagram.com/reel/DJvkjAlvNc8/1");
  expect(indexed).toBe(reelBody);
});

test("a media url redirects to the requested carousel item", async () => {
  const html = await instagramFixture("embed-DOBXTYNklfi.html");
  const mediaUrl = parseEmbed(html)?.media[1]?.url;
  if (mediaUrl === undefined) throw new Error("missing media url");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/media/DOBXTYNklfi/2");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(mediaUrl);
    expect(new URL(mediaUrl).pathname).toBe(
      "/v/t51.82787-15/539561490_18060504941366724_6446626545327929916_n.jpg",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("a media url redirects to a video mp4", async () => {
  const html = await instagramFixture("embed-DJvkjAlvNc8.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/media/DJvkjAlvNc8/1");
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("https://scontent.cdninstagram.com/o1/v/t2/f2/m367/")).toBe(true);
    expect(new URL(location).pathname.endsWith(".mp4")).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
  } finally {
    spy.mockRestore();
  }
});

test("a media url redirects to a carousel video", async () => {
  const html = await instagramFixture("embed-DduKfFmDxsG.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/media/DduKfFmDxsG/2");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")?.startsWith("https://scontent.cdninstagram.com/o1/v/t16/f2/m84/")).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

test("a media index past the carousel is not found", async () => {
  const html = await instagramFixture("embed-DOBXTYNklfi.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/media/DOBXTYNklfi/3");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("not found");
    expect(res.headers.get("location")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("media indexes outside the grammar are not found", async () => {
  for (const path of ["/0", "/02", "/1/", "/100"]) {
    const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    try {
      const res = await call(`https://bl.example/media/BsOGulcndj-${path}`);
      expect(res.status).toBe(404);
      expect(spy).toHaveBeenCalledTimes(0);
    } finally {
      spy.mockRestore();
    }
  }
});

test("a carousel media redirect does not forward caller credentials", async () => {
  const html = await instagramFixture("embed-DOBXTYNklfi.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/media/DOBXTYNklfi/2", {
      "User-Agent": DISCORD,
      ...SECRET,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0]?.[1];
    expect([...(new Headers(init?.headers).keys())]).toEqual(["user-agent"]);
    const trace = dumped(res, await res.text());
    expect(trace).not.toContain("s3cr3t");
    expect(JSON.stringify([spy.mock.calls[0]?.[0], [...new Headers(init?.headers)]])).not.toContain("s3cr3t");
  } finally {
    spy.mockRestore();
  }
});

test("a media redirect reuses the carousel preview cache", async () => {
  const html = await instagramFixture("embed-DOBXTYNklfi.html");
  const mediaUrl = parseEmbed(html)?.media[1]?.url;
  if (mediaUrl === undefined) throw new Error("missing media url");
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const preview = await callWorker(app, "https://bl.example/www.instagram.com/p/DOBXTYNklfi/2", {
      "User-Agent": DISCORD,
    });
    expect(preview.status).toBe(200);
    const res = await callWorker(app, "https://bl.example/media/DOBXTYNklfi/2");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(mediaUrl);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

const MANNY = "https://www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";
const MANNY_SHARE =
  "https://bl.example/www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol?mibextid=wwXIfr";
const MANNY_PLUGIN =
  "https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fmannynewsletter%2Fposts%2Fpfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";
const MANNY_MEDIA =
  "https://bl.example/media/www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";

test("a desktop browser on a facebook post does not fetch", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, MANNY_SHARE, { "User-Agent": CHROME });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(MANNY);
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
    expect(fake.calls.put).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("a facebook post with no user agent does not fetch", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, MANNY_SHARE);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(MANNY);
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
    expect(fake.calls.put).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

const REEL = "https://www.facebook.com/reel/1016339268064528";
const REEL_SHARE = "https://bl.example/www.facebook.com/reel/1016339268064528?mibextid=wwXIfr";
const REEL_PLUGIN =
  "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Freel%2F1016339268064528";
const WATCH_PLUGIN =
  "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fwatch%2F%3Fv%3D10153231379946729";

test("a discord crawler receives a facebook reel player card", async () => {
  const html = await facebookFixture("video-reel-1016339268064528.zh-Hant.html");
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, REEL_SHARE, { "User-Agent": DISCORD });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    const video = "https://bl.example/media/www.facebook.com/reel/1016339268064528";
    expect(body).toContain(`<meta property="og:video" content="${video}">`);
    expect(body).toContain(`<meta property="og:video:secure_url" content="${video}">`);
    expect(body).toContain(`<meta name="twitter:player:stream" content="${video}">`);
    expect(body).toContain('<meta property="og:video:width" content="1920">');
    expect(body).toContain('<meta property="og:video:height" content="1080">');
    expect(body).toContain('<meta name="twitter:card" content="player">');
    expect(body).toContain('<meta property="og:title" content="完全娛樂 ShowBiz">');
    expect(body).toContain('<meta property="og:description" content="">');
    expect(body).toContain(`<meta property="og:url" content="${REEL}">`);
    expect(body).not.toContain("og:image");
    expect(body).not.toContain("twitter:image");
    expect(body).not.toContain("fbcdn");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(REEL_PLUGIN);
  } finally {
    spy.mockRestore();
  }
});

test("a discord crawler receives a facebook watch player card", async () => {
  const html = await facebookFixture("video-watch-10153231379946729.zh-Hant.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.facebook.com/watch/?v=10153231379946729", {
      "User-Agent": DISCORD,
    });
    const body = await res.text();
    expect(body).toContain(
      '<meta property="og:video" content="https://bl.example/media/www.facebook.com/watch/?v=10153231379946729">',
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(WATCH_PLUGIN);
  } finally {
    spy.mockRestore();
  }
});

test("a discord crawler receives a facebook page video player card", async () => {
  const html = await facebookFixture("video-videos-10153231379946729.zh-Hant.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/www.facebook.com/facebook/videos/10153231379946729/", {
      "User-Agent": DISCORD,
    });
    const body = await res.text();
    expect(body).toContain(
      '<meta property="og:video" content="https://bl.example/media/www.facebook.com/facebook/videos/10153231379946729/">',
    );
    expect(body).toContain('<meta property="og:title" content="Facebook">');
  } finally {
    spy.mockRestore();
  }
});

test("a mobile facebook reel preview keeps the mobile host in the video url", async () => {
  const html = await facebookFixture("video-reel-1016339268064528.zh-Hant.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, "https://bl.example/m.facebook.com/reel/1016339268064528", {
      "User-Agent": DISCORD,
    });
    const body = await res.text();
    expect(body).toContain(
      '<meta property="og:video" content="https://bl.example/media/m.facebook.com/reel/1016339268064528">',
    );
  } finally {
    spy.mockRestore();
  }
});

test("a second facebook reel preview reuses the cached video", async () => {
  const html = await facebookFixture("video-reel-1016339268064528.zh-Hant.html");
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const first = await callWorker(app, REEL_SHARE, { "User-Agent": DISCORD });
    const second = await callWorker(app, REEL_SHARE, { "User-Agent": DISCORD });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.text()).toBe(await second.text());
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("a desktop browser on a facebook reel does not fetch", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, REEL_SHARE, { "User-Agent": CHROME });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(REEL);
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("a facebook reel with no user agent does not fetch", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, REEL_SHARE);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(REEL);
    expect(spy).toHaveBeenCalledTimes(0);
    expect(fake.calls.match).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("a crawler on a facebook share short link does not fetch", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, "https://bl.example/www.facebook.com/share/p/1Fu5ScGFUZ/?mibextid=wwXIfr", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.facebook.com/share/p/1Fu5ScGFUZ/");
    expect(spy).toHaveBeenCalledTimes(0);
  } finally {
    spy.mockRestore();
  }
});

test("a crawler on a facebook group permalink does not fetch", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, "https://bl.example/www.facebook.com/groups/g0v.general/permalink/1/", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.facebook.com/groups/g0v.general/permalink/1/");
    expect(spy).toHaveBeenCalledTimes(0);
  } finally {
    spy.mockRestore();
  }
});

test("a crawler on a facebook profile does not fetch", async () => {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    const res = await callWorker(app, "https://bl.example/www.facebook.com/mannynewsletter", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://www.facebook.com/mannynewsletter");
    expect(spy).toHaveBeenCalledTimes(0);
  } finally {
    spy.mockRestore();
  }
});

function facebookFixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/facebook/${name}`, import.meta.url)).text();
}

test("a discord crawler receives a facebook og page", async () => {
  const html = await facebookFixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, MANNY_SHARE, { "User-Agent": DISCORD });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toContain('<meta property="og:title" content="曼報 Manny&#39;s Newsletter">');
    expect(body).toContain("<title>曼報 Manny&#39;s Newsletter</title>");
    expect(body).toContain(`<meta property="og:image" content="${MANNY_MEDIA}">`);
    expect(body).toContain(`<meta name="twitter:image" content="${MANNY_MEDIA}">`);
    expect(body).toContain(`<meta property="og:url" content="${MANNY}">`);
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(body).toContain(
      '<meta property="og:description" content="2020 年，我開始利用下班時間寫免費電子報《曼報 Manny’s Newsletter》',
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(MANNY_PLUGIN);
  } finally {
    spy.mockRestore();
  }
});

test("a facebook story preview points at the cleaned media url", async () => {
  const html = await facebookFixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(
      app,
      "https://bl.example/www.facebook.com/story.php?story_fbid=1&id=2&__cft__[0]=A",
      { "User-Agent": DISCORD },
    );
    const body = await res.text();
    expect(body).toContain(
      '<meta property="og:image" content="https://bl.example/media/www.facebook.com/story.php?story_fbid=1&amp;id=2">',
    );
    expect(body).toContain(
      '<meta property="og:url" content="https://www.facebook.com/story.php?story_fbid=1&amp;id=2">',
    );
  } finally {
    spy.mockRestore();
  }
});

test("a facebook album preview names the author and this service's image", async () => {
  const html = await facebookFixture("post-album-3-images.zh-Hant.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(
      app,
      "https://bl.example/www.facebook.com/opensource4you/posts/pfbid02CSveUJjD2dvW8WweL7xynJfrnTxQhJZGhpuuFNMFQUrbg3DAeZvTNfnMpjRSKHx8l",
      { "User-Agent": DISCORD },
    );
    const body = await res.text();
    expect(body).toContain('<meta property="og:title" content="源來適你">');
    expect(body).toContain(
      '<meta property="og:image" content="https://bl.example/media/www.facebook.com/opensource4you/posts/pfbid02CSveUJjD2dvW8WweL7xynJfrnTxQhJZGhpuuFNMFQUrbg3DAeZvTNfnMpjRSKHx8l">',
    );
  } finally {
    spy.mockRestore();
  }
});

test("a facebook post with no caption renders an empty og description", async () => {
  const html =
    '<img src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg" aria-label="A" role="img"><img src="https://scontent.x.fbcdn.net/v/t39.30808-6/p.jpg">';
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, MANNY_SHARE, { "User-Agent": DISCORD });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<meta property="og:description" content="">');
  } finally {
    spy.mockRestore();
  }
});

test("a mobile facebook post preview keeps the mobile host in the media url", async () => {
  const html = await facebookFixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(
      app,
      "https://bl.example/m.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol",
      { "User-Agent": DISCORD },
    );
    const body = await res.text();
    expect(body).toContain(
      '<meta property="og:image" content="https://bl.example/media/m.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol">',
    );
  } finally {
    spy.mockRestore();
  }
});

test("a facebook preview fetch does not forward caller credentials", async () => {
  const html = await facebookFixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, MANNY_SHARE, { "User-Agent": DISCORD, ...SECRET });
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0]?.[1];
    expect([...(new Headers(init?.headers).keys())]).toEqual(["user-agent"]);
    const upstream = JSON.stringify([spy.mock.calls[0]?.[0], [...new Headers(init?.headers)]]);
    expect(upstream).not.toContain("s3cr3t");
    expect(upstream).not.toContain(DISCORD);
    const trace = dumped(res, await res.text());
    expect(trace).not.toContain("s3cr3t");
    expect(trace).not.toContain(DISCORD);
  } finally {
    spy.mockRestore();
  }
});

test("a facebook media fetch does not forward caller credentials", async () => {
  const html = await facebookFixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    const res = await callWorker(app, MANNY_MEDIA, { "User-Agent": DISCORD, ...SECRET });
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0]?.[1];
    expect([...(new Headers(init?.headers).keys())]).toEqual(["user-agent"]);
    const upstream = JSON.stringify([spy.mock.calls[0]?.[0], [...new Headers(init?.headers)]]);
    expect(upstream).not.toContain("s3cr3t");
    const trace = dumped(res, await res.text());
    expect(trace).not.toContain("s3cr3t");
  } finally {
    spy.mockRestore();
  }
});

test("facebook caller credentials are not written to the console", async () => {
  const html = await facebookFixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const logs = spyOn(console, "log");
  const infos = spyOn(console, "info");
  const warns = spyOn(console, "warn");
  const errors = spyOn(console, "error");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = stubFetch(() => Promise.resolve(new Response(html, { status: 200 })));
  try {
    await callWorker(app, MANNY_SHARE, { "User-Agent": DISCORD, ...SECRET });
    await callWorker(app, MANNY_MEDIA, { "User-Agent": DISCORD, ...SECRET });
    const recorded = JSON.stringify([logs.mock.calls, infos.mock.calls, warns.mock.calls, errors.mock.calls]);
    expect(recorded).not.toContain("s3cr3t");
  } finally {
    spy.mockRestore();
    logs.mockRestore();
    infos.mockRestore();
    warns.mockRestore();
    errors.mockRestore();
  }
});
