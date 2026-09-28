import { expect, spyOn, test } from "bun:test";
import { createWorker } from "../src/index";
import { parseEmbed } from "../src/instagram";
import { fakeCache } from "./support/fake-cache";

const DISCORD = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/instagram/${name}`, import.meta.url)).text();
}

function call(
  app: { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> },
  input: string,
  headers?: HeadersInit,
): Promise<Response> {
  return app.fetch(new Request(input, { headers }), {} as Env, ctx);
}

function htmlResponse(body: string): Promise<Response> {
  return Promise.resolve(new Response(body, { status: 200 }));
}

test("a discord crawler receives an og page pointing at this service", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toContain('<meta property="og:image" content="https://bl.example/media/BsOGulcndj-/1">');
    expect(body).toContain('<meta name="twitter:image" content="https://bl.example/media/BsOGulcndj-/1">');
    expect(body).toContain('<meta property="og:title" content="@world_record_egg">');
    expect(body).toContain('<meta property="og:url" content="https://www.instagram.com/p/BsOGulcndj-/">');
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(body).toContain(
      '<meta http-equiv="refresh" content="0; url=https://www.instagram.com/p/BsOGulcndj-/">',
    );
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("the og page does not embed a cdninstagram url", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/", {
      "User-Agent": DISCORD,
    });
    expect(await res.text()).not.toContain("cdninstagram");
  } finally {
    spy.mockRestore();
  }
});

test("an instagram.com post keeps img_index and points the image at this service", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    const res = await call(
      app,
      "https://bl.example/instagram.com/p/BsOGulcndj-?img_index=2&igsh=xyz",
      { "User-Agent": DISCORD },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      '<meta property="og:url" content="https://instagram.com/p/BsOGulcndj-?img_index=2">',
    );
    expect(body).toContain('<meta property="og:image" content="https://bl.example/media/BsOGulcndj-/1">');
  } finally {
    spy.mockRestore();
  }
});

test("a post with no caption renders an empty og description", async () => {
  const html =
    '<div data-media-type="GraphImage"><span class="UsernameText">u</span><img class="EmbeddedMediaImage" alt="x" src="https://scontent-xyz.cdninstagram.com/v/p.jpg?oe=1"></div>';
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/", {
      "User-Agent": DISCORD,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<meta property="og:description" content="">');
  } finally {
    spy.mockRestore();
  }
});

test("a media url redirects to the current signed cdn url", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const mediaUrl = parseEmbed(html)?.media[0]?.url;
  if (mediaUrl === undefined) throw new Error("missing media url");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, "https://bl.example/media/BsOGulcndj-/1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(mediaUrl);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("https://www.instagram.com/p/BsOGulcndj-/embed/captioned/");
  } finally {
    spy.mockRestore();
  }
});

test("a media redirect reuses the post cached for the preview", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const mediaUrl = parseEmbed(html)?.media[0]?.url;
  if (mediaUrl === undefined) throw new Error("missing media url");
  const fake = fakeCache();
  const app = createWorker({ cache: () => fake.cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    await call(app, "https://bl.example/www.instagram.com/p/BsOGulcndj-/", {
      "User-Agent": DISCORD,
    });
    const res = await call(app, "https://bl.example/media/BsOGulcndj-/1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(mediaUrl);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("a video og page does not embed a cdn address", async () => {
  const html = await fixture("embed-DJvkjAlvNc8.html");
  const app = createWorker({ cache: () => fakeCache().cache });
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => htmlResponse(html)) as unknown as typeof fetch,
  );
  try {
    const res = await call(app, "https://bl.example/www.instagram.com/p/DJvkjAlvNc8/", {
      "User-Agent": DISCORD,
    });
    const body = await res.text();
    expect(body).not.toContain("cdninstagram");
    expect(body).not.toContain("fbcdn");
  } finally {
    spy.mockRestore();
  }
});
