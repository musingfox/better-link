import { afterEach, beforeEach, expect, jest, setSystemTime, spyOn, test } from "bun:test";
import { createWorker } from "../src/index";
import { logSharedLink } from "../src/shared-link-log";
import { fakeCache } from "./support/fake-cache";
import { fakeKv } from "./support/fake-kv";

const KEY = /^\d{13}-[0-9a-f-]{36}$/;

function atOf(key: string | undefined): string {
  return new Date(9_999_999_999_999 - Number(key?.slice(0, 13))).toISOString();
}
const YOUTUBE = "https://www.youtube.com/watch?v=abc";

// Conversions now summarize the post upstream; no test may reach the network.
let fetchSpy: ReturnType<typeof spyOn> | undefined;
beforeEach(() => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() =>
    Promise.resolve(new Response("", { status: 404 }))) as unknown as typeof fetch);
});

afterEach(() => {
  setSystemTime();
  fetchSpy?.mockRestore();
});

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
  logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false);
  expect(pending).toHaveLength(1);
  await Promise.all(pending);
  expect(kv.puts).toHaveLength(1);
  const [put] = kv.puts;
  expect(put?.key).toMatch(KEY);
  const at = atOf(put?.key);
  expect(put?.options.expirationTtl).toBe(7_776_000);
  expect(put?.value).toBe(YOUTUBE);
  expect(put?.options.metadata).toEqual({ url: YOUTUBE, at });
});

test("raw conversions record raw: true in metadata", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, YOUTUBE, true);
  await Promise.all(pending);
  const [put] = kv.puts;
  expect(put?.options.metadata).toEqual({ url: YOUTUBE, at: atOf(put?.key), raw: true });
});

test("keys from later calls sort before keys from earlier calls", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false);
  setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
  logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false);
  await Promise.all(pending);
  const keys = kv.puts.map((put) => put.key);
  expect(keys).toEqual([...keys].sort().reverse());
});

test("calls under one frozen time share the timestamp prefix and differ in key", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  setSystemTime(new Date("2026-03-03T03:03:03.003Z"));
  logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false);
  logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false);
  await Promise.all(pending);
  const [first, second] = kv.puts;
  expect(first?.key).not.toBe(second?.key);
  const prefix = String(9_999_999_999_999 - Date.parse("2026-03-03T03:03:03.003Z"));
  expect(first?.key.slice(0, 13)).toBe(prefix);
  expect(second?.key.slice(0, 13)).toBe(prefix);
  expect(first?.options.metadata.at).toBe("2026-03-03T03:03:03.003Z");
});

test("waitUntil is invoked as a method on ctx", () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  expect(() => logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false)).not.toThrow();
  expect(pending).toHaveLength(1);
});

test("the collected promise is the write itself", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false);
  expect(kv.puts).toHaveLength(0);
  await Promise.all(pending);
  expect(kv.puts).toHaveLength(1);
});

test("the post's author and text are written into the metadata", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false, () => Promise.resolve({ author: "Rick", text: "Never" }));
  await Promise.all(pending);
  const [put] = kv.puts;
  expect(put?.options.metadata).toEqual({ url: YOUTUBE, at: atOf(put?.key), author: "Rick", text: "Never" });
});

test("a long text is cut by bytes so the metadata stays within 1,024 bytes", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  const text = "字".repeat(1_000);
  logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false, () => Promise.resolve({ author: "作者", text }));
  await Promise.all(pending);
  const metadata = kv.puts[0]?.options.metadata ?? {};
  const size = new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
  expect(size).toBeLessThanOrEqual(1_024);
  expect(size).toBeGreaterThan(1_024 - 3);
  expect(metadata.url).toBe(YOUTUBE);
  expect(metadata.author).toBe("作者");
  expect(text.startsWith(String(metadata.text))).toBe(true);
});

test("a record whose URL does not fit keeps no summary", async () => {
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  const long = `https://www.youtube.com/watch?v=${"a".repeat(1_100)}`;
  logSharedLink(envWith(kv.binding), ctx, long, false, () => Promise.resolve({ author: "A", text: "T" }));
  await Promise.all(pending);
  expect(kv.puts[0]?.options.metadata).toEqual({ at: atOf(kv.puts[0]?.key) });
});

