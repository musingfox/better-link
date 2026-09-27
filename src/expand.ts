export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);

const SHARE_PATH = /^\/share\/[^/]+/;

function platform(hostname: string): "facebook" | "instagram" | null {
  if (FACEBOOK_HOSTS.has(hostname)) return "facebook";
  if (INSTAGRAM_HOSTS.has(hostname)) return "instagram";
  return null;
}

function isShareLink(url: URL): boolean {
  return platform(url.hostname) !== null && SHARE_PATH.test(url.pathname);
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
  const current = new URL(url.href);
  current.protocol = "https:";
  current.hash = "";
  try {
    const response = await fetcher(current.href, {
      method: "HEAD",
      headers: { "User-Agent": "Go-http-client/1.1" },
      redirect: "manual",
    });
    if (response.status < 300 || response.status > 399) return null;
    const location = response.headers.get("Location");
    if (location === null) return null;
    const next = new URL(location, current);
    if (!trustedLocation(current, next)) return null;
    return next;
  } catch {
    return null;
  }
}
