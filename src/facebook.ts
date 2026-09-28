import { FACEBOOK_HOSTS } from "./expand";
import { cdnUrl, decodeEntities, type Post } from "./instagram";

const POST_PATH = /^\/[^/]+\/posts\/[^/]+\/?$/;
const STORY_PATHS = new Set(["/permalink.php", "/story.php"]);
const PHOTO_PATHS = new Set(["/photo.php", "/photo", "/photo/"]);
const POST_IMAGE = "/t39.30808-6/";
const CDN_ORIGIN = "https://scontent.xx.fbcdn.net";

function nonEmpty(url: URL, name: string): boolean {
  const value = url.searchParams.get(name);
  return value !== null && value !== "";
}

export function isFacebookPostUrl(url: URL): boolean {
  if (!FACEBOOK_HOSTS.has(url.hostname)) return false;
  if (POST_PATH.test(url.pathname)) return true;
  if (STORY_PATHS.has(url.pathname)) return nonEmpty(url, "story_fbid") && nonEmpty(url, "id");
  if (PHOTO_PATHS.has(url.pathname)) return nonEmpty(url, "fbid");
  return false;
}

function tagEnd(html: string, at: number): number {
  return html.indexOf(">", at);
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return match?.[1] ?? null;
}

function authorName(html: string): string | null {
  let i = 0;
  while (i < html.length) {
    const at = html.indexOf("<img", i);
    if (at < 0) return null;
    const end = tagEnd(html, at);
    if (end < 0) return null;
    const tag = html.slice(at, end + 1);
    i = end + 1;
    if (!tag.includes('role="img"')) continue;
    const label = attr(tag, "aria-label");
    if (label === null) return null;
    const name = decodeEntities(label).trim();
    return name === "" ? null : name;
  }
  return null;
}

function postImageUrl(html: string): string | null {
  let i = 0;
  while (i < html.length) {
    const at = html.indexOf("<img", i);
    if (at < 0) return null;
    const end = tagEnd(html, at);
    if (end < 0) return null;
    const tag = html.slice(at, end + 1);
    i = end + 1;
    const src = attr(tag, "src");
    if (src === null) continue;
    let parsed: URL;
    try {
      parsed = new URL(decodeEntities(src));
    } catch {
      continue;
    }
    if (!parsed.pathname.startsWith("/") || !parsed.pathname.includes(POST_IMAGE)) continue;
    try {
      return cdnUrl(parsed.href, CDN_ORIGIN);
    } catch {
      continue;
    }
  }
  return null;
}

export function parsePostPage(html: string): Post | null {
  try {
    const username = authorName(html);
    if (username === null) return null;
    const image = postImageUrl(html);
    if (image === null) return null;
    return { username, caption: "", media: [{ kind: "image", url: image }] };
  } catch {
    return null;
  }
}
