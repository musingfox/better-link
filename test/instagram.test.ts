import { expect, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Fetcher } from "../src/expand";
import { instagramPost, parseEmbed } from "../src/instagram";
import { fakeCache } from "./support/fake-cache";

const EGG_MEDIA =
  "https://scontent.cdninstagram.com/v/t51.82787-15/625727639_18338153224242257_3827527793310630488_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=104&ig_cache_key=MTk0OTUyNTI3ODI4MTU1NDE3NA%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuNTg0LnNkci5yZWd1bGFyX3Bob3RvLkMzIn0%3D&_nc_ohc=YFKQ7apkKBgQ7kNvwFPu0Kb&_nc_oc=AdpCt06dwZzFQWP2kuK7UAFMK0HuszeeTFaClp9t3JPyJWmjm73K0jYkykuO01tHcww&_nc_zt=23&_nc_ht=scontent-tpe5-1.cdninstagram.com&_nc_gid=xwo3Asg41MB0RjldQ8lgQA&_nc_ss=7360f&oh=00_AQO3J7DVx6YxxYqCZcy3W0xiufLg5WnZQJeoc7uz04uViQ&oe=6ABFE180";

const SESSION_TOKEN = /"(csrf_token|token|ajaxpipe_token|compat_iframe_token)":"[^"]+"/;
const CSRF_COOKIE = /\["csrftoken","[^"]+"/;

