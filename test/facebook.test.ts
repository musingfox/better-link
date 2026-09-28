import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { isFacebookPostUrl } from "../src/facebook";

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
