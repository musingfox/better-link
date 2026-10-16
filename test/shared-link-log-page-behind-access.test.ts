import { expect, test } from "bun:test";
import { createWorker } from "../src/index";
import { shortcodeOfMediaId } from "../src/instagram";
import { fakeCache } from "./support/fake-cache";
import { type KvKey, type KvListOptions, type KvMode, fakeKv } from "./support/fake-kv";

const ORIGIN = "https://link.example";
const FB_POST =
  "https://www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";

function ctxWith(access: boolean): ExecutionContext {
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
    ...(access ? { access: { aud: "aud-tag", getIdentity: () => Promise.resolve(undefined) } } : {}),
  };
  return ctx as unknown as ExecutionContext;
}

function record(at: string, metadata: Record<string, unknown>): KvKey {
  const inverted = String(9_999_999_999_999 - Date.parse(at)).padStart(13, "0");
  return { name: `${inverted}-00000000-0000-4000-8000-000000000000`, metadata: { at, ...metadata } };
}

function records(count: number, url: (i: number) => string): KvKey[] {
  return Array.from({ length: count }, (_, i) =>
    record(new Date(Date.UTC(2026, 9, 16) + i * 1_000).toISOString(), { url: url(i) }),
  );
}

async function page(
  path: string,
  options: { access?: boolean; binding?: boolean; mode?: KvMode; keys?: KvKey[] } = {},
): Promise<{ response: Response; body: string; lists: KvListOptions[] }> {
  const kv = fakeKv(options.mode ?? "ok", options.keys ?? []);
  const env = (options.binding ?? true) ? { SHARED_LINKS: kv.binding } : {};
  const worker = createWorker({ cache: () => fakeCache().cache });
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`), env as unknown as Env, ctxWith(options.access ?? true));
  return { response, body: await response.text(), lists: kv.lists };
}

function older(body: string): string | null {
  return /href="(\?cursor=[^"]*)"/.exec(body)?.[1] ?? null;
}

test("without Access the page is forbidden and the store is not listed", async () => {
  const { response, lists } = await page("/log", { access: false });
  expect(response.status).toBe(403);
  expect(lists).toHaveLength(0);
});

test("without the binding /log is routed like any other unknown path", async () => {
  const { response, lists } = await page("/log", { binding: false });
  expect(response.status).toBe(404);
  expect(lists).toHaveLength(0);
});

test("the first page lists 30 keys once, without a cursor", async () => {
  const { response, lists } = await page("/log");
  expect(response.status).toBe(200);
  expect(lists).toEqual([{ limit: 30 }]);
});

test("?cursor= is passed to list unchanged", async () => {
  const { lists } = await page("/log?cursor=abc%2B%3D");
  expect(lists).toEqual([{ limit: 30, cursor: "abc+=" }]);
});

test("an older link appears only while the list is incomplete", async () => {
  const more = await page("/log", { keys: records(31, (i) => `https://example.com/${i}`) });
  expect(older(more.body)).toBe("?cursor=30");
  const all = await page("/log", { keys: records(30, (i) => `https://example.com/${i}`) });
  expect(older(all.body)).toBeNull();
});

test("a page emptied by expired keys still links to older records", async () => {
  const keys = records(31, (i) => `https://example.com/${i}`).map((key, i) => (i >= 1 ? { ...key, expired: true } : key));
  const { body } = await page("/log", { keys });
  expect(body).toContain("No records on this page.");
  expect(older(body)).toBe("?cursor=30");
});

test("records are shown newest first with their share links", async () => {
  const keys = [
    record("2026-10-16T01:00:00.000Z", { url: "https://www.instagram.com/p/OLDER/" }),
    record("2026-10-16T02:00:00.000Z", { url: "https://www.youtube.com/watch?v=newer", raw: true }),
  ];
  const { body } = await page("/log", { keys });
  expect(body.indexOf("youtube")).toBeLessThan(body.indexOf("OLDER"));
  expect(body).toContain(`${ORIGIN}/www.instagram.com/p/OLDER/`);
  expect(body).not.toContain(`${ORIGIN}/www.youtube.com`);
  expect(body).toContain("2026-10-16 02:00:00");
});

