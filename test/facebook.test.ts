import { fileURLToPath } from "node:url";
import { expect, spyOn, test } from "bun:test";
import type { Fetcher } from "../src/expand";
import { facebookPost, isFacebookPostUrl, parsePostPage } from "../src/facebook";
import { fakeCache } from "./support/fake-cache";

const MANNY =
  "https://www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";
const STORY = "https://www.facebook.com/story.php?story_fbid=1&id=2";
const MANNY_PLUGIN =
  "https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fmannynewsletter%2Fposts%2Fpfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";
const STORY_PLUGIN =
  "https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fstory.php%3Fstory_fbid%3D1%26id%3D2";
const MANNY_KEY =
  "https://bl.example/__cache/facebook/v1/www.facebook.com%2Fmannynewsletter%2Fposts%2Fpfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";
const STORY_KEY =
  "https://bl.example/__cache/facebook/v1/www.facebook.com%2Fstory.php%3Fstory_fbid%3D1%26id%3D2";

test("a pfbid post url is a facebook post", () => {
  expect(isFacebookPostUrl(new URL(MANNY))).toBe(true);
});

test("a numeric post url is a facebook post", () => {
  expect(
    isFacebookPostUrl(new URL("https://www.facebook.com/mannynewsletter/posts/1044201515113178/")),
  ).toBe(true);
});

test("story and permalink urls with both ids are facebook posts", () => {
  expect(isFacebookPostUrl(new URL(STORY))).toBe(true);
  expect(isFacebookPostUrl(new URL("https://facebook.com/permalink.php?story_fbid=1&id=2"))).toBe(true);
});

test("photo urls with fbid are facebook posts", () => {
  expect(
    isFacebookPostUrl(
      new URL("https://www.facebook.com/photo.php?fbid=1044200305113299&set=a.231310739735597&type=3"),
    ),
  ).toBe(true);
  expect(isFacebookPostUrl(new URL("https://m.facebook.com/photo/?fbid=1"))).toBe(true);
});

test("shares, reels, groups, profiles, videos, watch, and extra segments are not posts", () => {
  const paths = [
    "/share/p/1Fu5ScGFUZ/",
    "/reel/1016339268064528",
    "/groups/g0v.general/permalink/1/",
    "/groups/1/posts/2/",
    "/mannynewsletter",
    "/mannynewsletter/videos/1/",
    "/watch/",
    "/a/posts/1/extra",
  ];
  for (const path of paths) {
    const url = new URL(`https://www.facebook.com${path}`);
    if (path === "/watch/") url.search = "?v=1";
    expect(isFacebookPostUrl(url)).toBe(false);
  }
});

test("story and photo urls missing an id are not posts", () => {
  expect(isFacebookPostUrl(new URL("https://www.facebook.com/story.php?story_fbid=1"))).toBe(false);
  expect(isFacebookPostUrl(new URL("https://www.facebook.com/story.php?story_fbid=&id=2"))).toBe(false);
  expect(isFacebookPostUrl(new URL("https://www.facebook.com/photo.php"))).toBe(false);
  expect(isFacebookPostUrl(new URL("https://www.facebook.com/photo/?set=a.1"))).toBe(false);
});

test("lookalike hosts and other platforms are not facebook posts", () => {
  expect(isFacebookPostUrl(new URL("https://www.facebook.com.evil.example/a/posts/1"))).toBe(false);
  expect(isFacebookPostUrl(new URL("https://l.facebook.com/a/posts/1"))).toBe(false);
  expect(isFacebookPostUrl(new URL("https://www.instagram.com/p/BsOGulcndj-/"))).toBe(false);
});

test("facebook source names no tracking parameter and no fix-service domain", async () => {
  const text = await Bun.file(new URL("../src/facebook.ts", import.meta.url)).text();
  expect(text).not.toMatch(/fbclid|igsh|img_index|utm_|rdid|share_url/);
  expect(text).not.toMatch(/fixupx\.com|tnktok\.com|bskx\.app|vxreddit\.com|phixiv\.net|fixthreads\.seria\.moe/);
  const root = new URL("../src/", import.meta.url);
  const tracking = /fbclid|igsh|img_index|utm_/;
  const trackingHits: string[] = [];
  for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: fileURLToPath(root.href) })) {
    const source = await Bun.file(new URL(file, root)).text();
    if (tracking.test(source)) trackingHits.push(file);
  }
  expect(trackingHits).toContain("clean.ts");
  expect(trackingHits.filter((file) => file !== "clean.ts")).toEqual([]);
});

