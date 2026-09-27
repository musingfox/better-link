const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

const INSTAGRAM_PARAMS = new Set(["img_index"]);
const YOUTUBE_PARAMS = new Set(["v", "t", "list", "index"]);

const BLOCKED_NAMES = new Set([
  "fbclid",
  "gclid",
  "igsh",
  "igshid",
  "mibextid",
  "si",
  "rdid",
  "share_url",
  "__cft__",
  "__tn__",
  "is_from_webapp",
  "sender_device",
]);

function segmentName(segment: string): string {
  // URLSearchParams drops one leading "?", which is not form-decoding.
  const decoded = new URLSearchParams(`_${segment}`).keys().next().value ?? "_";
  return decoded.slice(1);
}

function blocked(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || BLOCKED_NAMES.has(lower) || /^__cft__\[\d+\]$/.test(lower);
}

function keepSegment(hostname: string, name: string): boolean {
  if (INSTAGRAM_HOSTS.has(hostname)) return INSTAGRAM_PARAMS.has(name);
  if (YOUTUBE_HOSTS.has(hostname)) return YOUTUBE_PARAMS.has(name);
  return !blocked(name);
}

export function cleanUrl(input: URL): URL {
  const out = new URL(input.href);
  const raw = input.search.startsWith("?") ? input.search.slice(1) : input.search;
  const survivors = raw.split("&").filter((segment) => {
    if (segment.length === 0) return false;
    return keepSegment(input.hostname, segmentName(segment));
  });
  out.search = survivors.length === 0 ? "" : `?${survivors.join("&")}`;
  return out;
}
