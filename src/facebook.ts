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

const REEL_PATH = /^\/reel\/\d+\/?$/;
const PAGE_VIDEO_PATH = /^\/[^/]+\/videos\/(?:[^/]+\/)?\d+\/?$/;
const WATCH_PATHS = new Set(["/watch", "/watch/"]);

export function isFacebookPostUrl(url: URL): boolean {
  if (!FACEBOOK_HOSTS.has(url.hostname)) return false;
  if (POST_PATH.test(url.pathname)) return true;
  if (STORY_PATHS.has(url.pathname)) return nonEmpty(url, "story_fbid") && nonEmpty(url, "id");
  if (PHOTO_PATHS.has(url.pathname)) return nonEmpty(url, "fbid");
  return false;
}

export function isFacebookVideoUrl(url: URL): boolean {
  if (!FACEBOOK_HOSTS.has(url.hostname)) return false;
  if (REEL_PATH.test(url.pathname)) return true;
  if (PAGE_VIDEO_PATH.test(url.pathname)) return true;
  if (WATCH_PATHS.has(url.pathname)) return nonEmpty(url, "v");
  return false;
}

function postImageFrom(src: string): string | null {
  const parsed = new URL(decodeEntities(src));
  if (!parsed.pathname.startsWith("/") || !parsed.pathname.includes(POST_IMAGE)) return null;
  return cdnUrl(parsed.href, CDN_ORIGIN);
}

