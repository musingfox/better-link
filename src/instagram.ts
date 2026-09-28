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
  const key = `${deps.origin}/__cache/instagram/v2/${shortcode}`;
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

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function readContext(html: string): unknown {
  const key = '"contextJSON":';
  const at = html.indexOf(key);
  if (at < 0) return null;
  const jsonString = /"(?:[^"\\]|\\.)*"/y;
  jsonString.lastIndex = at + key.length;
  const match = jsonString.exec(html);
  if (match === null) return null;
  const decoded: unknown = JSON.parse(match[0]);
  if (typeof decoded !== "string") return null;
  return JSON.parse(decoded);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function shortcodeMedia(context: unknown): Record<string, unknown> | null {
  const root = asRecord(context);
  const gql = asRecord(root?.gql_data);
  return asRecord(gql?.shortcode_media);
}

function imageItem(raw: unknown): Media | null {
  if (typeof raw !== "string") return null;
  const url = cdnUrl(raw);
  if (url === null) return null;
  return { kind: "image", url };
}

function videoItem(node: Record<string, unknown>): Media | null {
  if (typeof node.video_url !== "string") return null;
  const url = cdnUrl(node.video_url);
  if (url === null) return null;
  const dimensions = asRecord(node.dimensions);
  if (dimensions === null) return null;
  if (!positiveInteger(dimensions.width) || !positiveInteger(dimensions.height)) return null;
  return { kind: "video", url, width: dimensions.width, height: dimensions.height };
}

function itemFromNode(node: unknown): Media | null {
  const record = asRecord(node);
  if (record === null) return null;
  if (record.is_video === true) return videoItem(record);
  return imageItem(record.display_url);
}

function richItems(type: string, context: unknown): Media[] | null {
  const media = shortcodeMedia(context);
  if (media === null) return null;
  if (type === "GraphVideo") {
    // The page type already says this node is a video. A missing is_video flag
    // must not fall through to display_url.
    const item = videoItem(media);
    return item === null ? null : [item];
  }
  const edge = asRecord(media.edge_sidecar_to_children);
  const edges = edge?.edges;
  if (!Array.isArray(edges) || edges.length === 0) return null;
  const items: Media[] = [];
  for (const edgeNode of edges) {
    const item = itemFromNode(asRecord(edgeNode)?.node);
    if (item === null) return null;
    items.push(item);
  }
  return items;
}

export function parseEmbed(html: string): Post | null {
  try {
    if (html.includes("WatchOnInstagram")) return null;
    const type = mediaType(html);
    const username = usernameOf(html);
    if (!username) return null;
    if (type === "GraphImage") {
      const mediaUrl = mediaUrlOf(html);
      if (mediaUrl === null) return null;
      return { username, caption: captionOf(html), media: [{ kind: "image", url: mediaUrl }] };
    }
    if (type !== "GraphVideo" && type !== "GraphSidecar") return null;
    const context = readContext(html);
    if (context === null) return null;
    if (asRecord(asRecord(context)?.context)?.copyright_blocked === true) return null;
    const media = richItems(type, context);
    if (media === null) return null;
    return { username, caption: captionOf(html), media };
  } catch {
    return null;
  }
}
