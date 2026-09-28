import { expect, spyOn, test } from "bun:test";
import { createWorker } from "../src/index";
import { fakeCache } from "./support/fake-cache";

const DISCORD = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";
const POST = "https://bl.example/www.instagram.com/p/BsOGulcndj-/?img_index=2&igsh=xyz";
const CLEANED = "https://www.instagram.com/p/BsOGulcndj-/?img_index=2";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/instagram/${name}`, import.meta.url)).text();
}

async function expectOpen(
  impl: () => Promise<Response>,
  fetches: number,
  requestUrl = POST,
  location = CLEANED,
): Promise<ReturnType<typeof fakeCache>> {
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(impl as unknown as typeof fetch);
  try {
    const res = await app.fetch(new Request(requestUrl, { headers: { "User-Agent": DISCORD } }), {} as Env, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(location);
    expect(await res.text()).toBe("");
    expect(spy).toHaveBeenCalledTimes(fetches);
  } finally {
    spy.mockRestore();
  }
  return fake;
}

test("a crawler is redirected when instagram returns 403", async () => {
  await expectOpen(() => Promise.resolve(new Response(null, { status: 403 })), 1);
});

test("a crawler is redirected when instagram returns 500", async () => {
  await expectOpen(() => Promise.resolve(new Response(null, { status: 500 })), 1);
});

test("a crawler is redirected when the embed page is broken", async () => {
  const html = await fixture("embed-B7Y6Y3dF9sq.html");
  await expectOpen(() => Promise.resolve(new Response(html, { status: 200 })), 1);
});

test("a crawler receives an og page for a carousel", async () => {
  const html = await fixture("embed-DOBXTYNklfi.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof fetch,
  );
  try {
    const res = await app.fetch(
      new Request("https://bl.example/www.instagram.com/p/DOBXTYNklfi/", { headers: { "User-Agent": DISCORD } }),
      {} as Env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("a crawler is redirected when instagram sends the login page", async () => {
  await expectOpen(
    () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: "https://www.instagram.com/accounts/login/" },
        }),
      ),
    1,
  );
});

test("a crawler is redirected when the instagram fetch fails", async () => {
  await expectOpen(() => Promise.reject(new TypeError("fetch failed")), 1);
});

test("a crawler is redirected when the cache binding throws", async () => {
  const app = createWorker({
    cache: () => {
      throw new Error("no cache");
    },
  });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
  );
  try {
    const res = await app.fetch(new Request(POST, { headers: { "User-Agent": DISCORD } }), {} as Env, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(CLEANED);
    expect(await res.text()).toBe("");
    expect(spy).toHaveBeenCalledTimes(0);
  } finally {
    spy.mockRestore();
  }
});

test("a crawler is redirected when the embed video is blocked", async () => {
  const html = await fixture("embed-Dd0M_ifNfXO.html");
  const fake = await expectOpen(() => Promise.resolve(new Response(html, { status: 200 })), 1);
  expect(fake.entries.size).toBe(0);
});
