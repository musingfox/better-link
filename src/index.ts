import { cleanUrl, INSTAGRAM_HOSTS } from "./clean";
import { isCrawler } from "./crawler";
import { expandShareLink, isShareable } from "./expand";
import { fixServiceUrl } from "./fix-services";
import { instagramPost, isShortcode, type Post, type PostCache } from "./instagram";
import { renderOgPage } from "./og";

const CONVERT_HINT = "pass a percent-encoded http(s) URL as ?url=";
const POST_PATH = /^\/p\/([^/]+)\/?$/;
const ITEM_SUFFIX = /^\/(p|reel)\/([^/]+)\/([1-9]\d?)\/?$/;

function landingUrl(cleaned: URL): URL {
  if (!INSTAGRAM_HOSTS.has(cleaned.hostname)) return cleaned;
  const match = ITEM_SUFFIX.exec(cleaned.pathname);
  if (match?.[1] === undefined || match[2] === undefined) return cleaned;
  const landing = new URL(cleaned.href);
  landing.pathname = `/${match[1]}/${match[2]}/`;
  return landing;
}
const MEDIA_PATH = /^\/media\/([^/]+)\/1$/;

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

function previewImage(origin: string, shortcode: string): string {
  return `${origin}/media/${shortcode}/1`;
}

async function loadPost(
  shortcode: string,
  origin: string,
  deps: { cache: () => PostCache },
): Promise<Post | null> {
  try {
    return await instagramPost(shortcode, {
      origin,
      cache: deps.cache(),
    });
  } catch {
    return null;
  }
}

async function instagramOg(
  requestUrl: URL,
  cleaned: URL,
  shortcode: string,
  deps: { cache: () => PostCache },
): Promise<Response> {
  const post = await loadPost(shortcode, requestUrl.origin, deps);
  if (!post) return Response.redirect(cleaned.href, 302);
  return new Response(
    renderOgPage({
      title: `@${post.username}`,
      description: post.caption,
      image: previewImage(requestUrl.origin, shortcode),
      url: cleaned.href,
    }),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function shareRedirect(
  requestUrl: URL,
  userAgent: string | null,
  deps: { cache: () => PostCache },
): Promise<Response> {
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
  const landing = landingUrl(cleaned);
  const postMatch = POST_PATH.exec(cleaned.pathname);
  if (
    isCrawler(userAgent) &&
    INSTAGRAM_HOSTS.has(cleaned.hostname) &&
    postMatch?.[1] !== undefined &&
    isShortcode(postMatch[1])
  ) {
    return instagramOg(requestUrl, landing, postMatch[1], deps);
  }
  const fixed = isCrawler(userAgent) ? fixServiceUrl(cleaned) : null;
  return Response.redirect((fixed ?? landing).href, 302);
}

async function mediaRedirect(
  requestUrl: URL,
  deps: { cache: () => PostCache },
): Promise<Response> {
  const match = MEDIA_PATH.exec(requestUrl.pathname);
  if (match?.[1] === undefined || !isShortcode(match[1])) return text(404, "not found");
  const post = await loadPost(match[1], requestUrl.origin, deps);
  const item = post?.media[0];
  if (!post || item === undefined) return text(404, "not found");
  return new Response(null, {
    status: 302,
    headers: { Location: item.url, "Cache-Control": "no-store" },
  });
}

export function createWorker(deps: { cache: () => PostCache }): {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
} {
  return {
    async fetch(request, _env, _ctx) {
      const url = new URL(request.url);
      if (url.pathname === "/") return convert(url);
      if (url.pathname.startsWith("/media/")) return mediaRedirect(url, deps);
      return shareRedirect(url, request.headers.get("User-Agent"), deps);
    },
  };
}

export default createWorker({ cache: () => caches.default }) satisfies ExportedHandler<Env>;
