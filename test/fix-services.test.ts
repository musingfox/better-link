import { expect, test } from "bun:test";
import { fixServiceUrl } from "../src/fix-services";

const HOSTS: Array<[host: string, service: string]> = [
  ["x.com", "fixupx.com"],
  ["www.x.com", "fixupx.com"],
  ["mobile.x.com", "fixupx.com"],
  ["twitter.com", "fixupx.com"],
  ["www.twitter.com", "fixupx.com"],
  ["mobile.twitter.com", "fixupx.com"],
  ["m.twitter.com", "fixupx.com"],
  ["tiktok.com", "tnktok.com"],
  ["www.tiktok.com", "tnktok.com"],
  ["m.tiktok.com", "tnktok.com"],
  ["vm.tiktok.com", "tnktok.com"],
  ["vt.tiktok.com", "tnktok.com"],
  ["bsky.app", "bskx.app"],
  ["reddit.com", "vxreddit.com"],
  ["www.reddit.com", "vxreddit.com"],
  ["old.reddit.com", "vxreddit.com"],
  ["new.reddit.com", "vxreddit.com"],
  ["m.reddit.com", "vxreddit.com"],
  ["np.reddit.com", "vxreddit.com"],
  ["sh.reddit.com", "vxreddit.com"],
  ["redd.it", "vxreddit.com"],
  ["pixiv.net", "phixiv.net"],
  ["www.pixiv.net", "phixiv.net"],
  ["touch.pixiv.net", "phixiv.net"],
  ["threads.net", "fixthreads.seria.moe"],
  ["www.threads.net", "fixthreads.seria.moe"],
  ["threads.com", "fixthreads.seria.moe"],
  ["www.threads.com", "fixthreads.seria.moe"],
];

for (const [host, service] of HOSTS) {
  test(`${host} keeps path and query on ${service}`, () => {
    const input = new URL(`https://${host}/p/1?q=2`);
    expect(fixServiceUrl(input)?.href).toBe(`https://${service}/p/1?q=2`);
  });
}

test("a twitter status keeps its path and query", () => {
  expect(fixServiceUrl(new URL("https://twitter.com/jack/status/20?s=20"))?.href).toBe(
    "https://fixupx.com/jack/status/20?s=20",
  );
});

test("a tiktok short link keeps its trailing slash", () => {
  expect(fixServiceUrl(new URL("https://vm.tiktok.com/ZMabc123/"))?.href).toBe(
    "https://tnktok.com/ZMabc123/",
  );
});

test("a pixiv illustration keeps its query byte for byte", () => {
  expect(
    fixServiceUrl(
      new URL("https://www.pixiv.net/member_illust.php?mode=medium&illust_id=150105774"),
    )?.href,
  ).toBe("https://phixiv.net/member_illust.php?mode=medium&illust_id=150105774");
});

test("percent-encoded path segments stay encoded", () => {
  expect(fixServiceUrl(new URL("https://x.com/a%2Fb/%E4%B8%AD"))?.href).toBe(
    "https://fixupx.com/a%2Fb/%E4%B8%AD",
  );
});

test("a path that starts with a double slash stays on the fix service", () => {
  expect(fixServiceUrl(new URL("https://x.com//evil.example/a"))?.href).toBe(
    "https://fixupx.com//evil.example/a",
  );
});

test("a bare origin keeps the root path", () => {
  expect(fixServiceUrl(new URL("https://x.com/"))?.href).toBe("https://fixupx.com/");
});

test("the input URL is not mutated", () => {
  const u = new URL("https://x.com/a?b=1");
  fixServiceUrl(u);
  expect(u.href).toBe("https://x.com/a?b=1");
});
