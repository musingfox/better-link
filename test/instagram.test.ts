import { expect, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Fetcher } from "../src/expand";
import { instagramPost, parseEmbed } from "../src/instagram";
import { fakeCache } from "./support/fake-cache";

const EGG_MEDIA =
  "https://scontent.cdninstagram.com/v/t51.82787-15/625727639_18338153224242257_3827527793310630488_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=104&ig_cache_key=MTk0OTUyNTI3ODI4MTU1NDE3NA%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuNTg0LnNkci5yZWd1bGFyX3Bob3RvLkMzIn0%3D&_nc_ohc=YFKQ7apkKBgQ7kNvwFPu0Kb&_nc_oc=AdpCt06dwZzFQWP2kuK7UAFMK0HuszeeTFaClp9t3JPyJWmjm73K0jYkykuO01tHcww&_nc_zt=23&_nc_ht=scontent-tpe5-1.cdninstagram.com&_nc_gid=xwo3Asg41MB0RjldQ8lgQA&_nc_ss=7360f&oh=00_AQO3J7DVx6YxxYqCZcy3W0xiufLg5WnZQJeoc7uz04uViQ&oe=6ABFE180";

const EGG_CAPTION =
  "Let’s set a world record together and get the most liked post on Instagram. Beating the current world record held by Kylie Jenner (18 million)! We got this 🙌\n\n#LikeTheEgg #EggSoldiers #EggGang";

const EGG_POST = {
  username: "world_record_egg",
  caption: EGG_CAPTION,
  media: [{ kind: "image" as const, url: EGG_MEDIA }],
};

const SESSION_TOKEN = /"(csrf_token|token|ajaxpipe_token|compat_iframe_token)":"[^"]+"/;
const CSRF_COOKIE = /\["csrftoken","[^"]+"/;

