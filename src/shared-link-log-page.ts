import { INSTAGRAM_HOSTS } from "./clean";
import { isFacebookPostUrl, isFacebookVideoUrl } from "./facebook";
import { instagramShortcode } from "./instagram";

const PAGE_SIZE = 30;
const SEARCH_BATCH = 1_000;
const SEARCH_LISTS = 3;

type LoggedKey = { name: string; metadata?: unknown };
type Listed = { keys: LoggedKey[]; list_complete: boolean; cursor?: string };
type ListOptions = { limit: number; cursor?: string };

type SharedLinkList = {
  list(options: ListOptions): Promise<Listed>;
};

type Logged = { at: string; url: string | null; raw: boolean; author: string; text: string };

// Swaps a failed preview image for a video (video posts serve an mp4), then for a note.
const MEDIA_FALLBACK = `document.addEventListener("error", (event) => {
  const el = event.target;
  if (!(el instanceof HTMLElement) || !el.dataset.media) return;
  if (el.tagName === "IMG") {
    const video = document.createElement("video");
    video.dataset.media = el.dataset.media;
    video.src = el.dataset.media;
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.controls = true;
    el.replaceWith(video);
  } else {
    el.replaceWith("No preview");
  }
}, true);`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function logged(key: LoggedKey): Logged {
  const metadata = (key.metadata ?? {}) as { url?: unknown; at?: unknown; raw?: unknown; author?: unknown; text?: unknown };
  return {
    at: typeof metadata.at === "string" ? metadata.at : "",
    url: typeof metadata.url === "string" ? metadata.url : null,
    raw: metadata.raw === true,
    author: typeof metadata.author === "string" ? metadata.author : "",
    text: typeof metadata.text === "string" ? metadata.text : "",
  };
}

// The same /media/ URL the share link's og page embeds; other platforms embed nothing of ours.
function mediaUrl(url: string, origin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (INSTAGRAM_HOSTS.has(parsed.hostname)) {
    const instagram = instagramShortcode(parsed.pathname);
    return instagram === null ? null : `${origin}/media/${instagram.shortcode}/${instagram.index}`;
  }
  if (isFacebookPostUrl(parsed) || isFacebookVideoUrl(parsed)) {
    return `${origin}/media/${parsed.hostname}${parsed.pathname}${parsed.search}`;
  }
  return null;
}

function row(entry: Logged, origin: string): string {
  const time = escapeHtml(entry.at.slice(0, 19).replace("T", " "));
  if (entry.url === null) {
    return `<tr><td>${time}</td><td>No preview</td><td colspan="2">(URL exceeded the metadata limit)</td></tr>`;
  }
  const url = escapeHtml(entry.url);
  const share = escapeHtml(entry.raw ? entry.url : `${origin}/${entry.url.replace(/^https:\/\//, "")}`);
  const badge = entry.raw ? " <small>raw</small>" : "";
  const media = mediaUrl(entry.url, origin);
  const preview =
    media === null ? "No preview" : `<img data-media="${escapeHtml(media)}" src="${escapeHtml(media)}" loading="lazy" alt="">`;
  const author = entry.author === "" ? "" : `<strong>${escapeHtml(entry.author)}</strong>`;
  const text = entry.text === "" ? "" : `<p class="text">${escapeHtml(entry.text)}</p>`;
  return `<tr><td>${time}</td><td class="preview">${preview}</td><td>${author}${text}<a href="${url}">${url}</a></td><td><a href="${share}">${share}</a>${badge}</td></tr>`;
}

