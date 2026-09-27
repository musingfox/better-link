import { expect, test } from "bun:test";
import { expandShareLink, type Fetcher } from "../src/expand";

const FB_POST_LOC =
  "https://www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol?rdid=VGXEydyR2cRY58Er&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fp%2F1Fu5ScGFUZ%2F";
const IG_REEL_LOC = "https://www.instagram.com/reel/DJvkjAlvNc8/?igsh=QkFfQVp3Q3ZnTw%3D%3D";

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

test("an unrelated host is not expanded", async () => {
  const { fetcher, calls } = recording();
  const href = "https://www.youtube.com/watch?v=abc";
  const result = await expandShareLink(new URL(href), fetcher);
  expect(result?.href).toBe(href);
  expect(calls).toHaveLength(0);
});
