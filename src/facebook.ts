import { FACEBOOK_HOSTS, type Fetcher } from "./expand";
import { cdnUrl, decodeEntities, isPost, type Post, type PostCache } from "./instagram";

const POST_PATH = /^\/[^/]+\/posts\/[^/]+\/?$/;
const STORY_PATHS = new Set(["/permalink.php", "/story.php"]);
const PHOTO_PATHS = new Set(["/photo.php", "/photo", "/photo/"]);
const POST_IMAGE = "/t39.30808-6/";
const CDN_ORIGIN = "https://scontent.xx.fbcdn.net";
const PLUGIN = "https://www.facebook.com/plugins/post.php?href=";
const EMBED_UA = "Go-http-client/1.1";

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

function isOpenTag(html: string, at: number, name: string): boolean {
  const token = `<${name}`;
  if (!html.startsWith(token, at)) return false;
  const next = html[at + token.length];
  return next === " " || next === "\t" || next === "\n" || next === "\r" || next === "/" || next === ">";
}

function findOpenTag(html: string, name: string, from: number): number {
  const token = `<${name}`;
  let i = from;
  while (i < html.length) {
    const at = html.indexOf(token, i);
    if (at < 0) return -1;
    if (isOpenTag(html, at, name)) return at;
    i = at + token.length;
  }
  return -1;
}

function tagEnd(html: string, at: number): number {
  let i = at;
  while (i < html.length) {
    const c = html[i];
    if (c === '"' || c === "'") {
      const end = html.indexOf(c, i + 1);
      if (end < 0) return html.indexOf(">", i);
      i = end + 1;
      continue;
    }
    if (c === ">") return i;
    i += 1;
  }
  return -1;
}

function attr(tag: string, name: string): string | null {
  let i = 0;
  while (i < tag.length && tag[i] !== " " && tag[i] !== "\t" && tag[i] !== "\n" && tag[i] !== "\r" && tag[i] !== ">") {
    i += 1;
  }
  while (i < tag.length) {
    while (i < tag.length && (tag[i] === " " || tag[i] === "\t" || tag[i] === "\n" || tag[i] === "\r" || tag[i] === "/")) {
      i += 1;
    }
    if (i >= tag.length || tag[i] === ">") return null;
    const nameStart = i;
    while (
      i < tag.length &&
      tag[i] !== "=" &&
      tag[i] !== " " &&
      tag[i] !== "\t" &&
      tag[i] !== "\n" &&
      tag[i] !== "\r" &&
      tag[i] !== ">" &&
      tag[i] !== "/"
    ) {
      i += 1;
    }
    const found = tag.slice(nameStart, i);
    while (i < tag.length && (tag[i] === " " || tag[i] === "\t" || tag[i] === "\n" || tag[i] === "\r")) i += 1;
    if (i >= tag.length || tag[i] !== "=") continue;
    i += 1;
    while (i < tag.length && (tag[i] === " " || tag[i] === "\t" || tag[i] === "\n" || tag[i] === "\r")) i += 1;
    const quote = tag[i];
    if (i >= tag.length || (quote !== '"' && quote !== "'")) {
      while (i < tag.length && tag[i] !== " " && tag[i] !== "\t" && tag[i] !== "\n" && tag[i] !== "\r" && tag[i] !== ">") {
        i += 1;
      }
      continue;
    }
    i += 1;
    const valueStart = i;
    const valueEnd = tag.indexOf(quote, i);
    if (valueEnd < 0) return null;
    if (found === name) return tag.slice(valueStart, valueEnd);
    i = valueEnd + 1;
  }
  return null;
}

function authorName(html: string): string | null {
  let i = 0;
  while (i < html.length) {
    const at = findOpenTag(html, "img", i);
    if (at < 0) return null;
    const end = tagEnd(html, at);
    if (end < 0) return null;
    const tag = html.slice(at, end + 1);
    i = end + 1;
    if (attr(tag, "role") !== "img") continue;
    const label = attr(tag, "aria-label");
    if (label === null) return null;
    const name = decodeEntities(label).trim();
    return name === "" ? null : name;
  }
  return null;
}

function isDivTagAt(html: string, at: number): boolean {
  return isOpenTag(html, at, "div");
}

function postMessage(html: string): string | null {
  const marker = 'data-testid="post_message"';
  let from = 0;
  while (from < html.length) {
    const at = html.indexOf(marker, from);
    if (at < 0) return null;
    const open = html.lastIndexOf("<", at);
    const start = open < 0 ? -1 : tagEnd(html, open);
    if (open < 0 || !isDivTagAt(html, open) || start < at) {
      from = at + marker.length;
      continue;
    }
    if (attr(html.slice(open, start + 1), "data-testid") !== "post_message") {
      from = at + marker.length;
      continue;
    }
    let depth = 1;
    let i = start + 1;
    while (i < html.length) {
      const nextOpen = findOpenTag(html, "div", i);
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
    const start = tagEnd(html, at);
    if (start < 0) return out + html.slice(at);
    let depth = 1;
    let j = start + 1;
    let end = -1;
    while (j < html.length) {
      const nextOpen = findOpenTag(html, "span", j);
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
    const at = findOpenTag(html, "img", i);
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

function cacheKey(origin: string, canonical: URL): string {
  return `${origin}/__cache/facebook/v1/${encodeURIComponent(canonical.host + canonical.pathname + canonical.search)}`;
}

export async function facebookPost(
  canonical: URL,
  deps: { origin: string; cache: PostCache; fetcher?: Fetcher },
): Promise<Post | null> {
  if (!isFacebookPostUrl(canonical)) return null;
  const fetcher = deps.fetcher ?? ((input, init) => fetch(input, init));
  const key = cacheKey(deps.origin, canonical);
  try {
    const hit = await deps.cache.match(key);
    if (hit) {
      const body: unknown = await hit.json();
      if (!isPost(body)) return null;
      return body;
    }
    const response = await fetcher(PLUGIN + encodeURIComponent(canonical.href), {
      headers: { "User-Agent": EMBED_UA },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200) return null;
    const post = parsePostPage(await response.text());
    if (!post) return null;
    await deps.cache
      .put(
        key,
        new Response(JSON.stringify(post), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "max-age=86400",
          },
        }),
      )
      .catch(() => {});
    return post;
  } catch {
    return null;
  }
}
