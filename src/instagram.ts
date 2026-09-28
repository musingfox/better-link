import type { Fetcher } from "./expand";

export type Media =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string; width: number; height: number };

export type Post = {
  username: string;
  caption: string;
  media: Media[];
};

export interface PostCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|amp|lt|gt|quot|apos);/gi;

function codePoint(cp: number, raw: string): string {
  if (!Number.isSafeInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return raw;
  }
  return String.fromCodePoint(cp);
}

function decodeEntities(value: string): string {
  return value.replace(ENTITY, (entity, hex: string | undefined, dec: string | undefined) => {
    if (hex !== undefined) return codePoint(Number.parseInt(hex, 16), entity);
    if (dec !== undefined) return codePoint(Number.parseInt(dec, 10), entity);
    switch (entity.toLowerCase()) {
      case "&amp;":
        return "&";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&quot;":
        return '"';
      case "&apos;":
        return "'";
      default:
        return entity;
    }
  });
}

function mediaType(html: string): string | null {
  const key = 'data-media-type="';
  const at = html.indexOf(key);
  if (at < 0) return null;
  const start = at + key.length;
  const end = html.indexOf('"', start);
  if (end < 0) return null;
  return html.slice(start, end);
}

function usernameOf(html: string): string | null {
  const key = '<span class="UsernameText">';
  const at = html.indexOf(key);
  if (at < 0) return null;
  const start = at + key.length;
  const end = html.indexOf("</span>", start);
  if (end < 0) return null;
  return decodeEntities(html.slice(start, end)).trim();
}

function embeddedImageSrc(html: string): string | null {
  const marker = html.indexOf('class="EmbeddedMediaImage"');
  if (marker < 0) return null;
  const tagStart = html.lastIndexOf("<", marker);
  const tagEnd = html.indexOf(">", marker);
  if (tagStart < 0 || tagEnd < 0) return null;
  const match = /\ssrc="([^"]*)"/.exec(html.slice(tagStart, tagEnd + 1));
  return match ? decodeEntities(match[1]) : null;
}

function captionOf(html: string): string {
  const open = '<div class="Caption">';
  const at = html.indexOf(open);
  if (at < 0) return "";
  const start = at + open.length;
  const comments = html.indexOf('<div class="CaptionComments"', start);
  const end = comments >= 0 ? comments : html.indexOf("</div>", start);
  if (end < 0) return "";
  const region = html
    .slice(start, end)
    .replace(/<a class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(region).trim();
}

function cdnUrl(raw: string): string | null {
  const url = new URL(raw);
  // Path must stay a path. data: and javascript: pathnames have no leading slash,
  // so prefixing the CDN origin would glue the payload onto the host.
  if (!url.pathname.startsWith("/")) return null;
  return "https://scontent.cdninstagram.com" + url.pathname + url.search;
}

function mediaUrlOf(html: string): string | null {
  const src = embeddedImageSrc(html);
  if (src === null) return null;
  return cdnUrl(src);
}

const EMBED_UA = "Go-http-client/1.1";
const SHORTCODE = /^[A-Za-z0-9_-]+$/;

export function isShortcode(value: string): boolean {
  return SHORTCODE.test(value);
}

function isMedia(value: unknown): value is Media {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "image") return typeof record.url === "string";
  if (record.kind === "video") {
    return typeof record.url === "string" && typeof record.width === "number" && typeof record.height === "number";
  }
  return false;
}

function isPost(value: unknown): value is Post {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.username === "string" &&
    typeof record.caption === "string" &&
    Array.isArray(record.media) &&
    record.media.length > 0 &&
    record.media.every(isMedia)
  );
}

export async function instagramPost(
  shortcode: string,
  deps: { origin: string; cache: PostCache; fetcher?: Fetcher },
): Promise<Post | null> {
  if (!isShortcode(shortcode)) return null;
  const fetcher = deps.fetcher ?? ((input, init) => fetch(input, init));
  const key = `${deps.origin}/__cache/instagram/${shortcode}`;
  try {
    const hit = await deps.cache.match(key);
    if (hit) {
      const body: unknown = await hit.json();
      if (!isPost(body)) return null;
      return body;
    }
    const response = await fetcher(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
      headers: { "User-Agent": EMBED_UA },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200) return null;
    const post = parseEmbed(await response.text());
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

export function parseEmbed(html: string): Post | null {
  try {
    if (mediaType(html) !== "GraphImage") return null;
    const username = usernameOf(html);
    if (!username) return null;
    const mediaUrl = mediaUrlOf(html);
    if (mediaUrl === null) return null;
    return { username, caption: captionOf(html), media: [{ kind: "image", url: mediaUrl }] };
  } catch {
    return null;
  }
}
