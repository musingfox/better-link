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
