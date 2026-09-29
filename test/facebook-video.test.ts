import { expect, test } from "bun:test";
import { isFacebookPostUrl, isFacebookVideoUrl, parseVideoPage } from "../src/facebook";

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

const AUTHOR = '<img aria-label="A" role="img" src="https://scontent.x.fbcdn.net/v/t39.30808-1/a.jpg">';
const HD = '"hd_src":"https:\\/\\/video-x.xx.fbcdn.net\\/o1\\/v\\/hd.mp4?oe=1&oh=2"';
const SD = '"sd_src":"https:\\/\\/video-x.xx.fbcdn.net\\/o1\\/v\\/sd.mp4?oe=1&oh=3"';
const DIMS = '"original_height":1080,"original_width":1920';

function P(hd = HD, sd = SD, dims = DIMS, author = AUTHOR): string {
  return `${author}<script>${hd},${sd},${dims}</script>`;
}

async function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/facebook/${name}`, import.meta.url)).text();
}

test("a video page without sources yields nothing", async () => {
  for (const name of [
    "video-unavailable.zh-Hant.html",
    "video-embed-blocked.zh-Hant.html",
    "video-empty-shell.html",
  ]) {
    expect(await parseVideoPage(await fixture(name))).toBeNull();
  }
  expect(await parseVideoPage("")).toBeNull();
});

test("hidden unavailable wording does not hide a real video", async () => {
  const html = await fixture("video-reel-1016339268064528.zh-Hant.html");
  expect(html.includes("影片無法使用")).toBe(true);
  expect(await parseVideoPage(html)).not.toBeNull();
});

test("an unterminated hd source resolves to null", async () => {
  const html = `${AUTHOR}<script>${DIMS},"hd_src":"https:\\/\\/x`;
  await expect(parseVideoPage(html)).resolves.toBeNull();
});

const REEL_HD_PREFIX =
  "https://video.xx.fbcdn.net/o1/v/t2/f2/m366/AQNNAQ5xCFdFoJwc49rZRxFFedNevtjkn0gMUD2Q2ZTbedNDHI8hsvE3jQCPoVExUIF9uQNIrWfd-is2WdzC7kFhefYs2T_GA616SIwm083nqA.mp4?";
const VIDEOS_HD_PREFIX =
  "https://video.xx.fbcdn.net/o1/v/t2/f2/m412/AQO00w7gkHtBwvAKd2SCYhroaNCqSwBQ52S2KsO2HwmohEiR_GoAwy8VIVzshQP4cIHoXexac9D3IR_1OBxPgGE.mp4?_nc_cat=101&";
const HDNULL_SD_PREFIX =
  "https://video.xx.fbcdn.net/o1/v/t2/f2/m366/AQOmk8bUQ-SM_mvihxRrCJ8gipnDbQ6HE5YmCOtqkKxD77AKrduZ64NopAxHMHUStN9GCPWlGhZLGyh4fyDTLB5lYCKlRZY0d-Iy60iK_Q.mp4?";
const VERTICAL_HD_PREFIX =
  "https://video.xx.fbcdn.net/o1/v/t2/f2/m367/AQNKFn1EUnDSuh1rgWXuZoHpjD4zgSkNk9JQjzcfZxBS8r8K6-MsIQWkJDrV1r7WneyJwjLw6Uw0JtcvuKF4FhbewLZYXYJAo_ZJCmU.mp4?";

const SD_URL = "https://video.xx.fbcdn.net/o1/v/sd.mp4?oe=1&oh=3";

test("a reel page prefers the hd mp4", async () => {
  const post = await parseVideoPage(await fixture("video-reel-1016339268064528.zh-Hant.html"));
  expect(post?.username).toBe("完全娛樂 ShowBiz");
  expect(post?.caption).toBe("");
  expect(post?.media).toHaveLength(1);
  expect(post?.media[0]?.kind).toBe("video");
  const url = post?.media[0]?.kind === "video" ? post.media[0].url : "";
  expect(url.startsWith(REEL_HD_PREFIX)).toBe(true);
  expect(url.includes("\\")).toBe(false);
  expect(url.includes("/m412/AQPlAIu9")).toBe(false);
});

