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

function postMessage(html: string): string | null {
  const marker = 'data-testid="post_message"';
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const open = html.lastIndexOf("<div", at);
  if (open < 0) return null;
  const start = html.indexOf(">", at);
  if (start < 0) return null;
  let depth = 1;
  let i = start + 1;
  while (i < html.length) {
    const nextOpen = html.indexOf("<div", i);
    const nextClose = html.indexOf("</div>", i);
    if (nextClose < 0) return null;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 4;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(start + 1, nextClose);
      i = nextClose + 6;
    }
  }
  return null;
}

function removeExposedHide(html: string): string {
  const marker = '<span class="text_exposed_hide"';
  let out = "";
  let i = 0;
  while (i < html.length) {
    const at = html.indexOf(marker, i);
    if (at < 0) return out + html.slice(i);
    out += html.slice(i, at);
    const start = html.indexOf(">", at);
    if (start < 0) return out + html.slice(at);
    let depth = 1;
    let j = start + 1;
    let end = -1;
    while (j < html.length) {
      const nextOpen = html.indexOf("<span", j);
      const nextClose = html.indexOf("</span>", j);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        j = nextOpen + 5;
      } else {
        depth -= 1;
        j = nextClose + 7;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) return out + html.slice(at);
    i = end;
  }
  return out;
}

function captionOf(html: string): string {
  const inner = postMessage(html);
  if (inner === null) return "";
  const text = removeExposedHide(inner)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .replace(/\u200b/g, "")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    return { username, caption: captionOf(html), media: [{ kind: "image", url: image }] };
  } catch {
    return null;
  }
}