test("search matches the original URL case-insensitively", async () => {
  const keys = [
    record("2026-10-16T01:00:00.000Z", { url: "https://www.youtube.com/watch?v=hit" }),
    record("2026-10-16T02:00:00.000Z", { url: "https://example.com/miss" }),
  ];
  const { body, lists } = await page("/log?q=YouTube", { keys });
  expect(body).toContain("v=hit");
  expect(body).not.toContain("/miss");
  expect(lists).toEqual([{ limit: 1_000 }]);
  expect(body).not.toContain("cursor=");
});

test("search stops after three lists and offers to continue with q", async () => {
  const { body, lists } = await page("/log?q=needle", { keys: records(3_500, (i) => `https://example.com/${i}`) });
  expect(lists).toEqual([{ limit: 1_000 }, { limit: 1_000, cursor: "1000" }, { limit: 1_000, cursor: "2000" }]);
  expect(body).toContain('href="?q=needle&amp;cursor=3000"');
});

test("search stops between batches once 30 results are found", async () => {
  const { body, lists } = await page("/log?q=example", { keys: records(1_500, (i) => `https://example.com/${i}`) });
  expect(lists).toHaveLength(1);
  expect(body).toContain('href="?q=example&amp;cursor=1000"');
});

test("search continues from the given cursor", async () => {
  const { lists } = await page("/log?q=x&cursor=2000");
  expect(lists).toEqual([{ limit: 1_000, cursor: "2000" }]);
});

test("Instagram and Facebook records preview the media their share link embeds", async () => {
  const story = "3446487468465775665";
  const keys = [
    record("2026-10-16T01:00:00.000Z", { url: "https://www.instagram.com/p/ABCdef/" }),
    record("2026-10-16T02:00:00.000Z", { url: "https://www.instagram.com/p/ABCdef/2/" }),
    record("2026-10-16T03:00:00.000Z", { url: `https://www.instagram.com/stories/someone/${story}/` }),
    record("2026-10-16T04:00:00.000Z", { url: FB_POST }),
    record("2026-10-16T05:00:00.000Z", { url: "https://www.facebook.com/photo.php?fbid=123&set=a.1" }),
  ];
  const { body } = await page("/log", { keys });
  expect(body).toContain(`data-media="${ORIGIN}/media/ABCdef/1"`);
  expect(body).toContain(`data-media="${ORIGIN}/media/ABCdef/2"`);
  expect(body).toContain(`data-media="${ORIGIN}/media/${shortcodeOfMediaId(story)}/1"`);
  expect(body).toContain(`data-media="${ORIGIN}/media/www.facebook.com/mannynewsletter/posts/pfbid`);
  expect(body).toContain(`data-media="${ORIGIN}/media/www.facebook.com/photo.php?fbid=123&amp;set=a.1"`);
});

test("other platforms and records without a URL have no preview", async () => {
  const keys = [
    record("2026-10-16T01:00:00.000Z", { url: "https://x.com/someone/status/1" }),
    record("2026-10-16T02:00:00.000Z", { url: "https://www.instagram.com/someone/" }),
    record("2026-10-16T03:00:00.000Z", {}),
  ];
  const { response, body } = await page("/log", { keys });
  expect(response.status).toBe(200);
  expect(body).not.toContain("data-media=");
  expect(body).toContain("2026-10-16 03:00:00");
});

test("urls are HTML-escaped", async () => {
  const keys = [record("2026-10-16T01:00:00.000Z", { url: `https://www.youtube.com/watch?v="><script>alert(1)</script>` })];
  const { body } = await page("/log?q=%3Cb%3E", { keys: [] });
  expect(body).not.toContain("<b>");
  const listed = await page("/log", { keys });
  expect(listed.body).not.toContain("<script>alert");
  expect(listed.body).toContain("&lt;script&gt;");
});

test("the page is not cached", async () => {
  const { response } = await page("/log");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
});

test("a failing list answers 503", async () => {
  for (const mode of ["throw", "reject"] as const) {
    const { response } = await page("/log", { mode });
    expect(response.status).toBe(503);
  }
});
