import { cleanUrl } from "./clean";
import { isCrawler } from "./crawler";
import { expandShareLink, isShareable } from "./expand";
import { fixServiceUrl } from "./fix-services";

const CONVERT_HINT = "pass a percent-encoded http(s) URL as ?url=";

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function convert(requestUrl: URL): Promise<Response> {
  const raw = requestUrl.searchParams.get("url");
  if (raw === null || raw === "") return text(400, CONVERT_HINT);
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return text(400, CONVERT_HINT);
  }
  if (!isShareable(target)) return text(400, CONVERT_HINT);
  const cleaned = cleanUrl((await expandShareLink(target)) ?? target);
  return text(200, `${requestUrl.origin}/${cleaned.host}${cleaned.pathname}${cleaned.search}`);
}

function shareRedirect(requestUrl: URL, userAgent: string | null): Response {
  const match = /^\/([^/]+)(\/.*)$/.exec(requestUrl.pathname);
  if (!match) return text(404, "not found");
  const host = match[1];
  const path = match[2];
  let candidate: URL;
  try {
    candidate = new URL(`https://${host}${path}${requestUrl.search}`);
  } catch {
    return text(404, "not found");
  }
  if (!isShareable(candidate) || candidate.hostname !== host.toLowerCase()) {
    return text(404, "not found");
  }
  const cleaned = cleanUrl(candidate);
  const fixed = isCrawler(userAgent) ? fixServiceUrl(cleaned) : null;
  return Response.redirect((fixed ?? cleaned).href, 302);
}

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") return convert(url);
    return shareRedirect(url, request.headers.get("User-Agent"));
  },
} satisfies ExportedHandler<Env>;