test("a null hd source falls back to sd", async () => {
  const post = await parseVideoPage(await fixture("video-reel-hd-null-1000023242144087.zh-Hant.html"));
  const url = post?.media[0]?.kind === "video" ? post.media[0].url : "";
  expect(url.startsWith(HDNULL_SD_PREFIX)).toBe(true);
  expect(new URL(url).search.includes("%3D%3D")).toBe(true);
});

test("a unicode-escaped hd url is json-decoded", async () => {
  const post = await parseVideoPage(await fixture("video-videos-10153231379946729.zh-Hant.html"));
  const url = post?.media[0]?.kind === "video" ? post.media[0].url : "";
  expect(url.startsWith(VIDEOS_HD_PREFIX)).toBe(true);
  expect(url.includes("In0%3D")).toBe(true);
  expect(url.includes("\\")).toBe(false);
  expect(url.includes("u0025")).toBe(false);
});

test("a watch page yields that same hd file", async () => {
  const videos = await parseVideoPage(await fixture("video-videos-10153231379946729.zh-Hant.html"));
  const watch = await parseVideoPage(await fixture("video-watch-10153231379946729.zh-Hant.html"));
  const videosUrl = videos?.media[0]?.kind === "video" ? videos.media[0].url : "";
  const watchUrl = watch?.media[0]?.kind === "video" ? watch.media[0].url : "";
  expect(watchUrl.startsWith(VIDEOS_HD_PREFIX)).toBe(true);
  expect(watchUrl.includes("In0%3D")).toBe(true);
  expect(watchUrl.includes("\\")).toBe(false);
  expect(watchUrl.includes("u0025")).toBe(false);
  expect(new URL(watchUrl).pathname).toBe(new URL(videosUrl).pathname);
});

test("a vertical reel uses its hd source", async () => {
  const post = await parseVideoPage(await fixture("video-reel-vertical-1000004045579882.zh-Hant.html"));
  const url = post?.media[0]?.kind === "video" ? post.media[0].url : "";
  expect(url.startsWith(VERTICAL_HD_PREFIX)).toBe(true);
});

test("a synthetic page becomes one hd video post", async () => {
  expect(await parseVideoPage(P())).toEqual({
    username: "A",
    caption: "",
    media: [{ kind: "video", url: "https://video.xx.fbcdn.net/o1/v/hd.mp4?oe=1&oh=2", width: 1920, height: 1080 }],
  });
});

test("an unusable hd source falls back to sd", async () => {
  const replacements = [
    "",
    '"hd_src":null',
    '"hd_src":42',
    '"hd_src":""',
    '"hd_src":"\\q"',
    '"hd_src":"not a url"',
    '"hd_src":"data:text/plain,x"',
  ];
  for (const hd of replacements) {
    const post = await parseVideoPage(P(hd));
    const url = post?.media[0]?.kind === "video" ? post.media[0].url : "";
    expect(url).toBe(SD_URL);
  }
});

test("a credentialed hd url keeps only its path and query", async () => {
  const post = await parseVideoPage(P('"hd_src":"http:\\/\\/u:p@evil.example:8443\\/o1\\/v\\/a.mp4?x=1"'));
  const url = post?.media[0]?.kind === "video" ? post.media[0].url : "";
  expect(url).toBe("https://video.xx.fbcdn.net/o1/v/a.mp4?x=1");
});

test("missing both sources yields nothing", async () => {
  expect(await parseVideoPage(P('"hd_src":null', '"sd_src":null'))).toBeNull();
  expect(await parseVideoPage(P("", ""))).toBeNull();
});

test("a video page keeps an empty caption", async () => {
  const post = await parseVideoPage(`${P()}<div data-testid="post_message">caption</div>`);
  expect(post?.caption).toBe("");
});