function captionText(closed: boolean, parts: string[]): string {
  if (!closed) return "";
  return decodeEntities(parts.join(""))
    .replace(/\u200b/g, "")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parsePostPage(html: string): Promise<Post | null> {
  let author: string | null | undefined;
  let image: string | null = null;
  let phase: "before" | "inside" | "after" = "before";
  let closed = false;
  let hide = 0;
  const parts: string[] = [];
  try {
    await new HTMLRewriter()
      .on('img[role="img"]', {
        element(element) {
          if (author !== undefined) return;
          try {
            author = element.getAttribute("aria-label");
          } catch {
            author = null;
          }
        },
      })
      .on("img", {
        element(element) {
          if (image !== null) return;
          try {
            const src = element.getAttribute("src");
            if (src === null) return;
            const url = postImageFrom(src);
            if (url !== null) image = url;
          } catch {
            // An unparseable src is skipped; a throw would reject the whole page.
          }
        },
      })
      .on('div[data-testid="post_message"]', {
        element(element) {
          if (phase !== "before") return;
          phase = "inside";
          element.onEndTag(() => {
            phase = "after";
            closed = true;
          });
        },
        text(chunk) {
          if (phase !== "inside" || hide !== 0 || chunk.text.length === 0) return;
          parts.push(chunk.text);
        },
      })
      .on("span.text_exposed_hide", {
        element(element) {
          if (phase !== "inside") return;
          hide += 1;
          element.onEndTag(() => {
            hide -= 1;
          });
        },
      })
      .on("br", {
        element() {
          if (phase === "inside" && hide === 0) parts.push("\n");
        },
      })
      .on("p", {
        element(element) {
          if (phase !== "inside") return;
          element.onEndTag((end) => {
            if (end.name !== "p" || phase !== "inside" || hide !== 0) return;
            parts.push("\n\n");
          });
        },
      })
      .transform(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
      .arrayBuffer();
  } catch {
    return null;
  }
  if (author === undefined || author === null || image === null) return null;
  const username = decodeEntities(author).trim();
  if (username === "") return null;
  return { username, caption: captionText(closed, parts), media: [{ kind: "image", url: image }] };
}

const VIDEO_CDN = "https://video.xx.fbcdn.net";
const VIDEO_PLUGIN = "https://www.facebook.com/plugins/video.php?href=";

function readJsonString(html: string, key: string): string | null {
  const at = html.indexOf(key);
  if (at < 0) return null;
  const start = at + key.length;
  if (html.charCodeAt(start) !== 34) return null;
  let i = start + 1;
  while (i < html.length) {
    const code = html.charCodeAt(i);
    if (code === 34) {
      const decoded: unknown = JSON.parse(html.slice(start, i + 1));
      if (typeof decoded !== "string") return null;
      return decoded;
    }
    if (code === 92) {
      if (i + 1 >= html.length) return null;
      i += 2;
      continue;
    }
    i += 1;
  }
  return null;
}

function usableVideoUrl(html: string, key: string): string | null {
  try {
    const decoded = readJsonString(html, key);
    if (decoded === null) return null;
    return cdnUrl(decoded, VIDEO_CDN);
  } catch {
    return null;
  }
}

function readPositiveInt(html: string, key: string): number | null {
  const at = html.indexOf(key);
  if (at < 0) return null;
  let i = at + key.length;
  const start = i;
  if (html[i] === "-") i += 1;
  if (html[i] === "0") {
    i += 1;
  } else if (html[i] !== undefined && html[i] >= "0" && html[i] <= "9") {
    while (html[i] !== undefined && html[i] >= "0" && html[i] <= "9") i += 1;
  } else {
    return null;
  }
  if (html[i] === ".") {
    i += 1;
    const fraction = i;
    while (html[i] !== undefined && html[i] >= "0" && html[i] <= "9") i += 1;
    if (i === fraction) return null;
  }
  if (html[i] === "e" || html[i] === "E") {
    i += 1;
    if (html[i] === "+" || html[i] === "-") i += 1;
    const exponent = i;
    while (html[i] !== undefined && html[i] >= "0" && html[i] <= "9") i += 1;
    if (i === exponent) return null;
  }
  const value = Number(html.slice(start, i));
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

async function videoAuthor(html: string): Promise<string | null> {
  let author: string | null | undefined;
  await new HTMLRewriter()
    .on('img[role="img"]', {
      element(element) {
        if (author !== undefined) return;
        try {
          author = element.getAttribute("aria-label");
        } catch {
          author = null;
        }
      },
    })
    .transform(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
    .arrayBuffer();
  if (typeof author !== "string") return null;
  const username = decodeEntities(author).trim();
  if (username === "") return null;
  return username;
}

export async function parseVideoPage(html: string): Promise<Post | null> {
  try {
    const url = usableVideoUrl(html, '"hd_src":') ?? usableVideoUrl(html, '"sd_src":');
    if (url === null) return null;
    const width = readPositiveInt(html, '"original_width":');
    const height = readPositiveInt(html, '"original_height":');
    if (width === null || height === null) return null;
    const username = await videoAuthor(html);
    if (username === null) return null;
    return { username, caption: "", media: [{ kind: "video", url, width, height }] };
  } catch {
    return null;
  }
}

function cacheKey(origin: string, canonical: URL): string {
  return `${origin}/__cache/facebook/v1/${encodeURIComponent(canonical.host + canonical.pathname + canonical.search)}`;
}

async function loadFromPlugin(
  canonical: URL,
  deps: { origin: string; cache: PostCache; fetcher?: Fetcher },
  pluginPrefix: string,
  parse: (html: string) => Promise<Post | null>,
): Promise<Post | null> {
  const fetcher = deps.fetcher ?? ((input, init) => fetch(input, init));
  const key = cacheKey(deps.origin, canonical);
  try {
    const hit = await deps.cache.match(key);
    if (hit) {
      const body: unknown = await hit.json();
      if (!isPost(body)) return null;
      return body;
    }
    const response = await fetcher(pluginPrefix + encodeURIComponent(canonical.href), {
      headers: { "User-Agent": EMBED_UA },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200) return null;
    const post = await parse(await response.text());
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

export async function facebookPost(
  canonical: URL,
  deps: { origin: string; cache: PostCache; fetcher?: Fetcher },
): Promise<Post | null> {
  if (!isFacebookPostUrl(canonical)) return null;
  return loadFromPlugin(canonical, deps, PLUGIN, parsePostPage);
}

export async function facebookVideo(
  canonical: URL,
  deps: { origin: string; cache: PostCache; fetcher?: Fetcher },
): Promise<Post | null> {
  if (!isFacebookVideoUrl(canonical)) return null;
  return loadFromPlugin(canonical, deps, VIDEO_PLUGIN, parseVideoPage);
}
