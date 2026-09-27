import { cleanUrl } from "./clean";

const CONVERT_HINT = "pass a percent-encoded http(s) URL as ?url=";

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function isShareable(url: URL): boolean {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.hostname.includes(".")
  );
}

function convert(requestUrl: URL): Response {
  const raw = requestUrl.searchParams.get("url");
  if (raw === null || raw === "") return text(400, CONVERT_HINT);
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return text(400, CONVERT_HINT);
  }
  if (!isShareable(target)) return text(400, CONVERT_HINT);
  const cleaned = cleanUrl(target);
  return text(200, `${requestUrl.origin}/${cleaned.host}${cleaned.pathname}${cleaned.search}`);
}

function shareRedirect(requestUrl: URL): Response {
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
  return Response.redirect(cleanUrl(candidate).href, 302);
}

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") return convert(url);
    return shareRedirect(url);
  },
} satisfies ExportedHandler<Env>;
