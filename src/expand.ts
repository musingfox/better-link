import { INSTAGRAM_HOSTS } from "./clean";

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]);

const SHARE_PATH = /^\/share\/[^/]+/;
const HOP_CAP = 3;

export function isShareable(url: URL): boolean {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.hostname.includes(".")
  );
}

function platform(hostname: string): "facebook" | "instagram" | null {
  if (FACEBOOK_HOSTS.has(hostname)) return "facebook";
  if (INSTAGRAM_HOSTS.has(hostname)) return "instagram";
  return null;
}

function isShareLink(url: URL): boolean {
  // Probes accept an explicit port and then drop it. isShareable rejects ports,
  // matching the conversion check, so clear the port only for this predicate.
  const candidate = url.port === "" ? url : new URL(url.href);
  if (candidate !== url) candidate.port = "";
  return isShareable(candidate) && platform(url.hostname) !== null && SHARE_PATH.test(url.pathname);
}

function probe(t: URL): URL {
  return new URL(`https://${t.hostname}${t.pathname}${t.search}`);
}

function blockedDestination(pathname: string): boolean {
  return pathname.startsWith("/unsupportedbrowser") || pathname.startsWith("/accounts/login");
}

function trustedLocation(from: URL, next: URL): boolean {
  return (
    isShareable(next) &&
    next.protocol === "https:" &&
    platform(next.hostname) === platform(from.hostname) &&
    !blockedDestination(next.pathname)
  );
}

export async function expandShareLink(
  url: URL,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<URL | null> {
  if (!isShareLink(url)) return url;
  let current = probe(url);
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
      if (!location) return null;
      const next = new URL(location, current);
      if (!trustedLocation(current, next)) return null;
      if (isShareLink(next)) {
        current = probe(next);
        continue;
      }
      return next;
    }
    return null;
  } catch {
    return null;
  }
}