test("a failing summary still writes the record without it", async () => {
  const throwing = (): Promise<null> => {
    throw new Error("sync");
  };
  for (const summarize of [() => Promise.reject(new Error("upstream")), () => Promise.resolve(null), throwing]) {
    const kv = fakeKv();
    const { ctx, pending } = fakeCtx();
    logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false, summarize);
    await Promise.all(pending);
    expect(kv.puts[0]?.options.metadata).toEqual({ url: YOUTUBE, at: atOf(kv.puts[0]?.key) });
  }
});

test("a summary that never settles is abandoned after 10 seconds", async () => {
  jest.useFakeTimers();
  try {
    const kv = fakeKv();
    const { ctx, pending } = fakeCtx();
    logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false, () => new Promise(() => {}));
    jest.advanceTimersByTime(9_999);
    await Promise.resolve();
    expect(kv.puts).toHaveLength(0);
    jest.advanceTimersByTime(1);
    await Promise.all(pending);
    expect(kv.puts[0]?.options.metadata).toEqual({ url: YOUTUBE, at: atOf(kv.puts[0]?.key) });
  } finally {
    jest.useRealTimers();
  }
});

test("without the binding nothing is scheduled", () => {
  for (const env of [{}, { SHARED_LINKS: undefined }]) {
    const { ctx, pending } = fakeCtx();
    expect(logSharedLink(env as unknown as Env, ctx, YOUTUBE, false)).toBeUndefined();
    expect(pending).toHaveLength(0);
  }
});

test("a put that throws synchronously is swallowed", async () => {
  const kv = fakeKv("throw");
  const { ctx, pending } = fakeCtx();
  expect(() => logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false)).not.toThrow();
  await Promise.all(pending);
  expect(kv.puts).toHaveLength(1);
});

test("a put that rejects is swallowed without an unhandled rejection", async () => {
  const kv = fakeKv("reject");
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false);
  await expect(Promise.all(pending)).resolves.toBeDefined();
});

test("a binding without put is swallowed", async () => {
  const { ctx, pending } = fakeCtx();
  expect(() => logSharedLink(envWith({}), ctx, YOUTUBE, false)).not.toThrow();
  await expect(Promise.all(pending)).resolves.toBeDefined();
});

test("a waitUntil that throws does not reach the caller", () => {
  const kv = fakeKv();
  const ctx = {
    waitUntil() {
      throw new Error("boom");
    },
  } as unknown as ExecutionContext;
  expect(() => logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false)).not.toThrow();
});

