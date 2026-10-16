import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createWorker } from "../src/index";
import { fakeCache } from "./support/fake-cache";
import { type KvKey, type KvMode, fakeKv } from "./support/fake-kv";

const ORIGIN = "https://link.example";

afterEach(() => setSystemTime());

function ctxWith(access: boolean): ExecutionContext {
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
    ...(access ? { access: { aud: "aud-tag", getIdentity: () => Promise.resolve(undefined) } } : {}),
  };
  return ctx as unknown as ExecutionContext;
}

function key(at: string, metadata: Record<string, unknown>): KvKey {
  return { name: `${at}-00000000-0000-4000-8000-000000000000`, metadata: { at, ...metadata } };
}

async function page(
  path: string,
  options: { access?: boolean; binding?: boolean; mode?: KvMode; keys?: KvKey[] } = {},
): Promise<{ response: Response; body: string; lists: { prefix: string }[] }> {
  const kv = fakeKv(options.mode ?? "ok", options.keys ?? []);
  const env = (options.binding ?? true) ? { SHARED_LINKS: kv.binding } : {};
  const worker = createWorker({ cache: () => fakeCache().cache });
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`), env as unknown as Env, ctxWith(options.access ?? true));
  return { response, body: await response.text(), lists: kv.lists };
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

test("the default day is today in UTC and the store is listed once", async () => {
  setSystemTime(new Date("2026-10-16T23:59:59.000Z"));
  const { response, lists } = await page("/log");
  expect(response.status).toBe(200);
  expect(lists).toEqual([{ prefix: "2026-10-16" }]);
});

test("?day= picks the listed day", async () => {
  const { lists } = await page("/log?day=2026-01-02");
  expect(lists).toEqual([{ prefix: "2026-01-02" }]);
});

test("an invalid day is rejected before listing", async () => {
  for (const day of ["2026-1-2", "2026-13-01", "2026-02-30", "x"]) {
    const { response, lists } = await page(`/log?day=${day}`);
    expect(response.status).toBe(400);
    expect(lists).toHaveLength(0);
  }
});

test("records are shown newest first with their share links", async () => {
  const keys = [
    key("2026-10-16T01:00:00.000Z", { url: "https://www.instagram.com/p/OLDER/" }),
    key("2026-10-16T02:00:00.000Z", { url: "https://www.youtube.com/watch?v=newer", raw: true }),
  ];
  const { body } = await page("/log?day=2026-10-16", { keys });
  expect(body.indexOf("youtube")).toBeLessThan(body.indexOf("OLDER"));
  expect(body).toContain(`${ORIGIN}/www.instagram.com/p/OLDER/`);
  expect(body).not.toContain(`${ORIGIN}/www.youtube.com`);
  expect(body).toContain("02:00:00");
});

test("a record without a url in its metadata still renders", async () => {
  const { response, body } = await page("/log?day=2026-10-16", { keys: [key("2026-10-16T01:00:00.000Z", {})] });
  expect(response.status).toBe(200);
  expect(body).toContain("01:00:00");
});

test("urls are HTML-escaped", async () => {
  const keys = [key("2026-10-16T01:00:00.000Z", { url: `https://www.youtube.com/watch?v="><script>alert(1)</script>` })];
  const { body } = await page("/log?day=2026-10-16", { keys });
  expect(body).not.toContain("<script>");
  expect(body).toContain("&lt;script&gt;");
});

test("the page is not cached", async () => {
  const { response } = await page("/log?day=2026-10-16");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
});

test("a failing list answers 503", async () => {
  for (const mode of ["throw", "reject"] as const) {
    const { response } = await page("/log?day=2026-10-16", { mode });
    expect(response.status).toBe(503);
  }
});
