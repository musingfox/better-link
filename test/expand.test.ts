import { expect, test } from "bun:test";
import { expandShareLink, type Fetcher } from "../src/expand";

const FB_POST_LOC =
  "https://www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol?rdid=VGXEydyR2cRY58Er&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fp%2F1Fu5ScGFUZ%2F";
const FB_REEL_LOC =
  "https://www.facebook.com/reel/1016339268064528?rdid=yW04JMxj7FGRfmRn&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fv%2F1HSGH1rf7o%2F";
const IG_REEL_LOC = "https://www.instagram.com/reel/DJvkjAlvNc8/?igsh=QkFfQVp3Q3ZnTw%3D%3D";
const IG_POST_LOC = "https://www.instagram.com/p/DOBXTYNklfi/?igsh=QkFCWXA3TG9BVA%3D%3D";
const M_LOC =
  "https://m.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol?rdid=JoOqIJIyWQqLPTAT&share_url=https%3A%2F%2Fm.facebook.com%2Fshare%2Fp%2F1Fu5ScGFUZ%2F&refsrc=deprecated&_rdr";

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

function recording(
  responses: Response[] = [new Response(null, { status: 200 })],
): { fetcher: Fetcher; calls: Array<{ input: string; init: RequestInit }> } {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetcher: Fetcher = (input, init) => {
    calls.push({ input, init });
    return Promise.resolve(responses[calls.length - 1] ?? responses[responses.length - 1]);
  };
  return { fetcher, calls };
}

function expectProbe(init: RequestInit): void {
  expect(init.method).toBe("HEAD");
  expect(new Headers(init.headers).get("user-agent")).toBe("Go-http-client/1.1");
  expect(init.redirect).toBe("manual");
}

test("a facebook reel is not a share link and is not fetched", async () => {
  const { fetcher, calls } = recording();
  const href = "https://www.facebook.com/reel/1016339268064528";
  const result = await expandShareLink(new URL(href), fetcher);
  expect(result?.href).toBe(href);
  expect(calls).toHaveLength(0);
});

test("the facebook sharer endpoint is not a share link", async () => {
  const { fetcher, calls } = recording();
  const href = "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fexample.com";
  const result = await expandShareLink(new URL(href), fetcher);
  expect(result?.href).toBe(href);
  expect(calls).toHaveLength(0);
});

test("a bare /share/ path is not a share link", async () => {
  const { fetcher, calls } = recording();
  const href = "https://www.facebook.com/share/";
  const result = await expandShareLink(new URL(href), fetcher);
  expect(result?.href).toBe(href);
  expect(calls).toHaveLength(0);
});

test("a share path on another host is not expanded", async () => {
  const { fetcher, calls } = recording();
  const href = "https://example.com/share/p/1Fu5ScGFUZ/";
  const result = await expandShareLink(new URL(href), fetcher);
  expect(result?.href).toBe(href);
  expect(calls).toHaveLength(0);
});

test("a lookalike instagram host is not expanded", async () => {
  const { fetcher, calls } = recording();
  const href = "https://instagram.com.evil.example/share/reel/_gdkGEJBn/";
  const result = await expandShareLink(new URL(href), fetcher);
  expect(result?.href).toBe(href);
  expect(calls).toHaveLength(0);
});

test("a facebook share link is probed with a manual HEAD and the go client user agent", async () => {
  const { fetcher, calls } = recording([redirect(FB_POST_LOC)]);
  await expandShareLink(new URL("https://www.facebook.com/share/p/1Fu5ScGFUZ/"), fetcher);
  expect(calls[0].input).toBe("https://www.facebook.com/share/p/1Fu5ScGFUZ/");
  expectProbe(calls[0].init);
});

test("the probe upgrades http to https and drops the fragment but keeps the query", async () => {
  const { fetcher, calls } = recording([redirect(FB_POST_LOC)]);
  await expandShareLink(
    new URL("http://www.facebook.com/share/p/1Fu5ScGFUZ/?mibextid=wwXIfr#frag"),
    fetcher,
  );
  expect(calls[0].input).toBe("https://www.facebook.com/share/p/1Fu5ScGFUZ/?mibextid=wwXIfr");
});

test("an instagram share link uses the same probe shape", async () => {
  const { fetcher, calls } = recording([redirect(IG_REEL_LOC)]);
  await expandShareLink(new URL("https://www.instagram.com/share/reel/_gdkGEJBn/"), fetcher);
  expectProbe(calls[0].init);
});

const FB_SHARE = "https://www.facebook.com/share/p/1Fu5ScGFUZ/";

test("a 200 without a location fails the expansion", async () => {
  const { fetcher } = recording([new Response(null, { status: 200 })]);
  expect(await expandShareLink(new URL(FB_SHARE), fetcher)).toBeNull();
});

test("a 400 without a location fails the expansion", async () => {
  const { fetcher } = recording([new Response(null, { status: 400 })]);
  expect(await expandShareLink(new URL(FB_SHARE), fetcher)).toBeNull();
});

test("a redirect without a location fails the expansion", async () => {
  const { fetcher } = recording([new Response(null, { status: 302 })]);
  expect(await expandShareLink(new URL(FB_SHARE), fetcher)).toBeNull();
});