test("a failed write logs nothing to the console", async () => {
  const spies = [spyOn(console, "log"), spyOn(console, "error"), spyOn(console, "warn")];
  try {
    const kv = fakeKv("reject");
    const { ctx, pending } = fakeCtx();
    logSharedLink(envWith(kv.binding), ctx, YOUTUBE, false);
    await Promise.all(pending);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

function sizeOf(metadata: object): number {
  return new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
}

function urlWithMetadataBytes(target: number): string {
  const at = "2026-04-04T04:04:04.004Z";
  const base = sizeOf({ url: "https://example.com/", at });
  return `https://example.com/${"a".repeat(target - base)}`;
}

test("metadata keeps the url when it is exactly 1,024 bytes", async () => {
  setSystemTime(new Date("2026-04-04T04:04:04.004Z"));
  const url = urlWithMetadataBytes(1_024);
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, url, false);
  await Promise.all(pending);
  expect(sizeOf(kv.puts[0]?.options.metadata ?? {})).toBe(1_024);
  expect(kv.puts[0]?.options.metadata).toHaveProperty("url", url);
});

test("metadata drops the url at 1,025 bytes but still logs it as the value", async () => {
  setSystemTime(new Date("2026-04-04T04:04:04.004Z"));
  const url = urlWithMetadataBytes(1_025);
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, url, false);
  await Promise.all(pending);
  expect(kv.puts[0]?.options.metadata).toEqual({ at: "2026-04-04T04:04:04.004Z" });
  expect(kv.puts[0]?.value).toBe(url);
});

test("the size limit counts bytes, not characters", async () => {
  // 500 "é" are 1,000 bytes but only 500 characters.
  const url = `https://example.com/${"é".repeat(500)}`;
  const kv = fakeKv();
  const { ctx, pending } = fakeCtx();
  logSharedLink(envWith(kv.binding), ctx, url, false);
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

const YOUTUBE_REQUEST = "https://bl.example/?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc";

function appWithCache() {
  return createWorker({ cache: () => fakeCache().cache });
}

function runConversion(env: Env, requestUrl = YOUTUBE_REQUEST) {
  const { ctx, pending } = fakeCtx();
  const app = appWithCache();
  return { response: app.fetch(new Request(requestUrl), env, ctx), pending };
}

async function snapshot(res: Response) {
  return { status: res.status, body: await res.text(), type: res.headers.get("content-type") };
}

test("a successful conversion writes one record and returns the same response", async () => {
  const withKv = fakeKv();
  const { response, pending } = runConversion(envWith(withKv.binding));
  const body = await snapshot(await response);
  await Promise.all(pending);

  const plain = await snapshot(await runConversion({} as Env).response);
  expect(body).toEqual(plain);
  expect(body.body).toBe("https://bl.example/www.youtube.com/watch?v=abc");
  expect(withKv.puts).toHaveLength(1);
  expect(withKv.puts[0]?.options.metadata).toEqual({ url: YOUTUBE, at: atOf(withKv.puts[0]?.key) });
  expect(withKv.puts[0]?.options.expirationTtl).toBe(7_776_000);
});

test("a conversion summarizes the post into the record", async () => {
  const html = await Bun.file(new URL("./fixtures/instagram/embed-BsOGulcndj-.html", import.meta.url)).text();
  fetchSpy?.mockImplementation((() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof fetch);
  const kv = fakeKv();
  const { response, pending } = runConversion(
    envWith(kv.binding),
    "https://bl.example/?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FBsOGulcndj-%2F",
  );
  expect((await response).status).toBe(200);
  await Promise.all(pending);
  expect(kv.puts[0]?.options.metadata.author).toBe("world_record_egg");
  expect(String(kv.puts[0]?.options.metadata.text)).toStartWith("Let’s set a world record together");
});

test("raw=1 writes one record marked raw and returns the same response", async () => {
  const kv = fakeKv();
  const { response, pending } = runConversion(envWith(kv.binding), `${YOUTUBE_REQUEST}&raw=1`);
  const body = await snapshot(await response);
  await Promise.all(pending);
  expect(body.body).toBe(YOUTUBE);
  expect(kv.puts).toHaveLength(1);
  expect(kv.puts[0]?.options.metadata).toHaveProperty("raw", true);
});

test("without the binding the response is unchanged and nothing is scheduled", async () => {
  const { response, pending } = runConversion({} as Env);
  expect((await response).status).toBe(200);
  expect(pending).toHaveLength(0);
});

test("a throwing or rejecting put does not change the response", async () => {
  const plain = await snapshot(await runConversion({} as Env).response);
  for (const mode of ["throw", "reject"] as const) {
    const { response, pending } = runConversion(envWith(fakeKv(mode).binding));
    const body = await snapshot(await response);
    await Promise.all(pending);
    expect(body).toEqual(plain);
  }
});

test("a put that never settles does not delay the response", async () => {
  const { response } = runConversion(envWith(fakeKv("hang").binding));
  const res = await response;
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("https://bl.example/www.youtube.com/watch?v=abc");
});

test("the recorded url is the cleaned url the response points to", async () => {
  const kv = fakeKv();
  const request = "https://bl.example/?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FBsOGulcndj-%2F%3Figsh%3Dxyz";
  const { response, pending } = runConversion(envWith(kv.binding), request);
  const body = await (await response).text();
  await Promise.all(pending);
  expect(body).toBe("https://bl.example/www.instagram.com/p/BsOGulcndj-/");
  expect(kv.puts[0]?.value).toBe("https://www.instagram.com/p/BsOGulcndj-/");
  expect(kv.puts[0]?.value).not.toContain("igsh");
});

test("the recorded url drops the fragment", async () => {
  const kv = fakeKv();
  const request = "https://bl.example/?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc%23t%3D5";
  const { response, pending } = runConversion(envWith(kv.binding), request);
  const body = await (await response).text();
  await Promise.all(pending);
  expect(body).toBe("https://bl.example/www.youtube.com/watch?v=abc");
  expect(kv.puts[0]?.value).toBe(YOUTUBE);
  expect(JSON.stringify(kv.puts[0]?.options.metadata)).not.toContain("#");
});

test("an http input is recorded in https form", async () => {
  const kv = fakeKv();
  const request = "https://bl.example/?url=http%3A%2F%2Fexample.com%2Fa%3Fb%3D1&raw=1";
  const { response, pending } = runConversion(envWith(kv.binding), request);
  const body = await (await response).text();
  await Promise.all(pending);
  expect(body).toBe("https://example.com/a?b=1");
  expect(kv.puts[0]?.value).toBe(body);
});

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const DISCORD_UA = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";

test("share redirects and media never touch kv", async () => {
  const kv = fakeKv();
  const env = envWith(kv.binding);
  {
    const cases: [string, string | undefined][] = [
      ["https://bl.example/www.instagram.com/p/BsOGulcndj-/", BROWSER],
      ["https://bl.example/www.instagram.com/p/BsOGulcndj-/", DISCORD_UA],
      ["https://bl.example/media/BsOGulcndj-/1", undefined],
    ];
    for (const [url, ua] of cases) {
      const { ctx, pending } = fakeCtx();
      const headers = ua === undefined ? undefined : { "User-Agent": ua };
      const app = appWithCache();
      const plain = await app.fetch(new Request(url, { headers }), {} as Env, fakeCtx().ctx);
      const withKv = await app.fetch(new Request(url, { headers }), env, ctx);
      expect(withKv.status).toBe(plain.status);
      expect(withKv.headers.get("location")).toBe(plain.headers.get("location"));
      expect(pending).toHaveLength(0);
    }
    expect(kv.puts).toHaveLength(0);
  }
});

test("failed conversions never touch kv and keep their 400 response", async () => {
  const kv = fakeKv();
  const env = envWith(kv.binding);
  for (const query of ["", "?url=", "?url=notaurl", "?url=http%3A%2F%2Flocalhost%2Fx"]) {
    const { ctx, pending } = fakeCtx();
    const res = await appWithCache().fetch(new Request(`https://bl.example/${query}`), env, ctx);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("pass a percent-encoded http(s) URL as ?url=");
    expect(pending).toHaveLength(0);
  }
  expect(kv.puts).toHaveLength(0);
});

const CONFIG_FILE = "../cloudflare.config.ts";
let variant = 0;

async function configWithBuildVar(value: string | undefined) {
  const previous = process.env.LOG_SHARED_LINKS;
  try {
    if (value === undefined) delete process.env.LOG_SHARED_LINKS;
    else process.env.LOG_SHARED_LINKS = value;
    variant += 1;
    const module = (await import(`${CONFIG_FILE}?variant=${variant}`)) as { default: { worker: { env?: unknown } } };
    return module.default;
  } finally {
    if (previous === undefined) delete process.env.LOG_SHARED_LINKS;
    else process.env.LOG_SHARED_LINKS = previous;
  }
}

test("the default config declares no kv binding", async () => {
  const config = await configWithBuildVar(undefined);
  expect(JSON.stringify(config)).not.toContain('"type":"kv"');
  expect(config.worker.env).toBeUndefined();
});

test("LOG_SHARED_LINKS=1 declares the SHARED_LINKS kv binding", async () => {
  const config = await configWithBuildVar("1");
  expect(JSON.stringify(config.worker.env)).toBe('{"SHARED_LINKS":{"type":"kv"}}');
});

test("any other build value leaves the config without an env", async () => {
  for (const value of ["true", "0", "", "11"]) {
    const config = await configWithBuildVar(value);
    expect(config.worker.env).toBeUndefined();
  }
});

test("the test restores LOG_SHARED_LINKS to its value before the test", async () => {
  const before = process.env.LOG_SHARED_LINKS;
  await configWithBuildVar("1");
  expect(process.env.LOG_SHARED_LINKS).toBe(before);
});

test("both READMEs document the opt-in variable and binding", async () => {
  for (const name of ["README.md", "README.zh-TW.md"]) {
    const text = await Bun.file(new URL(`../${name}`, import.meta.url)).text();
    expect(text).toContain("LOG_SHARED_LINKS");
    expect(text).toContain("SHARED_LINKS");
  }
});