function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/instagram/${name}`, import.meta.url)).text();
}

test("a single-image embed yields the account and the cdninstagram image", async () => {
  expect(parseEmbed(await fixture("embed-BsOGulcndj-.html"))).toEqual(EGG_POST);
});

test("an image source cannot leak its scheme, userinfo, or port into the media url", () => {
  const page = (src: string) =>
    `<div data-media-type="GraphImage"><span class="UsernameText">u</span><img class="EmbeddedMediaImage" alt="x" src="${src}"></div>`;
  expect(parseEmbed(page("data:image/gif;base64,R0lGODlhAQABAAAAACw="))).toBeNull();
  expect(parseEmbed(page("javascript:alert(1)"))).toBeNull();
  expect(parseEmbed(page("https://user:pw@evil.example:8443/x.jpg"))).toEqual({
    username: "u",
    caption: "",
    media: [{ kind: "image", url: "https://scontent.cdninstagram.com/x.jpg" }],
  });
});

test("a graph image ignores an unreadable contextJSON", () => {
  const page =
    '<div data-media-type="GraphImage"><span class="UsernameText">u</span><img class="EmbeddedMediaImage" src="https://scontent-xyz.cdninstagram.com/v/p.jpg"></div><script>{"contextJSON":"{not json"}</script>';
  expect(parseEmbed(page)?.media).toEqual([
    { kind: "image", url: "https://scontent.cdninstagram.com/v/p.jpg" },
  ]);
});

test("a minimal GraphImage embed keeps the image query and an empty caption", () => {
  const post = parseEmbed(
    '<div data-media-type="GraphImage"><span class="UsernameText">a_b</span><img class="EmbeddedMediaImage" alt="x" src="https://scontent-xyz.cdninstagram.com/v/p.jpg?a=1&amp;oe=ABC" srcset="https://other.example/s.jpg 640w"></div>',
  );
  expect(post).toEqual({
    username: "a_b",
    caption: "",
    media: [{ kind: "image", url: "https://scontent.cdninstagram.com/v/p.jpg?a=1&oe=ABC" }],
  });
});

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

test("a carousel embed yields each child in order", async () => {
  const post = parseEmbed(await fixture("embed-DOBXTYNklfi.html"));
  expect(post?.username).toBe("legday");
  expect(post?.media).toHaveLength(2);
  expect(post?.media.map((item) => item.kind)).toEqual(["image", "image"]);
  const first = post?.media[0];
  const second = post?.media[1];
  if (first?.kind !== "image" || second?.kind !== "image") throw new Error("expected images");
  expect(new URL(first.url).pathname).toBe(
    "/v/t51.82787-15/539843179_18060504932366724_8700303266403112197_n.jpg",
  );
  expect(new URL(second.url).pathname).toBe(
    "/v/t51.82787-15/539561490_18060504941366724_6446626545327929916_n.jpg",
  );
  expect(new URL(first.url).host).toBe("scontent.cdninstagram.com");
  expect(new URL(second.url).host).toBe("scontent.cdninstagram.com");
});

test("a mixed carousel keeps the image and rebuilds the video host", async () => {
  const post = parseEmbed(await fixture("embed-DduKfFmDxsG.html"));
  expect(post?.username).toBe("instagram");
  expect(post?.media.map((item) => item.kind)).toEqual(["image", "video"]);
  const video = post?.media[1];
  if (video?.kind !== "video") throw new Error("expected a video");
  expect(video.url.startsWith(
    "https://scontent.cdninstagram.com/o1/v/t16/f2/m84/AQOVXzr0ykV580NCImfvRx1RoBVqKhe7fDqAMNeWRJ_NDDFzJEypa2QKsDO-a-8ptTFUpQHIwIlGiVOwSMNXE3oWJcZkl0Utz8smggE.mp4?",
  )).toBe(true);
  expect(video.width).toBe(720);
  expect(video.height).toBe(900);
});

test("a video embed yields the playable mp4 on the cdninstagram host", async () => {
  const post = parseEmbed(await fixture("embed-DJvkjAlvNc8.html"));
  expect(post?.username).toBe("vatsalya_therapy");
  expect(post?.media).toHaveLength(1);
  const item = post?.media[0];
  if (item?.kind !== "video") throw new Error("expected a video");
  expect(item.width).toBe(720);
  expect(item.height).toBe(1280);
  expect(item.url.startsWith(
    "https://scontent.cdninstagram.com/o1/v/t2/f2/m367/AQOgx5mbS2I8BPywB5cH4FVx-87QdiLP1zNs6L4p27pATA6tpTJF-IFswalL60VtuI0ml5MNBJ0JdzYONRnOwiXgH6bmFAhkcGaHEpA.mp4?",
  )).toBe(true);
  expect(item.url).toContain("oe=");
  expect(item.url).not.toContain("\\");
  expect(item.url).not.toContain("\\u0025");
  expect(item.url).not.toContain("&amp;");
  expect(post?.caption.length).toBeGreaterThan(0);
});

function richPage(type: string, node: unknown): string {
  const context = {
    context: { copyright_blocked: false },
    gql_data: { shortcode_media: node },
  };
  const literal = JSON.stringify(JSON.stringify(context));
  return `<div data-media-type="${type}"><span class="UsernameText">u</span><script>{"contextJSON":${literal}}</script></div>`;
}

test("a copyright-blocked video embed yields no post", async () => {
  expect(parseEmbed(await fixture("embed-Dd0M_ifNfXO.html"))).toBeNull();
});

test("a watch-on-instagram marker on a playable video yields no post", async () => {
  const html = (await fixture("embed-DJvkjAlvNc8.html")).replace(
    '<span class="UsernameText">vatsalya_therapy</span>',
    '<span class="UsernameText">vatsalya_therapy</span><span class="WatchOnInstagram">Watch on Instagram</span>',
  );
  expect(parseEmbed(html)).toBeNull();
});

test("a video whose context is copyright blocked yields no post", async () => {
  const html = (await fixture("embed-DJvkjAlvNc8.html")).replaceAll(
    '\\"copyright_blocked\\":false',
    '\\"copyright_blocked\\":true',
  );
  expect(parseEmbed(html)).toBeNull();
});

test("a video without a video url yields no post", async () => {
  const html = (await fixture("embed-DJvkjAlvNc8.html")).replaceAll('\\"video_url\\"', '\\"video_urx\\"');
  expect(parseEmbed(html)).toBeNull();
});

test("a carousel with one unplayable video yields no post", async () => {
  const html = (await fixture("embed-DduKfFmDxsG.html")).replaceAll('\\"video_url\\"', '\\"video_urx\\"');
  expect(parseEmbed(html)).toBeNull();
});

test("a video url is rebuilt without userinfo, port, or the original host", () => {
  const post = parseEmbed(
    richPage("GraphVideo", {
      is_video: true,
      video_url: "https://user:pw@evil.example:8443/v.mp4?x=1&y=2",
      dimensions: { width: 720, height: 1280 },
    }),
  );
  expect(post).toEqual({
    username: "u",
    caption: "",
    media: [
      {
        kind: "video",
        url: "https://scontent.cdninstagram.com/v.mp4?x=1&y=2",
        width: 720,
        height: 1280,
      },
    ],
  });
});

test("a graph video without an is_video flag still uses video_url", () => {
  const post = parseEmbed(
    richPage("GraphVideo", {
      video_url: "https://scontent.cdninstagram.com/v.mp4",
      dimensions: { width: 720, height: 1280 },
      display_url: "https://scontent.cdninstagram.com/c.jpg",
    }),
  );
  expect(post?.media).toEqual([
    {
      kind: "video",
      url: "https://scontent.cdninstagram.com/v.mp4",
      width: 720,
      height: 1280,
    },
  ]);
});

test("a graph video without a video url yields no post even when a display image exists", () => {
  expect(
    parseEmbed(
      richPage("GraphVideo", {
        display_url: "https://scontent.cdninstagram.com/c.jpg",
      }),
    ),
  ).toBeNull();
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
  expect(post).toEqual(EGG_POST);
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
    media: [{ kind: "image" as const, url: "https://scontent.cdninstagram.com/v/c.jpg?oe=1" }],
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

test("a cached body that is not a post yields no post and does not fetch", async () => {
  const bodies: unknown[] = [
    {},
    { username: 1, caption: "", mediaUrl: "https://scontent.cdninstagram.com/v/c.jpg" },
    { username: "u", caption: null, mediaUrl: "https://scontent.cdninstagram.com/v/c.jpg" },
    { username: "u", caption: "", mediaUrl: 1 },
    { caption: "", mediaUrl: "https://scontent.cdninstagram.com/v/c.jpg" },
    { username: "u", mediaUrl: "https://scontent.cdninstagram.com/v/c.jpg" },
    { username: "u", caption: "" },
  ];
  for (const body of bodies) {
    const fake = fakeCache();
    fake.entries.set(
      "https://bl.example/__cache/instagram/BsOGulcndj-",
      new Response(JSON.stringify(body)),
    );
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
    expect(fake.calls.put).toBe(0);
  }
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

test("a fetched post is stored for 24 hours under the origin cache key", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const fake = fakeCache();
  const { fetcher, calls } = countingFetcher(
    new Response(html, {
      status: 200,
      headers: { "Cache-Control": "private, no-cache, no-store, must-revalidate" },
    }),
  );
  const post = await instagramPost("BsOGulcndj-", {
    origin: "https://bl.example",
    cache: fake.cache,
    fetcher,
  });
  const key = "https://bl.example/__cache/instagram/BsOGulcndj-";
  expect([...fake.entries.keys()]).toEqual([key]);
  const entry = fake.entries.get(key);
  if (!entry) throw new Error("missing cache entry");
  expect(entry.headers.get("cache-control")).toBe("max-age=86400");
  const body: unknown = await entry.json();
  expect(body).toEqual(post);
  expect(calls).toHaveLength(1);
  expect(fake.calls.match).toBe(1);
  expect(fake.calls.put).toBe(1);
});

test("a refused embed is not cached", async () => {
  const fake = fakeCache();
  const { fetcher } = countingFetcher(new Response(null, { status: 403 }));
  expect(
    await instagramPost("BsOGulcndj-", { origin: "https://bl.example", cache: fake.cache, fetcher }),
  ).toBeNull();
  expect(fake.entries.size).toBe(0);
  expect(fake.calls.put).toBe(0);
});

test("a cache write failure still returns the post", async () => {
  const html = await fixture("embed-BsOGulcndj-.html");
  const fake = fakeCache();
  fake.cache.put = () => Promise.reject(new Error("413"));
  const post = await instagramPost("BsOGulcndj-", {
    origin: "https://bl.example",
    cache: fake.cache,
    fetcher: () => Promise.resolve(new Response(html, { status: 200 })),
  });
  expect(post).toEqual(EGG_POST);
});

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

test("a video page without contextJSON yields no post", () => {
  expect(
    parseEmbed('<div data-media-type="GraphVideo"><span class="UsernameText">u</span></div>'),
  ).toBeNull();
});

test("a video page with a null contextJSON yields no post", () => {
  expect(
    parseEmbed(
      '<div data-media-type="GraphVideo"><span class="UsernameText">u</span><script>{"contextJSON":null}</script></div>',
    ),
  ).toBeNull();
});

test("a video page with a non-json contextJSON yields no post", () => {
  expect(
    parseEmbed(
      '<div data-media-type="GraphVideo"><span class="UsernameText">u</span><script>{"contextJSON":"{not json"}</script></div>',
    ),
  ).toBeNull();
});

test("a video url that is not an http path yields no post", () => {
  expect(
    parseEmbed(
      richPage("GraphVideo", {
        is_video: true,
        video_url: "javascript:alert(1)",
        dimensions: { width: 720, height: 1280 },
      }),
    ),
  ).toBeNull();
});

test("a carousel whose only image is not an http path yields no post", () => {
  expect(
    parseEmbed(
      richPage("GraphSidecar", {
        edge_sidecar_to_children: {
          edges: [
            {
              node: {
                is_video: false,
                display_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
              },
            },
          ],
        },
      }),
    ),
  ).toBeNull();
});

test("a carousel with no children yields no post", () => {
  expect(
    parseEmbed(
      richPage("GraphSidecar", {
        edge_sidecar_to_children: { edges: [] },
      }),
    ),
  ).toBeNull();
});

test("a video without dimensions yields no post", () => {
  expect(
    parseEmbed(
      richPage("GraphVideo", {
        is_video: true,
        video_url: "https://scontent.cdninstagram.com/v.mp4",
      }),
    ),
  ).toBeNull();
});

test("an unknown media type yields no post", () => {
  expect(
    parseEmbed(
      richPage("GraphReel", {
        is_video: true,
        video_url: "https://scontent.cdninstagram.com/v.mp4",
        dimensions: { width: 720, height: 1280 },
      }),
    ),
  ).toBeNull();
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
