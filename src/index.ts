import { cleanUrl, INSTAGRAM_HOSTS } from "./clean";
import { isCrawler } from "./crawler";
import { FACEBOOK_HOSTS, expandShareLink, isShareable } from "./expand";
import { facebookPost, facebookVideo, isFacebookPostUrl, isFacebookVideoUrl } from "./facebook";
import { fixServiceUrl } from "./fix-services";
import { instagramPost, isShortcode, shortcodeOfMediaId, type Post, type PostCache } from "./instagram";
import { renderOgPage } from "./og";
import { logSharedLink } from "./shared-link-log";
import { hasSharedLinkLog, sharedLinkLogPage } from "./shared-link-log-page";

const CONVERT_HINT = "pass a percent-encoded http(s) URL as ?url=";
const POST_PATH = /^\/(p|reel)\/([^/]+)(?:\/([1-9]\d?))?\/?$/;
const ITEM_SUFFIX = /^\/(p|reel)\/([^/]+)\/([1-9]\d?)\/?$/;
const STORY_PATH = /^\/stories\/([^/]+)\/([^/]+)\/?$/;

function instagramShortcode(pathname: string): { shortcode: string; index: number } | null {
  const post = POST_PATH.exec(pathname);
  if (post?.[2] !== undefined && isShortcode(post[2])) {
    return { shortcode: post[2], index: post[3] === undefined ? 1 : Number(post[3]) };
  }
  const story = STORY_PATH.exec(pathname);
  // A highlight id names a collection, not a media, so it has no embed page.
  if (story?.[1] === undefined || story[1] === "highlights" || story[2] === undefined) return null;
  const shortcode = shortcodeOfMediaId(story[2]);
  return shortcode === null ? null : { shortcode, index: 1 };
}

function landingUrl(cleaned: URL): URL {
  if (!INSTAGRAM_HOSTS.has(cleaned.hostname)) return cleaned;
  const match = ITEM_SUFFIX.exec(cleaned.pathname);
  if (match?.[1] === undefined || match[2] === undefined) return cleaned;
  const landing = new URL(cleaned.href);
  landing.pathname = `/${match[1]}/${match[2]}/`;
  return landing;
}
const MEDIA_PATH = /^\/media\/([^/]+)\/([1-9]\d?)$/;

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function convert(requestUrl: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
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
  const rawMode = requestUrl.searchParams.get("raw") === "1";
  const prefix = rawMode ? "https://" : `${requestUrl.origin}/`;
  const link = `${cleaned.host}${cleaned.pathname}${cleaned.search}`;
  logSharedLink(env, ctx, `https://${link}`, rawMode);
  return text(200, `${prefix}${link}`);
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

async function loadFacebookPost(
  canonical: URL,
  origin: string,
  deps: { cache: () => PostCache },
): Promise<Post | null> {
  try {
    const cache = deps.cache();
    const load = isFacebookVideoUrl(canonical) ? facebookVideo : facebookPost;
    return await load(canonical, { origin, cache });
  } catch {
    return null;
  }
}

async function facebookOg(
  requestUrl: URL,
  cleaned: URL,
  deps: { cache: () => PostCache },
): Promise<Response> {
  const post = await loadFacebookPost(cleaned, requestUrl.origin, deps);
  const item = post?.media[0];
  if (!post || item === undefined) return Response.redirect(cleaned.href, 302);
  const mediaUrl = `${requestUrl.origin}/media/${cleaned.hostname}${cleaned.pathname}${cleaned.search}`;
  const page = renderOgPage({
    title: post.username,
    description: post.caption,
    url: cleaned.href,
    media: { ...item, url: mediaUrl },
  });
  return new Response(page, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function instagramOg(
  requestUrl: URL,
  landing: URL,
  shortcode: string,
  index: number,
  deps: { cache: () => PostCache },
): Promise<Response> {
  const post = await loadPost(shortcode, requestUrl.origin, deps);
  const item = post?.media[index - 1];
  if (!post || item === undefined) return Response.redirect(landing.href, 302);
  const mediaUrl = `${requestUrl.origin}/media/${shortcode}/${index}`;
  const title =
    post.media.length > 1 ? `@${post.username} (${index}/${post.media.length})` : `@${post.username}`;
  const page = renderOgPage({
    title,
    description: post.caption,
    url: landing.href,
    media: { ...item, url: mediaUrl },
  });
  return new Response(page, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
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
  const instagram = INSTAGRAM_HOSTS.has(cleaned.hostname) ? instagramShortcode(cleaned.pathname) : null;
  if (isCrawler(userAgent) && instagram !== null) {
    return instagramOg(requestUrl, landing, instagram.shortcode, instagram.index, deps);
  }
  if (isCrawler(userAgent) && (isFacebookPostUrl(cleaned) || isFacebookVideoUrl(cleaned))) {
    return facebookOg(requestUrl, cleaned, deps);
  }
  const fixed = isCrawler(userAgent) ? fixServiceUrl(cleaned) : null;
  return Response.redirect((fixed ?? landing).href, 302);
}

const FACEBOOK_MEDIA = /^\/media\/([^/]+)(\/.*)$/;

async function mediaRedirect(
  requestUrl: URL,
  deps: { cache: () => PostCache },
): Promise<Response> {
  const facebook = FACEBOOK_MEDIA.exec(requestUrl.pathname);
  if (facebook?.[1] !== undefined && facebook[2] !== undefined && FACEBOOK_HOSTS.has(facebook[1])) {
    const host = facebook[1];
    let canonical: URL;
    try {
      canonical = new URL(`https://${host}${facebook[2]}${requestUrl.search}`);
    } catch {
      return text(404, "not found");
    }
    if (canonical.hostname !== host || !(isFacebookPostUrl(canonical) || isFacebookVideoUrl(canonical))) {
      return text(404, "not found");
    }
    const post = await loadFacebookPost(canonical, requestUrl.origin, deps);
    const item = post?.media[0];
    if (!post || item === undefined) return text(404, "not found");
    return new Response(null, {
      status: 302,
      headers: { Location: item.url, "Cache-Control": "no-store" },
    });
  }
  const match = MEDIA_PATH.exec(requestUrl.pathname);
  if (match?.[1] === undefined || match[2] === undefined || !isShortcode(match[1])) {
    return text(404, "not found");
  }
  const post = await loadPost(match[1], requestUrl.origin, deps);
  const item = post?.media[Number(match[2]) - 1];
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
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === "/") return convert(url, env, ctx);
      if (url.pathname.startsWith("/media/")) return mediaRedirect(url, deps);
      if (url.pathname === "/log" && hasSharedLinkLog(env)) return sharedLinkLogPage(url, env, ctx);
      return shareRedirect(url, request.headers.get("User-Agent"), deps);
    },
  };
}

export default createWorker({ cache: () => caches.default }) satisfies ExportedHandler<Env>;
