import { expect, test } from "bun:test";
import { renderOgPage } from "../src/og";

const base = {
  title: "t",
  image: "https://bl.example/media/x",
  url: "https://www.instagram.com/p/X/",
};

function ogDescription(html: string): string {
  const match = html.match(/<meta property="og:description" content="([^"]*)">/);
  expect(match).not.toBeNull();
  return match![1];
}

test("a 250-code-point caption is the og description unchanged", () => {
  const description = "a".repeat(250);
  expect(ogDescription(renderOgPage({ ...base, description }))).toBe(description);
});

test("a 251-code-point caption is cut to 250 points plus an ellipsis", () => {
  expect(ogDescription(renderOgPage({ ...base, description: "a".repeat(251) }))).toBe(
    "a".repeat(250) + "...",
  );
});

test("truncation keeps a trailing emoji that sits on the 250th code point", () => {
  const description = "a".repeat(249) + "\u{1F64C}" + "b";
  expect(ogDescription(renderOgPage({ ...base, description }))).toBe(
    "a".repeat(249) + "\u{1F64C}" + "...",
  );
});

test("ampersands are escaped after the caption is truncated", () => {
  expect(ogDescription(renderOgPage({ ...base, description: "&".repeat(251) }))).toBe(
    "&amp;".repeat(250) + "...",
  );
});

test("an empty caption is an empty og description", () => {
  expect(renderOgPage({ ...base, description: "" })).toContain(
    '<meta property="og:description" content="">',
  );
});

function occurrences(html: string, fragment: string): number {
  return html.split(fragment).length - 1;
}

test("a post's metadata is an html preview with each og and twitter tag once", () => {
  const html = renderOgPage({
    title: "@egg",
    description: "hi",
    image: "https://bl.example/media/X/1",
    url: "https://www.instagram.com/p/X/",
  });
  const fragments = [
    "<title>@egg</title>",
    '<meta property="og:title" content="@egg">',
    '<meta property="og:description" content="hi">',
    '<meta property="og:image" content="https://bl.example/media/X/1">',
    '<meta property="og:url" content="https://www.instagram.com/p/X/">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="@egg">',
    '<meta name="twitter:image" content="https://bl.example/media/X/1">',
    '<meta http-equiv="refresh" content="0; url=https://www.instagram.com/p/X/">',
    '<a href="https://www.instagram.com/p/X/">https://www.instagram.com/p/X/</a>',
  ];
  for (const fragment of fragments) {
    expect(occurrences(html, fragment)).toBe(1);
  }
});

test("title characters that are html-significant are escaped in the title tags", () => {
  const html = renderOgPage({
    ...base,
    title: 'a&b<c>"d\'e',
    description: "hi",
  });
  expect(html).toContain('<meta property="og:title" content="a&amp;b&lt;c&gt;&quot;d&#39;e">');
  expect(html).toContain("<title>a&amp;b&lt;c&gt;&quot;d&#39;e</title>");
  expect(html).not.toContain("<c>");
});

test("a caption that looks like markup is not emitted as a script tag", () => {
  const html = renderOgPage({
    ...base,
    description: '"><script>alert(1)</script>',
  });
  expect(html).not.toContain("<script>");
});

const videoPage = {
  title: "@v",
  description: "hi",
  url: "https://www.instagram.com/p/V/",
  video: { url: "https://bl.example/media/V/1", width: 720, height: 1280 },
};

const imagePage = {
  title: "@egg",
  description: "hi",
  image: "https://bl.example/media/X/1",
  url: "https://www.instagram.com/p/X/",
};

const imagePageBeforeVideo = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>@egg</title>
<meta property="og:title" content="@egg">
<meta property="og:description" content="hi">
<meta property="og:image" content="https://bl.example/media/X/1">
<meta property="og:url" content="https://www.instagram.com/p/X/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="@egg">
<meta name="twitter:image" content="https://bl.example/media/X/1">
<meta http-equiv="refresh" content="0; url=https://www.instagram.com/p/X/">
</head>
<body>
<a href="https://www.instagram.com/p/X/">https://www.instagram.com/p/X/</a>
</body>
</html>
`;

test("a video preview lists each player tag once", () => {
  const html = renderOgPage(videoPage);
  const fragments = [
    '<meta property="og:video" content="https://bl.example/media/V/1">',
    '<meta property="og:video:secure_url" content="https://bl.example/media/V/1">',
    '<meta property="og:video:type" content="video/mp4">',
    '<meta property="og:video:width" content="720">',
    '<meta property="og:video:height" content="1280">',
    '<meta name="twitter:card" content="player">',
    '<meta name="twitter:player:width" content="720">',
    '<meta name="twitter:player:height" content="1280">',
    '<meta name="twitter:player:stream" content="https://bl.example/media/V/1">',
    '<meta name="twitter:player:stream:content_type" content="video/mp4">',
    "<title>@v</title>",
    '<meta property="og:title" content="@v">',
    '<meta property="og:description" content="hi">',
    '<meta property="og:url" content="https://www.instagram.com/p/V/">',
    '<meta name="twitter:title" content="@v">',
    '<meta http-equiv="refresh" content="0; url=https://www.instagram.com/p/V/">',
    '<a href="https://www.instagram.com/p/V/">https://www.instagram.com/p/V/</a>',
  ];
  for (const fragment of fragments) {
    expect(occurrences(html, fragment)).toBe(1);
  }
});

test("a video preview omits image cards", () => {
  const html = renderOgPage(videoPage);
  expect(html).not.toContain("og:image");
  expect(html).not.toContain("twitter:image");
  expect(html).not.toContain("summary_large_image");
});

test("an image preview keeps each existing tag once and omits video tags", () => {
  const html = renderOgPage(imagePage);
  const fragments = [
    "<title>@egg</title>",
    '<meta property="og:title" content="@egg">',
    '<meta property="og:description" content="hi">',
    '<meta property="og:image" content="https://bl.example/media/X/1">',
    '<meta property="og:url" content="https://www.instagram.com/p/X/">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="@egg">',
    '<meta name="twitter:image" content="https://bl.example/media/X/1">',
    '<meta http-equiv="refresh" content="0; url=https://www.instagram.com/p/X/">',
    '<a href="https://www.instagram.com/p/X/">https://www.instagram.com/p/X/</a>',
  ];
  for (const fragment of fragments) {
    expect(occurrences(html, fragment)).toBe(1);
  }
  expect(html).not.toContain("og:video");
  expect(html).not.toContain("twitter:player");
});

test("ampersands in a video url are escaped in og:video", () => {
  const html = renderOgPage({
    ...videoPage,
    video: { url: "https://bl.example/media/V/1?a=1&b=2", width: 720, height: 1280 },
  });
  expect(html).toContain(
    '<meta property="og:video" content="https://bl.example/media/V/1?a=1&amp;b=2">',
  );
});

test("an image preview is byte-identical to the page captured before video tags", () => {
  expect(renderOgPage(imagePage)).toBe(imagePageBeforeVideo);
});
