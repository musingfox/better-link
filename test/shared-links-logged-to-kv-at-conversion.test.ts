import { afterEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { logSharedLink } from "../src/shared-link-log";
import { fakeKv } from "./support/fake-kv";

const KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z-[0-9a-f-]{36}$/;
const CLEANED = new URL("https://www.youtube.com/watch?v=abc");
const YOUTUBE = "https://www.youtube.com/watch?v=abc";

afterEach(() => setSystemTime());

function fakeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(this: unknown, promise: Promise<unknown>) {
      if (this !== ctx) throw new TypeError("waitUntil must be called as a method");
      pending.push(promise);
    },
  };
  return { ctx: ctx as unknown as ExecutionContext, pending };
}

function envWith(binding: unknown): Env {
  return { SHARED_LINKS: binding } as unknown as Env;
}

test("one conversion writes one expiring, time-keyed record", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, CLEANED, false);
  expect(pending).toHaveLength(1);
  await Promise.all(pending);
  expect(kv.puts).toHaveLength(1);
  const [put] = kv.puts;
  expect(put?.key).toMatch(KEY);
  const at = put?.key.slice(0, 24);
  expect(put?.options.expirationTtl).toBe(7_776_000);
  expect(put?.value).toBe(YOUTUBE);
  expect(put?.options.metadata).toEqual({ url: YOUTUBE, at });
});

test("raw conversions record raw: true in metadata", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, CLEANED, true);
  await Promise.all(pending);
  const [put] = kv.puts;
  expect(put?.options.metadata).toEqual({ url: YOUTUBE, at: put?.key.slice(0, 24), raw: true });
});

test("keys from later calls sort after keys from earlier calls", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  logSharedLink(envWith(kv.binding), ctx, CLEANED, false);
  setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
  logSharedLink(envWith(kv.binding), ctx, CLEANED, false);
  await Promise.all(pending);
  const keys = kv.puts.map((put) => put.key);
  expect(keys).toEqual([...keys].sort());
});

test("calls under one frozen time share the timestamp prefix and differ in key", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  setSystemTime(new Date("2026-03-03T03:03:03.003Z"));
  logSharedLink(envWith(kv.binding), ctx, CLEANED, false);
  logSharedLink(envWith(kv.binding), ctx, CLEANED, false);
  await Promise.all(pending);
  const [first, second] = kv.puts;
  expect(first?.key).not.toBe(second?.key);
  expect(first?.key.slice(0, 24)).toBe("2026-03-03T03:03:03.003Z");
  expect(second?.key.slice(0, 24)).toBe("2026-03-03T03:03:03.003Z");
});

test("waitUntil is invoked as a method on ctx", () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  expect(() => logSharedLink(envWith(kv.binding), ctx, CLEANED, false)).not.toThrow();
  expect(pending).toHaveLength(1);
});

test("the collected promise is the write itself", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, CLEANED, false);
  expect(kv.puts).toHaveLength(1);
  await Promise.all(pending);
  expect(kv.puts).toHaveLength(1);
});

test("without the binding nothing is scheduled", () => {
  for (const env of [{}, { SHARED_LINKS: undefined }]) {
    const { ctx, pending } = fakeCtx();
    expect(logSharedLink(env as unknown as Env, ctx, CLEANED, false)).toBeUndefined();
    expect(pending).toHaveLength(0);
  }
});

test("a put that throws synchronously is swallowed", async () => {
  const kv = fakeKv("throw");
  const { ctx, pending } = fakeCtx();
  expect(() => logSharedLink(envWith(kv.binding), ctx, CLEANED, false)).not.toThrow();
  await Promise.all(pending);
  expect(kv.puts).toHaveLength(1);
});

test("a put that rejects is swallowed without an unhandled rejection", async () => {
  const kv = fakeKv("reject");
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, CLEANED, false);
  await expect(Promise.all(pending)).resolves.toBeDefined();
});

test("a binding without put is swallowed", async () => {
  const { ctx, pending } = fakeCtx();
  expect(() => logSharedLink(envWith({}), ctx, CLEANED, false)).not.toThrow();
  await expect(Promise.all(pending)).resolves.toBeDefined();
});

test("a waitUntil that throws does not reach the caller", () => {
  const kv = fakeKv();
  const ctx = {
    waitUntil() {
      throw new Error("boom");
    },
  } as unknown as ExecutionContext;
  expect(() => logSharedLink(envWith(kv.binding), ctx, CLEANED, false)).not.toThrow();
});

test("the logged URL drops userinfo and fragment", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, new URL("https://user:s3cret@www.youtube.com/watch?v=abc#t=5"), false);
  await Promise.all(pending);
  const [put] = kv.puts;
  expect(put?.value).toBe(YOUTUBE);
  expect(put?.options.metadata.url).toBe(YOUTUBE);
  for (const text of [put?.value, JSON.stringify(put?.options.metadata)]) {
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("user");
    expect(text).not.toContain("#");
  }
});

test("an http URL is logged in https form", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, new URL("http://example.com/a?b=1"), false);
  await Promise.all(pending);
  expect(kv.puts[0]?.value).toBe("https://example.com/a?b=1");
});

test("a failed write logs nothing to the console", async () => {
  const spies = [spyOn(console, "log"), spyOn(console, "error"), spyOn(console, "warn")];
  try {
    const kv = fakeKv("reject");
    const { ctx, pending } = fakeCtx();
    logSharedLink(envWith(kv.binding), ctx, CLEANED, false);
    await Promise.all(pending);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

function sizeOf(metadata: object): number {
  return new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
}

function urlWithMetadataBytes(target: number): URL {
  const at = "2026-04-04T04:04:04.004Z";
  const base = sizeOf({ url: "https://example.com/", at });
  return new URL(`https://example.com/${"a".repeat(target - base)}`);
}

test("metadata keeps the url when it is exactly 1,024 bytes", async () => {
  setSystemTime(new Date("2026-04-04T04:04:04.004Z"));
  const cleaned = urlWithMetadataBytes(1_024);
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, cleaned, false);
  await Promise.all(pending);
  expect(sizeOf(kv.puts[0]?.options.metadata ?? {})).toBe(1_024);
  expect(kv.puts[0]?.options.metadata).toHaveProperty("url", cleaned.href);
});

test("metadata drops the url at 1,025 bytes but still logs it as the value", async () => {
  setSystemTime(new Date("2026-04-04T04:04:04.004Z"));
  const cleaned = urlWithMetadataBytes(1_025);
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, cleaned, false);
  await Promise.all(pending);
  expect(kv.puts[0]?.options.metadata).toEqual({ at: "2026-04-04T04:04:04.004Z" });
  expect(kv.puts[0]?.value).toBe(`https://${cleaned.host}${cleaned.pathname}`);
});

test("the size limit counts bytes, not characters", async () => {
  // 500 "é" are 1,000 bytes but only 500 characters; URL objects percent-encode non-ASCII,
  // so this uses a plain object to reach the byte measure with multibyte text.
  const cleaned = { host: "example.com", pathname: `/${"é".repeat(500)}`, search: "" } as unknown as URL;
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, cleaned, false);
  await Promise.all(pending);
  expect(kv.puts[0]?.options.metadata).toEqual({ at: expect.any(String) });
});

test("an oversize raw record keeps raw: true without the url", async () => {
  setSystemTime(new Date("2026-04-04T04:04:04.004Z"));
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, urlWithMetadataBytes(1_025), true);
  await Promise.all(pending);
  expect(kv.puts[0]?.options.metadata).toEqual({ at: "2026-04-04T04:04:04.004Z", raw: true });
});