test("the first author image titles the video", async () => {
  const cases: Array<[string, string]> = [
    ["video-reel-1016339268064528.zh-Hant.html", "完全娛樂 ShowBiz"],
    ["video-videos-10153231379946729.zh-Hant.html", "Facebook"],
    ["video-reel-hd-null-1000023242144087.zh-Hant.html", "Murad Al-Hajj"],
    ["video-reel-vertical-1000004045579882.zh-Hant.html", "Levi Schechtmann"],
  ];
  for (const [name, username] of cases) {
    expect((await parseVideoPage(await fixture(name)))?.username).toBe(username);
  }
});

test("an author label is entity-decoded once", async () => {
  const named = '<img aria-label="&#x66fc;&#x5831; A&amp;B" role="img">';
  const doubled = '<img aria-label="A&amp;amp;B" role="img">';
  expect((await parseVideoPage(P(HD, SD, DIMS, named)))?.username).toBe("曼報 A&B");
  expect((await parseVideoPage(P(HD, SD, DIMS, doubled)))?.username).toBe("A&amp;B");
});

test("a blank or missing author yields nothing", async () => {
  expect(await parseVideoPage(P(HD, SD, DIMS, '<img aria-label="  " role="img">'))).toBeNull();
  expect(await parseVideoPage(P(HD, SD, DIMS, '<img aria-label="A">'))).toBeNull();
});

test("comments, scripts, and data-role are not the author", async () => {
  const author =
    '<!-- <img role="img" aria-label="C"> --><script>var s=\'<img role="img" aria-label="S">\';</script><img data-role="img" aria-label="W"><img aria-label="Right" role="img">';
  expect((await parseVideoPage(P(HD, SD, DIMS, author)))?.username).toBe("Right");
});

function videoSize(post: Awaited<ReturnType<typeof parseVideoPage>>): { width: number; height: number } | null {
  const item = post?.media[0];
  if (item?.kind !== "video") return null;
  return { width: item.width, height: item.height };
}

test("original upload size is the video size", async () => {
  const cases: Array<[string, number, number]> = [
    ["video-reel-1016339268064528.zh-Hant.html", 1920, 1080],
    ["video-reel-hd-null-1000023242144087.zh-Hant.html", 720, 1280],
    ["video-reel-vertical-1000004045579882.zh-Hant.html", 1080, 1920],
  ];
  for (const [name, width, height] of cases) {
    expect(videoSize(await parseVideoPage(await fixture(name)))).toEqual({ width, height });
  }
});

test("width may be written before height", async () => {
  expect(videoSize(await parseVideoPage(P(HD, SD, '"original_width":720,"original_height":1280')))).toEqual({
    width: 720,
    height: 1280,
  });
});

test("a video element does not supply the size", async () => {
  const post = await parseVideoPage(`<video width="500" height="281"></video>${P()}`);
  expect(videoSize(post)).toEqual({ width: 1920, height: 1080 });
});

test("a missing or non-integer size yields nothing", async () => {
  for (const width of ["0", "-5", "1920.5", '"1920"', "null"]) {
    expect(await parseVideoPage(P(HD, SD, `"original_width":${width},"original_height":1080`))).toBeNull();
  }
  expect(await parseVideoPage(P(HD, SD, '"original_width":1920'))).toBeNull();
});

function medianOf(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[2] ?? Number.POSITIVE_INFINITY;
}

async function timedMedian(html: string): Promise<number> {
  await parseVideoPage(html);
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await parseVideoPage(html);
    samples.push(performance.now() - start);
  }
  return medianOf(samples);
}

test("parsing the acceptance reel stays under 10 ms", async () => {
  const median = await timedMedian(await fixture("video-reel-1016339268064528.zh-Hant.html"));
  expect(median).toBeLessThan(10);
});

test("an unterminated 200kb source stays under 10 ms", async () => {
  const html = `${AUTHOR}<script>${DIMS},"hd_src":"${"\\\\".repeat(100000)}`;
  await expect(parseVideoPage(html)).resolves.toBeNull();
  const median = await timedMedian(html);
  expect(median).toBeLessThan(10);
});
