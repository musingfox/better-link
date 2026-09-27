export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);

const SHARE_PATH = /^\/share\/[^/]+/;
const HOP_CAP = 3;

function platform(hostname: string): "facebook" | "instagram" | null {
  if (FACEBOOK_HOSTS.has(hostname)) return "facebook";
  if (INSTAGRAM_HOSTS.has(hostname)) return "instagram";
  return null;
}

function isShareLink(url: URL): boolean {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    platform(url.hostname) !== null &&
    SHARE_PATH.test(url.pathname)
  );
}

// WHATWG refuses to set protocol from a non-special scheme (foo:) onto https:.
function httpsProbeUrl(url: URL): URL {
  const current = new URL(url.href);
  current.hash = "";
  current.protocol = "https:";
  if (current.protocol === "https:") return current;
  const probe = new URL("https://placeholder.invalid/");
  probe.hostname = url.hostname;
  probe.port = url.port;
  probe.pathname = url.pathname;
  probe.search = url.search;
  probe.hash = "";
  return probe;
}

function blockedDestination(pathname: string): boolean {
  return pathname.startsWith("/unsupportedbrowser") || pathname.startsWith("/accounts/login");
}

function trustedLocation(from: URL, next: URL): boolean {
  return (
    next.protocol === "https:" &&
    next.username === "" &&
    next.password === "" &&
    next.port === "" &&
    platform(next.hostname) === platform(from.hostname) &&
    !blockedDestination(next.pathname)
  );
}

export async function expandShareLink(
  url: URL,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<URL | null> {
  if (!isShareLink(url)) return url;
  let current = httpsProbeUrl(url);
  const signal = AbortSignal.timeout(5000);
  try {
    for (let hop = 0; hop < HOP_CAP; hop++) {
      const response = await fetcher(current.href, {
        method: "HEAD",
        headers: { "User-Agent": "Go-http-client/1.1" },
        redirect: "manual",
        signal,
      });
      if (response.status < 300 || response.status > 399) return null;
      const location = response.headers.get("Location");
      if (location === null) return null;
      const next = new URL(location, current);
      if (!trustedLocation(current, next)) return null;
      if (isShareLink(next)) {
        current = next;
        continue;
      }
      return next;
    }
    return null;
  } catch {
    return null;
  }
}
