import type { Fetcher } from "./expand";

export type Post = {
  username: string;
  caption: string;
  mediaUrl: string;
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

function mediaUrlOf(html: string): string | null {
  const src = embeddedImageSrc(html);
  if (src === null) return null;
  const url = new URL(src);
  url.protocol = "https:";
  url.host = "scontent.cdninstagram.com";
  return url.href;
}

const EMBED_UA = "Go-http-client/1.1";

export async function instagramPost(
  shortcode: string,
  deps: { origin: string; cache: PostCache; fetcher?: Fetcher },
): Promise<Post | null> {
  const fetcher = deps.fetcher ?? ((input, init) => fetch(input, init));
  const key = `${deps.origin}/__cache/instagram/${shortcode}`;
  try {
    const hit = await deps.cache.match(key);
    if (hit) return (await hit.json()) as Post;
  } catch {
    return null;
  }
  const response = await fetcher(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
    headers: { "User-Agent": EMBED_UA },
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 200) return null;
  return parseEmbed(await response.text());
}

export function parseEmbed(html: string): Post | null {
  try {
    if (mediaType(html) !== "GraphImage") return null;
    const username = usernameOf(html);
    if (!username) return null;
    const mediaUrl = mediaUrlOf(html);
    if (mediaUrl === null) return null;
    return { username, caption: captionOf(html), mediaUrl };
  } catch {
    return null;
  }
}
