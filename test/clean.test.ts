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

test("instagram keeps only img_index", () => {
  expect(
    cleanUrl(new URL("https://www.instagram.com/p/ABC123/?img_index=2&igsh=MXh5")).href,
  ).toBe("https://www.instagram.com/p/ABC123/?img_index=2");
});

test("instagram host matching is case-insensitive and drops every non-functional parameter", () => {
  expect(
    cleanUrl(new URL("https://WWW.Instagram.COM/reel/XYZ/?igsh=abc&utm_source=ig_web_copy_link")).href,
  ).toBe("https://www.instagram.com/reel/XYZ/");
});

test("youtube keeps v and t", () => {
  expect(
    cleanUrl(new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&si=abc&feature=share")).href,
  ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42");
});

test("youtu.be keeps t", () => {
  expect(cleanUrl(new URL("https://youtu.be/dQw4w9WgXcQ?si=abc&t=42")).href).toBe(
    "https://youtu.be/dQw4w9WgXcQ?t=42",
  );
});

test("mobile youtube keeps v, list, and index", () => {
  expect(cleanUrl(new URL("https://m.youtube.com/watch?v=abc&list=PL123&index=3&pp=xyz")).href).toBe(
    "https://m.youtube.com/watch?v=abc&list=PL123&index=3",
  );
});

test("music.youtube.com keeps v", () => {
  expect(cleanUrl(new URL("https://music.youtube.com/watch?v=abc&si=zz")).href).toBe(
    "https://music.youtube.com/watch?v=abc",
  );
});

test("youtube whitelist names are case-sensitive", () => {
  expect(cleanUrl(new URL("https://youtube.com/watch?V=abc&v=def")).href).toBe(
    "https://youtube.com/watch?v=def",
  );
});

test("a spoofed instagram host is not whitelisted", () => {
  expect(cleanUrl(new URL("https://instagram.com.evil.example/p/1?img_index=1&foo=2&igsh=3")).href).toBe(
    "https://instagram.com.evil.example/p/1?img_index=1&foo=2",
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

test("a segment whose raw name starts with ? is not a youtube whitelist name", () => {
  expect(cleanUrl(new URL("https://www.youtube.com/watch?x=1&?v=abc")).href).toBe(
    "https://www.youtube.com/watch",
  );
});

test("mobile facebook leftovers refsrc and _rdr are removed with the other tracking parameters", () => {
  expect(
    cleanUrl(
      new URL(
        "https://m.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol?rdid=JoOqIJIyWQqLPTAT&share_url=https%3A%2F%2Fm.facebook.com%2Fshare%2Fp%2F1Fu5ScGFUZ%2F&refsrc=deprecated&_rdr",
      ),
    ).href,
  ).toBe(
    "https://m.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol",
  );
});

test("refsrc and a valueless _rdr are dropped while other segments stay", () => {
  expect(cleanUrl(new URL("https://example.com/a?refsrc=x&_rdr&keep=1")).href).toBe(
    "https://example.com/a?keep=1",
  );
});

test("refsrc and _rdr are matched case-insensitively", () => {
  expect(cleanUrl(new URL("https://example.com/a?REFSRC=x&_RDR=1&keep=1")).href).toBe(
    "https://example.com/a?keep=1",
  );
});

test("names that only extend refsrc or _rdr are kept", () => {
  expect(cleanUrl(new URL("https://example.com/a?refsrcs=1&_rdrx=2")).href).toBe(
    "https://example.com/a?refsrcs=1&_rdrx=2",
  );
});

test("x and twitter drop the share parameters s and t", () => {
  expect(cleanUrl(new URL("https://x.com/jack/status/20?s=46&t=AbCdEf123")).href).toBe("https://x.com/jack/status/20");
  expect(cleanUrl(new URL("https://mobile.twitter.com/jack/status/20?S=09&keep=1")).href).toBe(
    "https://mobile.twitter.com/jack/status/20?keep=1",
  );
});

test("s and t are kept on hosts other than x and twitter", () => {
  expect(cleanUrl(new URL("https://example.com/?s=term&t=1")).href).toBe("https://example.com/?s=term&t=1");
  expect(cleanUrl(new URL("https://fixupx.com/jack/status/20?s=46")).href).toBe("https://fixupx.com/jack/status/20?s=46");
});