function render(entries: Logged[], query: string, next: string | null, origin: string): string {
  const rows = entries.map((entry) => row(entry, origin)).join("\n");
  const q = escapeHtml(query);
  const nextHref =
    next === null ? null : escapeHtml(query === "" ? `?cursor=${encodeURIComponent(next)}` : `?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(next)}`);
  const nextLabel = query === "" ? "Older &rarr;" : "Keep searching older records &rarr;";
  const emptyNote = query !== "" ? "No matches in the scanned records." : next === null ? "No records." : "No records on this page.";
  const empty = entries.length === 0 ? `<p>${emptyNote}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Shared links</title>
<script>${MEDIA_FALLBACK}</script>
<style>
:root { color-scheme: light dark; }
body { font: 14px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 1080px; padding: 16px; }
form { display: flex; gap: 8px; margin-bottom: 16px; }
input { flex: 1; font: inherit; padding: 6px 8px; }
table { border-collapse: collapse; width: 100%; }
td, th { border-bottom: 1px solid #8884; padding: 6px 8px; text-align: left; vertical-align: top; }
td:first-child { font-variant-numeric: tabular-nums; white-space: nowrap; }
td a { word-break: break-all; }
.text { margin: 2px 0 4px; white-space: pre-line; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.preview { width: 96px; color: #888; font-size: 12px; }
.preview img, .preview video { display: block; width: 96px; height: 96px; object-fit: cover; border-radius: 4px; }
nav { display: flex; gap: 16px; margin-top: 16px; }
</style>
</head>
<body>
<h1>Shared links</h1>
<form action="/log"><input type="search" name="q" value="${q}" placeholder="Search URLs, authors and text"><button>Search</button></form>
${empty}
<table>
<thead><tr><th>Time (UTC)</th><th>Preview</th><th>Post</th><th>Share link</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<nav><a href="/log">Latest</a>${nextHref === null ? "" : `<a href="${nextHref}">${nextLabel}</a>`}</nav>
<p><small>Records expire after 90 days.</small></p>
</body>
</html>
`;
}

async function browse(store: SharedLinkList, cursor: string | undefined): Promise<{ entries: Logged[]; next: string | null }> {
  const listed = await store.list(cursor === undefined ? { limit: PAGE_SIZE } : { limit: PAGE_SIZE, cursor });
  return { entries: listed.keys.map(logged), next: listed.list_complete ? null : (listed.cursor ?? null) };
}

// Stops only between batches: a cursor resumes after a whole batch, so stopping inside one would skip its rest.
async function search(
  store: SharedLinkList,
  query: string,
  cursor: string | undefined,
): Promise<{ entries: Logged[]; next: string | null }> {
  const needle = query.toLowerCase();
  const entries: Logged[] = [];
  let next = cursor;
  for (let i = 0; i < SEARCH_LISTS; i++) {
    const listed = await store.list(next === undefined ? { limit: SEARCH_BATCH } : { limit: SEARCH_BATCH, cursor: next });
    for (const key of listed.keys) {
      const entry = logged(key);
      if ([entry.url ?? "", entry.author, entry.text].some((field) => field.toLowerCase().includes(needle))) entries.push(entry);
    }
    if (listed.list_complete || listed.cursor === undefined) return { entries, next: null };
    next = listed.cursor;
    if (entries.length >= PAGE_SIZE) break;
  }
  return { entries, next: next ?? null };
}

export function hasSharedLinkLog(env: Env): boolean {
  return (env as { SHARED_LINKS?: SharedLinkList }).SHARED_LINKS !== undefined;
}

export async function sharedLinkLogPage(requestUrl: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (ctx.access === undefined) return text(403, "forbidden");
  const store = (env as { SHARED_LINKS?: SharedLinkList }).SHARED_LINKS;
  if (store === undefined) return text(404, "not found");
  const query = requestUrl.searchParams.get("q")?.trim() ?? "";
  const cursor = requestUrl.searchParams.get("cursor") || undefined;
  let result: { entries: Logged[]; next: string | null };
  try {
    result = query === "" ? await browse(store, cursor) : await search(store, query, cursor);
  } catch {
    return text(503, "shared link log unavailable");
  }
  return new Response(render(result.entries, query, result.next, requestUrl.origin), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