function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/instagram/${name}`, import.meta.url)).text();
}

test("a single-image embed yields the account and the cdninstagram image", async () => {
  const post = parseEmbed(await fixture("embed-BsOGulcndj-.html"));
  expect(post?.username).toBe("world_record_egg");
  expect(post?.mediaUrl).toBe(EGG_MEDIA);
});

test("a minimal GraphImage embed keeps the image query and an empty caption", () => {
  const post = parseEmbed(
    '<div data-media-type="GraphImage"><span class="UsernameText">a_b</span><img class="EmbeddedMediaImage" alt="x" src="https://scontent-xyz.cdninstagram.com/v/p.jpg?a=1&amp;oe=ABC" srcset="https://other.example/s.jpg 640w"></div>',
  );
  expect(post).toEqual({
    username: "a_b",
    caption: "",
    mediaUrl: "https://scontent.cdninstagram.com/v/p.jpg?a=1&oe=ABC",
  });
});

const EGG_CAPTION =
  "Let’s set a world record together and get the most liked post on Instagram. Beating the current world record held by Kylie Jenner (18 million)! We got this 🙌\n\n#LikeTheEgg #EggSoldiers #EggGang";

function graphImage(inner: string): string {
  return `<div data-media-type="GraphImage"><span class="UsernameText">u</span><img class="EmbeddedMediaImage" src="https://scontent.cdninstagram.com/v/p.jpg">${inner}</div>`;
}

test("a single-image embed keeps the decoded caption", async () => {
  const post = parseEmbed(await fixture("embed-BsOGulcndj-.html"));
  expect(post?.caption).toBe(EGG_CAPTION);
  expect(EGG_CAPTION.includes("\u2019")).toBe(true);
});

test("a page with no caption div yields an empty caption", () => {
  const post = parseEmbed(
    '<div data-media-type="GraphImage"><span class="UsernameText">a_b</span><img class="EmbeddedMediaImage" alt="x" src="https://scontent-xyz.cdninstagram.com/v/p.jpg?a=1&amp;oe=ABC" srcset="https://other.example/s.jpg 640w"></div>',
  );
  expect(post?.caption).toBe("");
});

test("caption text drops the username, turns breaks into newlines, and keeps hashtag text", () => {
  const post = parseEmbed(
    graphImage(
      '<div class="Caption"><a class="CaptionUsername" href="/u/">u</a><br /><br />hi<br/>there <a href="/explore/tags/x/">#x</a><div class="CaptionComments">3 comments</div></div>',
    ),
  );
  expect(post?.caption).toBe("hi\nthere #x");
});

test("caption tags are stripped before entities are decoded", () => {
  const post = parseEmbed(
    graphImage('<div class="Caption"><a class="CaptionUsername">u</a>I &lt;3 &quot;eggs&quot; &amp; &#064;bob</div>'),
  );
  expect(post?.caption).toBe('I <3 "eggs" & @bob');
});

test("caption hex and decimal character references are decoded", () => {
  const post = parseEmbed(graphImage('<div class="Caption">a&#x1F64C;b&#39;c</div>'));
  expect(post?.caption).toBe("a🙌b'c");
});

test("a carousel embed is not a single image", async () => {
  expect(parseEmbed(await fixture("embed-DOBXTYNklfi.html"))).toBeNull();
});

test("a video embed is not a single image", async () => {
  expect(parseEmbed(await fixture("embed-DJvkjAlvNc8.html"))).toBeNull();
});

test("a broken embed page yields no post", async () => {
  expect(parseEmbed(await fixture("embed-B7Y6Y3dF9sq.html"))).toBeNull();
});

test("a watch-on-instagram page without an image yields no post", () => {
  expect(
    parseEmbed(
      '<div data-media-type="GraphImage"><span class="UsernameText">u</span><div class="WatchOnInstagram">Watch on Instagram</div></div>',
    ),
  ).toBeNull();
});

test("a graph image without an account name yields no post", () => {
  expect(
    parseEmbed(
      '<div data-media-type="GraphImage"><img class="EmbeddedMediaImage" src="https://scontent.cdninstagram.com/v/p.jpg"></div>',
    ),
  ).toBeNull();
});

test("a graph image with an empty account name yields no post", () => {
  expect(
    parseEmbed(
      '<div data-media-type="GraphImage"><span class="UsernameText"></span><img class="EmbeddedMediaImage" src="https://scontent.cdninstagram.com/v/p.jpg"></div>',
    ),
  ).toBeNull();
});

test("a graph image whose image source is not a url yields no post", () => {
  expect(
    parseEmbed(
      '<div data-media-type="GraphImage"><span class="UsernameText">u</span><img class="EmbeddedMediaImage" src="not a url"></div>',
    ),
  ).toBeNull();
});

test("an empty page yields no post", () => {
  expect(parseEmbed("")).toBeNull();
});

test("a cache miss loads the captioned embed once with the pinned user agent", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetcher: Fetcher = (input, init) => {
    calls.push({ input, init });
    return Promise.resolve(new Response(html, { status: 200 }));
  };
  const post = await instagramPost("BsOGulcndj-", {
    origin: "https://bl.example",
    cache: fakeCache().cache,
    fetcher,
  });
  expect(post).toEqual({
    username: "world_record_egg",
    caption: EGG_CAPTION,
    mediaUrl: EGG_MEDIA,
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.input).toBe("https://www.instagram.com/p/BsOGulcndj-/embed/captioned/");
  const init = calls[0]?.init;
  expect(init).toBeDefined();
  expect([...(new Headers(init?.headers).keys())]).toEqual(["user-agent"]);
  expect(new Headers(init?.headers).get("user-agent")).toBe("Go-http-client/1.1");
  expect(init?.redirect).toBe("manual");
  expect(init?.signal instanceof AbortSignal).toBe(true);
});

test("a cache miss uses the global fetch when no fetcher is injected", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const fetchEmbed = (() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof fetch;
  const spy = spyOn(globalThis, "fetch").mockImplementation(fetchEmbed);
  try {
    await instagramPost("BsOGulcndj-", {
      origin: "https://bl.example",
      cache: fakeCache().cache,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("https://www.instagram.com/p/BsOGulcndj-/embed/captioned/");
  } finally {
    spy.mockRestore();
  }
});

test("a cached post is returned without contacting instagram", async () => {
  const stored = {
    username: "cached_user",
    caption: "",
    mediaUrl: "https://scontent.cdninstagram.com/v/c.jpg?oe=1",
  };
  const fake = fakeCache();
  fake.entries.set(
    "https://bl.example/__cache/instagram/BsOGulcndj-",
    new Response(JSON.stringify(stored)),
  );
  const calls: string[] = [];
  const fetcher: Fetcher = (input) => {
    calls.push(input);
    return Promise.resolve(new Response(null, { status: 500 }));
  };
  const post = await instagramPost("BsOGulcndj-", {
    origin: "https://bl.example",
    cache: fake.cache,
    fetcher,
  });
  expect(post).toEqual(stored);
  expect(calls).toHaveLength(0);
  expect(fake.calls.put).toBe(0);
});

test("a cached body that is not json yields no post and does not fetch", async () => {
  const fake = fakeCache();
  fake.entries.set("https://bl.example/__cache/instagram/BsOGulcndj-", new Response("not json"));
  const calls: string[] = [];
  const fetcher: Fetcher = (input) => {
    calls.push(input);
    return Promise.resolve(new Response(null, { status: 200 }));
  };
  const post = await instagramPost("BsOGulcndj-", {
    origin: "https://bl.example",
    cache: fake.cache,
    fetcher,
  });
  expect(post).toBeNull();
  expect(calls).toHaveLength(0);
});

function countingFetcher(response: Response | Promise<Response>): {
  fetcher: Fetcher;
  calls: string[];
} {
  const calls: string[] = [];
  const fetcher: Fetcher = (input) => {
    calls.push(input);
    return Promise.resolve(response);
  };
  return { fetcher, calls };
}

test("an upstream 403 yields no post", async () => {
  const { fetcher, calls } = countingFetcher(new Response(null, { status: 403 }));
  const post = await instagramPost("BsOGulcndj-", {
    origin: "https://bl.example",
    cache: fakeCache().cache,
    fetcher,
  });
  expect(post).toBeNull();
  expect(calls).toHaveLength(1);
});

test("an upstream 500 yields no post", async () => {
  const { fetcher } = countingFetcher(new Response(null, { status: 500 }));
  expect(
    await instagramPost("BsOGulcndj-", { origin: "https://bl.example", cache: fakeCache().cache, fetcher }),
  ).toBeNull();
});

test("a redirect to the instagram login page yields no post", async () => {
  const { fetcher } = countingFetcher(
    new Response(null, { status: 302, headers: { Location: "https://www.instagram.com/accounts/login/" } }),
  );
  expect(
    await instagramPost("BsOGulcndj-", { origin: "https://bl.example", cache: fakeCache().cache, fetcher }),
  ).toBeNull();
});

test("a redirect to unsupportedbrowser yields no post", async () => {
  const { fetcher } = countingFetcher(
    new Response(null, {
      status: 302,
      headers: { Location: "https://www.facebook.com/unsupportedbrowser" },
    }),
  );
  expect(
    await instagramPost("BsOGulcndj-", { origin: "https://bl.example", cache: fakeCache().cache, fetcher }),
  ).toBeNull();
});

test("a captioned embed that is not a single image yields no post", async () => {
  const { fetcher } = countingFetcher(new Response(await fixture("embed-B7Y6Y3dF9sq.html"), { status: 200 }));
  expect(
    await instagramPost("B7Y6Y3dF9sq", { origin: "https://bl.example", cache: fakeCache().cache, fetcher }),
  ).toBeNull();
});

test("a failed fetch yields no post", async () => {
  const fetcher: Fetcher = () => Promise.reject(new TypeError("fetch failed"));
  expect(
    await instagramPost("BsOGulcndj-", { origin: "https://bl.example", cache: fakeCache().cache, fetcher }),
  ).toBeNull();
});

test("an aborted fetch yields no post", async () => {
  const fetcher: Fetcher = () => Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  expect(
    await instagramPost("BsOGulcndj-", { origin: "https://bl.example", cache: fakeCache().cache, fetcher }),
  ).toBeNull();
});

test("a cache read failure yields no post", async () => {
  const fake = fakeCache();
  fake.cache.match = () => Promise.reject(new Error("cache down"));
  const { fetcher, calls } = countingFetcher(new Response(null, { status: 200 }));
  expect(
    await instagramPost("BsOGulcndj-", { origin: "https://bl.example", cache: fake.cache, fetcher }),
  ).toBeNull();
  expect(calls).toHaveLength(0);
});

test("a shortcode with a path segment is not fetched", async () => {
  const { fetcher, calls } = countingFetcher(new Response(null, { status: 200 }));
  expect(
    await instagramPost("../x", { origin: "https://bl.example", cache: fakeCache().cache, fetcher }),
  ).toBeNull();
  expect(calls).toHaveLength(0);
});

test("an empty shortcode is not fetched", async () => {
  const { fetcher, calls } = countingFetcher(new Response(null, { status: 200 }));
  expect(await instagramPost("", { origin: "https://bl.example", cache: fakeCache().cache, fetcher })).toBeNull();
  expect(calls).toHaveLength(0);
});

test("instagramPost miss-path timing (warning only, never fails)", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const samples: number[] = [];
  for (let i = 0; i < 50; i++) {
    const fetcher: Fetcher = () => Promise.resolve(new Response(html, { status: 200 }));
    const start = performance.now();
    await instagramPost("BsOGulcndj-", {
      origin: "https://bl.example",
      cache: fakeCache().cache,
      fetcher,
    });
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = (samples[24] + samples[25]) / 2;
  if (median > 2) console.warn(`instagramPost miss-path median ${median} ms`);
});

test("saved embed fixtures do not contain session tokens", async () => {
  const dir = new URL("./fixtures/instagram/", import.meta.url);
  const names = await readdir(fileURLToPath(dir.href));
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    const text = await Bun.file(new URL(name, dir)).text();
    expect(text.match(SESSION_TOKEN)).toBeNull();
    expect(text.match(CSRF_COOKIE)).toBeNull();
  }
});
