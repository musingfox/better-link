const FIX_SERVICE_BY_HOST = new Map<string, string>([
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
]);

export function fixServiceUrl(url: URL): URL | null {
  const service = FIX_SERVICE_BY_HOST.get(url.hostname);
  if (service === undefined) return null;
  return new URL(`https://${service}${url.pathname}${url.search}`);
}
