import { expect, test } from "bun:test";
import { cleanUrl } from "../src/clean";

test("facebook reel drops every blacklisted tracking parameter", () => {
  const href = cleanUrl(
    new URL(
      "https://www.facebook.com/reel/1016339268064528?mibextid=wwXIfr&rdid=AbC&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fr%2Fx%2F&__cft__[0]=AZX&__tn__=R",
    ),
  ).href;
  expect(href).toBe("https://www.facebook.com/reel/1016339268064528");
});

test("other hosts drop the named tracking parameters and keep the rest", () => {
  expect(
    cleanUrl(
      new URL(
        "https://example.com/a?gclid=1&fbclid=2&igsh=3&igshid=4&si=5&is_from_webapp=1&sender_device=pc&id=9",
      ),
    ).href,
  ).toBe("https://example.com/a?id=9");
});

test("utm_ prefixes are removed while a name that only starts with utm is kept", () => {
  expect(
    cleanUrl(new URL("https://example.com/a?utm_source=x&utm_medium=y&utm_campaign_custom=z&utmost=1")).href,
  ).toBe("https://example.com/a?utmost=1");
});

test("blacklist names are matched case-insensitively", () => {
  expect(cleanUrl(new URL("https://example.com/a?FBCLID=1&Utm_Source=2&IGSH=3&keep=1")).href).toBe(
    "https://example.com/a?keep=1",
  );
});

test("indexed __cft__ names are removed in both raw and percent-encoded form", () => {
  expect(
    cleanUrl(
      new URL("https://www.facebook.com/story.php?story_fbid=1&id=2&__cft__[0]=A&__cft__[1]=B&__cft__%5B2%5D=C"),
    ).href,
  ).toBe("https://www.facebook.com/story.php?story_fbid=1&id=2");
});

test("surviving segments stay byte-identical", () => {
  expect(
    cleanUrl(new URL("https://example.com/a?q=a%20b&r=c~d&s=%E4%B8%AD&t=x+y&fbclid=1")).href,
  ).toBe("https://example.com/a?q=a%20b&r=c~d&s=%E4%B8%AD&t=x+y");
});

test("valueless and empty-value segments are kept", () => {
  expect(cleanUrl(new URL("https://example.com/a?flag&fbclid=1&k=")).href).toBe(
    "https://example.com/a?flag&k=",
  );
});

test("order is preserved when nothing is removed", () => {
  expect(cleanUrl(new URL("https://example.com/a?b=2&a=1")).href).toBe("https://example.com/a?b=2&a=1");
});

test("an empty query and empty segments leave no question mark", () => {
  expect(cleanUrl(new URL("https://example.com/a?")).href).toBe("https://example.com/a");
  expect(cleanUrl(new URL("https://example.com/a?x=1&&y=2")).href).toBe("https://example.com/a?x=1&y=2");
});

test("only the query changes", () => {
  expect(cleanUrl(new URL("http://example.com:8080/a/b?fbclid=1#frag")).href).toBe(
    "http://example.com:8080/a/b#frag",
  );
});

test("the input URL is not mutated", () => {
  const u = new URL("https://example.com/?fbclid=1");
  cleanUrl(u);
  expect(u.href).toBe("https://example.com/?fbclid=1");
});

test("facebook share short links are not expanded", () => {
  expect(cleanUrl(new URL("https://www.facebook.com/share/r/15abc/?mibextid=wwXIfr")).href).toBe(
    "https://www.facebook.com/share/r/15abc/",
  );
});

test("cleaning is idempotent for preserved encodings", () => {
  const once = cleanUrl(new URL("https://example.com/a?q=a%20b&r=c~d&s=%E4%B8%AD&t=x+y&fbclid=1"));
  expect(cleanUrl(once).href).toBe("https://example.com/a?q=a%20b&r=c~d&s=%E4%B8%AD&t=x+y");
});

test("a segment whose raw name starts with ? is not a blacklisted name", () => {
  expect(cleanUrl(new URL("https://example.com/a?x=1&?fbclid=2")).href).toBe(
    "https://example.com/a?x=1&?fbclid=2",
  );
});