test("a 200 that carries a location still fails the expansion", async () => {
  const { fetcher } = recording([
    new Response(null, { status: 200, headers: { Location: FB_POST_LOC } }),
  ]);
  expect(await expandShareLink(new URL(FB_SHARE), fetcher)).toBeNull();
});

test("a rejected probe fails the expansion", async () => {
  const fetcher: Fetcher = () => Promise.reject(new TypeError("fetch failed"));
  expect(await expandShareLink(new URL(FB_SHARE), fetcher)).toBeNull();
});

test("an aborted probe fails the expansion", async () => {
  const fetcher: Fetcher = () => Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  expect(await expandShareLink(new URL(FB_SHARE), fetcher)).toBeNull();
});

test("a synchronous probe throw fails the expansion", async () => {
  const fetcher: Fetcher = () => {
    throw new Error("boom");
  };
  expect(await expandShareLink(new URL(FB_SHARE), fetcher)).toBeNull();
});

test("a facebook post share link resolves to the redirect location with its query intact", async () => {
  const { fetcher } = recording([redirect(FB_POST_LOC)]);
  const result = await expandShareLink(new URL("https://www.facebook.com/share/p/1Fu5ScGFUZ/"), fetcher);
  expect(result?.href).toBe(FB_POST_LOC);
});

test("a facebook reel share link resolves to the reel location", async () => {
  const { fetcher } = recording([redirect(FB_REEL_LOC)]);
  const result = await expandShareLink(new URL("https://www.facebook.com/share/v/1HSGH1rf7o/"), fetcher);
  expect(result?.href).toBe(FB_REEL_LOC);
});

test("an instagram reel share link resolves to the reel location with its query intact", async () => {
  const { fetcher } = recording([redirect(IG_REEL_LOC)]);
  const result = await expandShareLink(new URL("https://www.instagram.com/share/reel/_gdkGEJBn/"), fetcher);
  expect(result?.href).toBe(IG_REEL_LOC);
});

test("a facebook /share/r/ link resolves to the reel location", async () => {
  const location =
    "https://www.facebook.com/reel/1016339268064528?rdid=R4&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fr%2F1HSGH1rf7o%2F";
  const { fetcher } = recording([redirect(location)]);
  const result = await expandShareLink(new URL("https://www.facebook.com/share/r/1HSGH1rf7o/"), fetcher);
  expect(result?.href).toBe(location);
});

test("a bare facebook share id resolves to the post location", async () => {
  const location =
    "https://www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol?rdid=R5&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2F1Fu5ScGFUZ%2F";
  const { fetcher } = recording([redirect(location)]);
  const result = await expandShareLink(new URL("https://www.facebook.com/share/1Fu5ScGFUZ/"), fetcher);
  expect(result?.href).toBe(location);
});

test("an instagram post share link resolves to the post location", async () => {
  const { fetcher } = recording([redirect(IG_POST_LOC)]);
  const result = await expandShareLink(new URL("https://www.instagram.com/share/p/BBFVaX2n1Y/"), fetcher);
  expect(result?.href).toBe(IG_POST_LOC);
});

test("a bare instagram share id resolves to the post location", async () => {
  const { fetcher } = recording([redirect(IG_POST_LOC)]);
  const result = await expandShareLink(new URL("https://www.instagram.com/share/BBFVaX2n1Y/"), fetcher);
  expect(result?.href).toBe(IG_POST_LOC);
});

test("a mobile facebook share link resolves to the mobile location", async () => {
  const { fetcher } = recording([redirect(M_LOC)]);
  const result = await expandShareLink(new URL("https://m.facebook.com/share/p/1Fu5ScGFUZ/"), fetcher);
  expect(result?.href).toBe(M_LOC);
});

test("a facebook share link without a trailing slash still resolves", async () => {
  const { fetcher } = recording([redirect(FB_POST_LOC)]);
  const result = await expandShareLink(new URL("https://www.facebook.com/share/p/1Fu5ScGFUZ"), fetcher);
  expect(result?.href).toBe(FB_POST_LOC);
});

test("a relative reel location is resolved against the share link", async () => {
  const { fetcher } = recording([redirect("/reel/1016339268064528?rdid=R10")]);
  const result = await expandShareLink(new URL("https://www.facebook.com/share/v/1HSGH1rf7o/"), fetcher);
  expect(result?.href).toBe("https://www.facebook.com/reel/1016339268064528?rdid=R10");
});

test("a 307 redirect resolves the same way as a 302", async () => {
  const { fetcher } = recording([redirect(FB_REEL_LOC, 307)]);
  const result = await expandShareLink(new URL("https://www.facebook.com/share/v/1HSGH1rf7o/"), fetcher);
  expect(result?.href).toBe(FB_REEL_LOC);
});

test("an unrelated host is not expanded", async () => {
  const { fetcher, calls } = recording();
  const href = "https://www.youtube.com/watch?v=abc";
  const result = await expandShareLink(new URL(href), fetcher);
  expect(result?.href).toBe(href);
  expect(calls).toHaveLength(0);
});
