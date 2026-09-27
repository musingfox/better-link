import { expect, test } from "bun:test";
import { expandShareLink, type Fetcher } from "../src/expand";

function recording(): { fetcher: Fetcher; calls: Array<{ input: string; init: RequestInit }> } {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetcher: Fetcher = (input, init) => {
    calls.push({ input, init });
    return Promise.resolve(new Response(null, { status: 200 }));
  };
  return { fetcher, calls };
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

test("an unrelated host is not expanded", async () => {
  const { fetcher, calls } = recording();
  const href = "https://www.youtube.com/watch?v=abc";
  const result = await expandShareLink(new URL(href), fetcher);
  expect(result?.href).toBe(href);
  expect(calls).toHaveLength(0);
});