function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/facebook/${name}`, import.meta.url)).text();
}

test("a compact post's first image is the post photo, not the avatar", async () => {
  const post = parsePostPage(await fixture("post-1Fu5ScGFUZ.zh-Hant.html"));
  expect(post).not.toBeNull();
  expect(post?.media).toHaveLength(1);
  const url = new URL(post?.media[0]?.url ?? "");
  expect(url.host).toBe("scontent.xx.fbcdn.net");
  expect(url.pathname).toBe("/v/t39.30808-6/823798199_1044200311779965_8752017110798614144_n.jpg");
  expect(url.search.startsWith("?stp=dst-jpg_s552x414_tt6&_nc_cat=103&")).toBe(true);
  expect(url.search).toContain("&oe=6AC06360");
  expect(post?.media[0]?.url).not.toContain("&amp;");
  expect(post?.media[0]?.url).not.toContain("t39.30808-1");
});

test("an album yields only its first post image", async () => {
  const post = parsePostPage(await fixture("post-album-3-images.zh-Hant.html"));
  expect(post?.media).toHaveLength(1);
  const url = new URL(post?.media[0]?.url ?? "");
  expect(url.host).toBe("scontent.xx.fbcdn.net");
  expect(url.pathname).toBe("/v/t39.30808-6/505414711_696631100029817_2583229648008244893_n.jpg");
  expect(url.href).toContain("&oe=6AC0660C");
});

test("english and traditional pages share the post image path", async () => {
  const en = parsePostPage(await fixture("post-1Fu5ScGFUZ.en.html"));
  const zh = parsePostPage(await fixture("post-1Fu5ScGFUZ.zh-Hant.html"));
  expect(new URL(en?.media[0]?.url ?? "").pathname).toBe(new URL(zh?.media[0]?.url ?? "").pathname);
});

test("a post image is rebuilt on the fixed cdn host", () => {
  expect(
    parsePostPage(
      '<img src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg" aria-label="A" role="img"><img src="https://scontent.x.fbcdn.net/v/t39.30808-6/p.jpg?oe=1&amp;oh=2">',
    ),
  ).toEqual({
    username: "A",
    caption: "",
    media: [{ kind: "image", url: "https://scontent.xx.fbcdn.net/v/t39.30808-6/p.jpg?oe=1&oh=2" }],
  });
});

test("an old photo size is not a post image", () => {
  expect(
    parsePostPage(
      '<img src="https://scontent.x.fbcdn.net/v/t1.6435-1/a.jpg" aria-label="A" role="img"><img src="https://scontent.x.fbcdn.net/v/t1.6435-9/old.jpg">',
    ),
  ).toBeNull();
});

test("a post image mentioned only in a query is ignored", () => {
  expect(
    parsePostPage(
      '<img src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg" aria-label="A" role="img"><img src="https://external.xx.fbcdn.net/emg1/v/t13/x?url=/v/t39.30808-6/p.jpg">',
    ),
  ).toBeNull();
});

test("scheme, userinfo, and port from the image url are dropped", () => {
  const post = parsePostPage(
    '<img src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg" aria-label="A" role="img"><img src="https://user:pw@evil.example:8443/v/t39.30808-6/p.jpg">',
  );
  expect(post?.media[0]?.url).toBe("https://scontent.xx.fbcdn.net/v/t39.30808-6/p.jpg");
});

test("a data-src lookalike does not replace the src post image", () => {
  const post = parsePostPage(
    '<img src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg" aria-label="A" role="img"><img data-src="https://scontent.x.fbcdn.net/v/t39.30808-1/x.jpg" src="https://scontent.x.fbcdn.net/v/t39.30808-6/p.jpg">',
  );
  expect(post?.media[0]?.url).toBe("https://scontent.xx.fbcdn.net/v/t39.30808-6/p.jpg");
});

test("a data-src post path is ignored when src is an avatar", () => {
  const post = parsePostPage(
    '<img src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg" aria-label="A" role="img"><img data-src="https://scontent.x.fbcdn.net/v/t39.30808-6/wrong.jpg" src="https://scontent.x.fbcdn.net/v/t39.30808-1/b.jpg"><img src="https://scontent.x.fbcdn.net/v/t39.30808-6/p.jpg">',
  );
  expect(post?.media[0]?.url).toBe("https://scontent.xx.fbcdn.net/v/t39.30808-6/p.jpg");
});

test("a json-escaped cdn url outside an img tag is ignored", () => {
  expect(
    parsePostPage(
      '<img src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg" aria-label="A" role="img"><script type="application/ld+json">{"contentUrl":"https:\\/\\/scontent.x.fbcdn.net\\/v\\/t39.30808-6\\/p.jpg"}</script>',
    ),
  ).toBeNull();
});

test("pages without a post image yield no post", async () => {
  for (const name of [
    "unavailable.zh-Hant.html",
    "unavailable.en.html",
    "empty-shell.html",
    "post-personal-text-link.zh-Hant.html",
    "reel-via-post-php.zh-Hant.html",
  ]) {
    expect(parsePostPage(await fixture(name))).toBeNull();
  }
});

test("an empty page or an unparseable image source yields no post", () => {
  expect(parsePostPage("")).toBeNull();
  expect(parsePostPage('<img src="not a url /v/t39.30808-6/">')).toBeNull();
});

test("a compact post names its author", async () => {
  const post = parsePostPage(await fixture("post-1Fu5ScGFUZ.zh-Hant.html"));
  expect(post?.username).toBe("曼報 Manny's Newsletter");
});

test("an album names its author", async () => {
  const post = parsePostPage(await fixture("post-album-3-images.zh-Hant.html"));
  expect(post?.username).toBe("源來適你");
});

test("the english page names the same author", async () => {
  const en = parsePostPage(await fixture("post-1Fu5ScGFUZ.en.html"));
  const zh = parsePostPage(await fixture("post-1Fu5ScGFUZ.zh-Hant.html"));
  expect(en?.username).toBe(zh?.username);
  expect(en?.username).toBe("曼報 Manny's Newsletter");
});

test("a post image without an author image yields no post", () => {
  expect(parsePostPage('<img src="https://scontent.x.fbcdn.net/v/t39.30808-6/p.jpg">')).toBeNull();
});

test("a blank author label yields no post", () => {
  expect(
    parsePostPage(
      '<img src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg" aria-label="  " role="img"><img src="https://scontent.x.fbcdn.net/v/t39.30808-6/p.jpg">',
    ),
  ).toBeNull();
});

const SHELL =
  '<img src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg" aria-label="A" role="img"><img src="https://scontent.x.fbcdn.net/v/t39.30808-6/p.jpg">';

test("a compact post keeps the full text without collapse controls", async () => {
  const caption = parsePostPage(await fixture("post-1Fu5ScGFUZ.zh-Hant.html"))?.caption ?? "";
  expect(caption.startsWith("2020 年，我開始利用下班時間寫免費電子報《曼報 Manny’s Newsletter》，至今累積超過 4.3 萬人訂閱，平均開信率超過 40%。\n\n兩年後，我又找了另一位上班族 Angela，")).toBe(true);
  expect(caption).toContain("「時下熱議的話題」。\n\n不過，關注這些事情超過五年後");
  expect(caption).not.toContain("⋯⋯");
  expect(caption).not.toContain("查看更多");
  expect(caption).not.toContain("See more");
  expect(caption).not.toContain("\u200b");
  expect(caption).not.toContain("<");
  expect(caption).not.toContain("&amp;");
  expect(caption).not.toContain("&#");
});

test("english and traditional pages share the post text", async () => {
  const en = parsePostPage(await fixture("post-1Fu5ScGFUZ.en.html"))?.caption;
  const zh = parsePostPage(await fixture("post-1Fu5ScGFUZ.zh-Hant.html"))?.caption;
  expect(en).toBe(zh);
});

test("an album keeps its post text", async () => {
  const caption = parsePostPage(await fixture("post-album-3-images.zh-Hant.html"))?.caption ?? "";
  expect(
    caption.startsWith("各位小夥伴們，你們知道後天 6/12（週四）有一場《Kafka相關饅頭營》線上研討會嗎？\n\n就算還不知道也沒關係！"),
  ).toBe(true);
});

test("collapse controls, breaks, and entities become plain text", () => {
  const post = parsePostPage(
    `${SHELL}<div data-testid="post_message" class="_5pbx userContent"><div class="text_exposed_root"><p>a<br /> \u200b<br /> b &amp; <a href="https://l.facebook.com/l.php?u=x">link</a> <span class="_6qdm">🎁</span><span class="text_exposed_hide">...</span><span class="text_exposed_show"> more</span></p><p> c</p></div></div><div>after</div>`,
  );
  expect(post?.caption).toBe("a\n\nb & link 🎁 more\n\nc");
});

test("nested divs contribute their text without added whitespace", () => {
  const post = parsePostPage(`${SHELL}<div data-testid="post_message"><div><div>x</div>y</div></div>z`);
  expect(post?.caption).toBe("xy");
});

test("a nested see-more control is removed", () => {
  const post = parsePostPage(
    `${SHELL}<div data-testid="post_message"><p>a<span class="text_exposed_hide"> <span class="text_exposed_link"><a class="see_more_link"><span class="see_more_link_inner">See more</span></a></span></span>b</p></div>`,
  );
  expect(post?.caption).toBe("ab");
});

test("entities that look like tags are decoded after tags are stripped", () => {
  const post = parsePostPage(`${SHELL}<div data-testid="post_message"><p>&lt;b&gt;x&lt;/b&gt;</p></div>`);
  expect(post?.caption).toBe("<b>x</b>");
});

test("three or more breaks collapse to a blank line", () => {
  const post = parsePostPage(`${SHELL}<div data-testid="post_message"><p>a<br><br><br><br>b</p></div>`);
  expect(post?.caption).toBe("a\n\nb");
});

test("post text comes from the post_message div", () => {
  const post = parsePostPage(
    '<img src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg" aria-label="A" role="img"><img src="https://scontent.x.fbcdn.net/v/t39.30808-6/p.jpg"><span data-testid="post_message">a</span><div data-testid="post_message">b</div>',
  );
  expect(post?.caption).toBe("b");
});

test("a post with no message still returns an empty caption", () => {
  const post = parsePostPage(SHELL);
  expect(post).not.toBeNull();
  expect(post?.caption).toBe("");
});

test("a data-aria-label does not override the author name", () => {
  const post = parsePostPage(
    '<img data-aria-label="WRONG" aria-label="Right" role="img" src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg"><img src="https://scontent.x.fbcdn.net/v/t39.30808-6/p.jpg">',
  );
  expect(post?.username).toBe("Right");
});

test("a data-role lookalike is not the author image", () => {
  const post = parsePostPage(
    '<img data-role="img" aria-label="WRONG" src="https://scontent.x.fbcdn.net/v/t39.30808-1/x.jpg"><img aria-label="Right" role="img" src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg"><img src="https://scontent.x.fbcdn.net/v/t39.30808-6/p.jpg">',
  );
  expect(post?.username).toBe("Right");
});

test("the author label is entity-decoded", () => {
  const post = parsePostPage(
    '<img aria-label="&#x66fc;&#x5831; A&amp;B" role="img" src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg"><img src="https://scontent.x.fbcdn.net/v/t39.30808-6/p.jpg">',
  );
  expect(post?.username).toBe("曼報 A&B");
});

test("fixtures carry no session token", async () => {
  const patterns = [
    /"(token|ajaxpipe_token|compat_iframe_token|async_get_token)":"[^"]+"/,
    /data-xt="[^"]+"/,
    /l\.php\?[^"]*?(?:&amp;|&)h=[^"&]+/,
  ];
  const samples = ['"async_get_token":"Adx1"', 'data-xt="AZ1"', "l.php?u=x&amp;h=AT1"];
  samples.forEach((sample, index) => {
    expect(patterns[index]?.test(sample)).toBe(true);
  });
  const dir = new URL("./fixtures/facebook/", import.meta.url);
  const names: string[] = [];
  for await (const name of new Bun.Glob("*.html").scan({ cwd: fileURLToPath(dir.href) })) names.push(name);
  expect(names.length).toBeGreaterThanOrEqual(8);
  for (const name of names) {
    const text = await Bun.file(new URL(name, dir)).text();
    for (const pattern of patterns) expect(text).not.toMatch(pattern);
  }
});

test("a cache miss loads post.php once with the pinned user agent", async () => {
  const html = await fixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetcher: Fetcher = (input, init) => {
    calls.push({ input, init });
    return Promise.resolve(new Response(html, { status: 200 }));
  };
  const post = await facebookPost(new URL(MANNY), {
    origin: "https://bl.example",
    cache: fakeCache().cache,
    fetcher,
  });
  expect(post).toEqual(parsePostPage(html));
  expect(calls).toHaveLength(1);
  expect(calls[0]?.input).toBe(MANNY_PLUGIN);
  const init = calls[0]?.init;
  expect([...(new Headers(init?.headers).keys())]).toEqual(["user-agent"]);
  expect(new Headers(init?.headers).get("user-agent")).toBe("Go-http-client/1.1");
  expect(init?.redirect).toBe("manual");
  expect(init?.signal instanceof AbortSignal).toBe(true);
});

test("a story url is loaded from its plugin page", async () => {
  const html = await fixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const calls: string[] = [];
  const fetcher: Fetcher = (input) => {
    calls.push(input);
    return Promise.resolve(new Response(html, { status: 200 }));
  };
  await facebookPost(new URL(STORY), { origin: "https://bl.example", cache: fakeCache().cache, fetcher });
  expect(calls).toEqual([STORY_PLUGIN]);
});

test("a mobile post url is passed through as the plugin href", async () => {
  const html = await fixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const calls: string[] = [];
  const fetcher: Fetcher = (input) => {
    calls.push(input);
    return Promise.resolve(new Response(html, { status: 200 }));
  };
  const canonical = new URL(
    "https://m.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol",
  );
  await facebookPost(canonical, { origin: "https://bl.example", cache: fakeCache().cache, fetcher });
  expect(calls[0]).toBe(
    "https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fm.facebook.com%2Fmannynewsletter%2Fposts%2Fpfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol",
  );
});

test("a non-200 plugin response yields no post", async () => {
  for (const status of [403, 500, 302]) {
    const fetcher: Fetcher = () =>
      Promise.resolve(
        new Response(null, {
          status,
          headers: status === 302 ? { Location: "https://www.facebook.com/login/" } : undefined,
        }),
      );
    expect(
      await facebookPost(new URL(MANNY), { origin: "https://bl.example", cache: fakeCache().cache, fetcher }),
    ).toBeNull();
  }
});

test("a failed or aborted plugin fetch yields no post", async () => {
  const rejected: Fetcher = () => Promise.reject(new TypeError("fetch failed"));
  const aborted: Fetcher = () => Promise.reject(new DOMException("aborted", "AbortError"));
  expect(
    await facebookPost(new URL(MANNY), { origin: "https://bl.example", cache: fakeCache().cache, fetcher: rejected }),
  ).toBeNull();
  expect(
    await facebookPost(new URL(MANNY), { origin: "https://bl.example", cache: fakeCache().cache, fetcher: aborted }),
  ).toBeNull();
});

test("an unavailable plugin page yields no post", async () => {
  const html = await fixture("unavailable.zh-Hant.html");
  const fetcher: Fetcher = () => Promise.resolve(new Response(html, { status: 200 }));
  expect(
    await facebookPost(new URL(MANNY), { origin: "https://bl.example", cache: fakeCache().cache, fetcher }),
  ).toBeNull();
});

test("a share link or a reel is not fetched", async () => {
  const calls: string[] = [];
  const fetcher: Fetcher = (input) => {
    calls.push(input);
    return Promise.resolve(new Response(null, { status: 200 }));
  };
  const fake = fakeCache();
  expect(
    await facebookPost(new URL("https://www.facebook.com/share/p/1Fu5ScGFUZ/"), {
      origin: "https://bl.example",
      cache: fake.cache,
      fetcher,
    }),
  ).toBeNull();
  expect(
    await facebookPost(new URL("https://www.facebook.com/reel/1016339268064528"), {
      origin: "https://bl.example",
      cache: fake.cache,
      fetcher,
    }),
  ).toBeNull();
  expect(calls).toHaveLength(0);
  expect(fake.calls.match).toBe(0);
});

test("a cache miss uses the global fetch when no fetcher is injected", async () => {
  const html = await fixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.resolve(new Response(html, { status: 200 }))) as unknown as typeof fetch,
  );
  try {
    await facebookPost(new URL(MANNY), { origin: "https://bl.example", cache: fakeCache().cache });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(MANNY_PLUGIN);
  } finally {
    spy.mockRestore();
  }
});

test("facebookPost miss-path timing (warning only, never fails)", async () => {
  for (const name of ["reel-via-post-php.zh-Hant.html", "post-1Fu5ScGFUZ.zh-Hant.html"]) {
    const html = await fixture(name);
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const fetcher: Fetcher = () => Promise.resolve(new Response(html, { status: 200 }));
      const start = performance.now();
      await facebookPost(new URL(MANNY), { origin: "https://bl.example", cache: fakeCache().cache, fetcher });
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = (samples[24] + samples[25]) / 2;
    if (median > 2) console.warn(`facebookPost miss-path median ${name} ${median} ms`);
  }
});

test("a parsed post is stored for a day", async () => {
  const html = await fixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const fake = fakeCache();
  const fetcher: Fetcher = () => Promise.resolve(new Response(html, { status: 200 }));
  const post = await facebookPost(new URL(MANNY), { origin: "https://bl.example", cache: fake.cache, fetcher });
  expect([...fake.entries.keys()]).toEqual([MANNY_KEY]);
  const stored = fake.entries.get(MANNY_KEY);
  expect(stored?.headers.get("cache-control")).toBe("max-age=86400");
  expect(stored?.headers.get("content-type")).toBe("application/json");
  if (!stored) throw new Error("missing cache entry");
  const body: unknown = await stored.json();
  expect(body).toEqual(post);
  expect(fake.calls.put).toBe(1);
});

test("a story cache key encodes the query", async () => {
  const html = await fixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const fake = fakeCache();
  const fetcher: Fetcher = () => Promise.resolve(new Response(html, { status: 200 }));
  await facebookPost(new URL(STORY), { origin: "https://bl.example", cache: fake.cache, fetcher });
  expect([...fake.entries.keys()]).toEqual([STORY_KEY]);
  expect(STORY_KEY).not.toContain("?");
});

test("a cached post is returned without contacting facebook", async () => {
  const stored = {
    username: "cached",
    caption: "",
    media: [{ kind: "image" as const, url: "https://scontent.xx.fbcdn.net/v/t39.30808-6/c.jpg?oe=1" }],
  };
  const fake = fakeCache();
  fake.entries.set(MANNY_KEY, new Response(JSON.stringify(stored)));
  const calls: string[] = [];
  const fetcher: Fetcher = (input) => {
    calls.push(input);
    return Promise.resolve(new Response(null, { status: 500 }));
  };
  const post = await facebookPost(new URL(MANNY), { origin: "https://bl.example", cache: fake.cache, fetcher });
  expect(post).toEqual(stored);
  expect(calls).toHaveLength(0);
  expect(fake.calls.put).toBe(0);
});

test("a cache hit that is not json yields no post", async () => {
  const fake = fakeCache();
  fake.entries.set(MANNY_KEY, new Response("not json"));
  const calls: string[] = [];
  const fetcher: Fetcher = (input) => {
    calls.push(input);
    return Promise.resolve(new Response(null, { status: 200 }));
  };
  expect(await facebookPost(new URL(MANNY), { origin: "https://bl.example", cache: fake.cache, fetcher })).toBeNull();
  expect(calls).toHaveLength(0);
});

test("a cache hit without media yields no post", async () => {
  const fake = fakeCache();
  fake.entries.set(MANNY_KEY, new Response(JSON.stringify({ username: "x", caption: "", media: [] })));
  const calls: string[] = [];
  const fetcher: Fetcher = (input) => {
    calls.push(input);
    return Promise.resolve(new Response(null, { status: 200 }));
  };
  expect(await facebookPost(new URL(MANNY), { origin: "https://bl.example", cache: fake.cache, fetcher })).toBeNull();
  expect(calls).toHaveLength(0);
});

test("a cache read failure yields no post", async () => {
  const fake = fakeCache();
  fake.cache.match = () => Promise.reject(new Error("cache down"));
  expect(await facebookPost(new URL(MANNY), { origin: "https://bl.example", cache: fake.cache })).toBeNull();
});

test("a cache write failure still returns the post", async () => {
  const html = await fixture("post-1Fu5ScGFUZ.zh-Hant.html");
  const fake = fakeCache();
  fake.cache.put = () => Promise.reject(new Error("413"));
  const post = await facebookPost(new URL(MANNY), {
    origin: "https://bl.example",
    cache: fake.cache,
    fetcher: () => Promise.resolve(new Response(html, { status: 200 })),
  });
  expect(post).toEqual(parsePostPage(html));
  expect(post).not.toBeNull();
});

test("an unavailable page is not cached", async () => {
  const html = await fixture("unavailable.zh-Hant.html");
  const fake = fakeCache();
  const fetcher: Fetcher = () => Promise.resolve(new Response(html, { status: 200 }));
  expect(await facebookPost(new URL(MANNY), { origin: "https://bl.example", cache: fake.cache, fetcher })).toBeNull();
  expect(fake.entries.size).toBe(0);
});
