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
