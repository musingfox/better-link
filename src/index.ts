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

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") return convert(url);
    return text(404, "not found");
  },
} satisfies ExportedHandler<Env>;
