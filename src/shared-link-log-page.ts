const DAY = /^\d{4}-\d{2}-\d{2}$/;

type LoggedKey = { name: string; metadata?: unknown };

type SharedLinkList = {
  list(options: { prefix: string }): Promise<{ keys: LoggedKey[]; list_complete: boolean }>;
};

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

function parseDay(value: string | null): Date | null {
  if (value === null) return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (!DAY.test(value)) return null;
  const day = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value ? null : day;
}

function shiftDay(day: Date, days: number): string {
  return new Date(day.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function row(key: LoggedKey, origin: string): string {
  const metadata = (key.metadata ?? {}) as { url?: unknown; raw?: unknown };
  const time = escapeHtml(key.name.slice(11, 19));
  if (typeof metadata.url !== "string") {
    return `<tr><td>${time}</td><td colspan="2">(URL exceeded the metadata limit)</td></tr>`;
  }
  const url = escapeHtml(metadata.url);
  const share = escapeHtml(metadata.raw === true ? metadata.url : `${origin}/${metadata.url.replace(/^https:\/\//, "")}`);
  const badge = metadata.raw === true ? " <small>raw</small>" : "";
  return `<tr><td>${time}</td><td><a href="${url}">${url}</a></td><td><a href="${share}">${share}</a>${badge}</td></tr>`;
}

function render(day: Date, keys: LoggedKey[], complete: boolean, origin: string): string {
  const label = day.toISOString().slice(0, 10);
  const rows = keys.map((key) => row(key, origin)).reverse().join("\n");
  const truncated = complete ? "" : "<p>Only the first 1,000 records of this day are shown.</p>";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Shared links</title>
<style>
:root { color-scheme: light dark; }
body { font: 14px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 960px; padding: 16px; }
nav { display: flex; gap: 16px; align-items: baseline; }
table { border-collapse: collapse; width: 100%; }
td, th { border-bottom: 1px solid #8884; padding: 6px 8px; text-align: left; vertical-align: top; }
td:first-child { font-variant-numeric: tabular-nums; white-space: nowrap; }
td a { word-break: break-all; }
</style>
</head>
<body>
<nav><a href="?day=${shiftDay(day, -1)}">&larr; ${shiftDay(day, -1)}</a><h1>${label} (UTC)</h1><a href="?day=${shiftDay(day, 1)}">${shiftDay(day, 1)} &rarr;</a></nav>
<p>${keys.length} records. Records expire after 90 days.</p>
${truncated}
<table>
<thead><tr><th>Time (UTC)</th><th>Original URL</th><th>Share link</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}

export function hasSharedLinkLog(env: Env): boolean {
  return (env as { SHARED_LINKS?: SharedLinkList }).SHARED_LINKS !== undefined;
}

export async function sharedLinkLogPage(requestUrl: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (ctx.access === undefined) return text(403, "forbidden");
  const day = parseDay(requestUrl.searchParams.get("day"));
  if (day === null) return text(400, "pass ?day=YYYY-MM-DD");
  const store = (env as { SHARED_LINKS?: SharedLinkList }).SHARED_LINKS;
  if (store === undefined) return text(404, "not found");
  let listed: { keys: LoggedKey[]; list_complete: boolean };
  try {
    listed = await store.list({ prefix: day.toISOString().slice(0, 10) });
  } catch {
    return text(503, "shared link log unavailable");
  }
  return new Response(render(day, listed.keys, listed.list_complete, requestUrl.origin), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
