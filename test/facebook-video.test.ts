import { expect, test } from "bun:test";
import { isFacebookPostUrl, isFacebookVideoUrl } from "../src/facebook";

const MANNY =
  "https://www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol";

const VIDEO_TRUE = [
  "https://www.facebook.com/reel/1016339268064528",
  "https://www.facebook.com/reel/1016339268064528/",
  "https://m.facebook.com/reel/1016339268064528",
  "https://facebook.com/reel/1016339268064528",
  "https://www.facebook.com/reel/1016339268064528?s=ifu&fs=e",
  "https://www.facebook.com/facebook/videos/10153231379946729/",
  "https://www.facebook.com/facebook/videos/a-slug/10153231379946729/",
  "https://www.facebook.com/watch/?v=10153231379946729",
  "https://www.facebook.com/watch?v=10153231379946729",
];

const VIDEO_FALSE_PATHS = [
  "/reel/abc",
  "/reel/",
  "/reel/1/extra",
  "/watch/",
  "/watch/?v=",
  "/watch/?x=1",
  "/video.php?v=1",
  "/share/v/1HSGH1rf7o/",
  "/share/r/abc/",
  "/facebook/videos/",
  "/facebook/videos/abc/",
  "/a/b/videos/1",
  "/mannynewsletter/posts/1/",
];

test("reel, page video, and watch links on facebook hosts are videos", () => {
  for (const href of VIDEO_TRUE) expect(isFacebookVideoUrl(new URL(href))).toBe(true);
});

test("other facebook paths are not videos", () => {
  for (const path of VIDEO_FALSE_PATHS) {
    expect(isFacebookVideoUrl(new URL(`https://www.facebook.com${path}`))).toBe(false);
  }
});

test("links outside the three facebook hosts are not videos", () => {
  for (const href of [
    "https://fb.watch/abc/",
    "https://l.facebook.com/reel/1",
    "https://www.facebook.com.evil.example/reel/1",
    "https://www.instagram.com/reel/DJvkjAlvNc8/",
  ]) {
    expect(isFacebookVideoUrl(new URL(href))).toBe(false);
  }
});

test("a url is never both a facebook post and a facebook video", () => {
  const posts = [
    MANNY,
    "https://www.facebook.com/story.php?story_fbid=1&id=2",
    "https://www.facebook.com/permalink.php?story_fbid=1&id=2",
    "https://www.facebook.com/photo.php?fbid=1",
    "https://m.facebook.com/photo/?fbid=1",
  ];
  const samples = [
    ...VIDEO_TRUE,
    ...VIDEO_FALSE_PATHS.map((path) => `https://www.facebook.com${path}`),
    ...posts,
  ];
  for (const href of samples) {
    const url = new URL(href);
    expect(isFacebookPostUrl(url) && isFacebookVideoUrl(url)).toBe(false);
  }
  for (const href of VIDEO_TRUE) expect(isFacebookPostUrl(new URL(href))).toBe(false);
});
