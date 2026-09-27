import { fileURLToPath } from "node:url";
import { expect, spyOn, test } from "bun:test";
import { cleanUrl } from "../src/clean";
import worker from "../src/index";

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

test("a crawler user agent still gets the cleaned redirect", async () => {
  const res = await call("https://bl.example/www.instagram.com/p/ABC/", {
    "User-Agent": "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://www.instagram.com/p/ABC/");
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
