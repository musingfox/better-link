import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { isFacebookPostUrl, parsePostPage } from "../src/facebook";

const MANNY =
  "https://www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";
const STORY = "https://www.facebook.com/story.php?story_fbid=1&id=2";

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
