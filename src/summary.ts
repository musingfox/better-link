import { INSTAGRAM_HOSTS, THREADS_HOSTS, X_HOSTS, YOUTUBE_HOSTS } from "./clean";
import type { Fetcher } from "./expand";
import { facebookPost, facebookVideo, isFacebookVideoUrl } from "./facebook";
import { fixServiceUrl } from "./fix-services";
import { decodeEntities, instagramPost, instagramShortcode, type PostCache } from "./instagram";

export type Summary = { author: string; text: string };

type Deps = { origin: string; cache: PostCache; fetcher?: Fetcher };

const TIMEOUT_MS = 5_000;
// og tags sit near the top; Threads put them at about 2 KB of a 544 KB page (2026-10-16).
const HEAD_LIMIT_BYTES = 65_536;
const CRAWLER_UA = "facebookexternalhit/1.1";
const BLUESKY_HOSTS = new Set(["bsky.app"]);
const BLUESKY_POST = /^\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)\/?$/;
const X_TEXT = /<p[^>]*>([\s\S]*?)<\/p>/;

function get(url: string, deps: Deps, headers: Record<string, string> = {}): Promise<Response> {
  const fetcher = deps.fetcher ?? ((input, init) => fetch(input, init));
  return fetcher(url, { headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function json(url: string, deps: Deps): Promise<unknown> {
  const response = await get(url, deps);
  if (!response.ok) return null;
  return response.json();
}

function field(value: unknown, ...path: (string | number)[]): string {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return "";
    current = (current as Record<string | number, unknown>)[key];
  }
  return typeof current === "string" ? current.trim() : "";
}

function summary(author: string, text: string): Summary | null {
  return author === "" && text === "" ? null : { author, text };
}

export async function readHead(response: Response, limit = HEAD_LIMIT_BYTES): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  while (bytes < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    html += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return html;
}

export function ogContent(html: string, property: string): string {
  const at = html.indexOf(`property="${property}"`);
  if (at === -1) return "";
  const tagStart = html.lastIndexOf("<meta", at);
  const contentAt = html.indexOf('content="', tagStart);
  if (tagStart === -1 || contentAt === -1 || html.lastIndexOf("<meta", contentAt) !== tagStart) return "";
  const start = contentAt + 'content="'.length;
  const end = html.indexOf('"', start);
  return end === -1 ? "" : decodeEntities(html.slice(start, end)).trim();
}

export function ogSummary(html: string, siteNameIsAuthor: boolean): Summary | null {
  const title = ogContent(html, "og:title");
  const description = ogContent(html, "og:description");
  const author = siteNameIsAuthor ? ogContent(html, "og:site_name") : "";
  return summary(author, [title, description].filter((part) => part !== "").join("\n"));
}

async function og(url: string, deps: Deps, siteNameIsAuthor: boolean, userAgent = "Discordbot/2.0"): Promise<Summary | null> {
  const response = await get(url, deps, { "User-Agent": userAgent });
  if (!response.ok) return null;
  return ogSummary(await readHead(response), siteNameIsAuthor);
}

export function xSummary(body: unknown): Summary | null {
  const paragraph = X_TEXT.exec(field(body, "html"))?.[1] ?? "";
  const text = decodeEntities(paragraph.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")).trim();
  return summary(field(body, "author_name"), text);
}

export function youtubeSummary(body: unknown): Summary | null {
  return summary(field(body, "author_name"), field(body, "title"));
}

export function blueskySummary(body: unknown): Summary | null {
  const name = field(body, "posts", 0, "author", "displayName");
  const handle = field(body, "posts", 0, "author", "handle");
  const author = name !== "" && handle !== "" ? `${name} (@${handle})` : name || handle;
  return summary(author, field(body, "posts", 0, "record", "text"));
}

async function bluesky(url: URL, deps: Deps): Promise<Summary | null> {
  const match = BLUESKY_POST.exec(url.pathname);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  let did = decodeURIComponent(match[1]);
  if (!did.startsWith("did:")) {
    const resolved = await json(
      `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(did)}`,
      deps,
    );
    did = field(resolved, "did");
    if (did === "") return null;
  }
  const uri = `at://${did}/app.bsky.feed.post/${match[2]}`;
  return blueskySummary(await json(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`, deps));
}

// The author and text a share link's preview shows, so the log can search them; null when unknown.
export async function summarize(url: URL, deps: Deps): Promise<Summary | null> {
  if (INSTAGRAM_HOSTS.has(url.hostname)) {
    const instagram = instagramShortcode(url.pathname);
    const post = instagram === null ? null : await instagramPost(instagram.shortcode, deps);
    return post === null ? null : summary(post.username, post.caption);
  }
  const facebook = isFacebookVideoUrl(url) ? facebookVideo : facebookPost;
  const post = await facebook(url, deps);
  if (post !== null) return summary(post.username, post.caption);
  if (YOUTUBE_HOSTS.has(url.hostname)) {
    return youtubeSummary(await json(`https://www.youtube.com/oembed?url=${encodeURIComponent(url.href)}&format=json`, deps));
  }
  if (X_HOSTS.has(url.hostname)) {
    return xSummary(await json(`https://publish.x.com/oembed?url=${encodeURIComponent(url.href)}&omit_script=1`, deps));
  }
  if (BLUESKY_HOSTS.has(url.hostname)) return bluesky(url, deps);
  if (THREADS_HOSTS.has(url.hostname)) return og(url.href, deps, false, CRAWLER_UA);
  const fixed = fixServiceUrl(url);
  // Reddit's fix service puts the poster and subreddit in og:site_name; the others put their own name there.
  const reddit = url.hostname === "redd.it" || url.hostname.endsWith("reddit.com");
  return fixed === null ? null : og(fixed.href, deps, reddit);
}
