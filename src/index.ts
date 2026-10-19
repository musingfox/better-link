import { cleanUrl, INSTAGRAM_HOSTS } from "./clean";
import { isCrawler } from "./crawler";
import { FACEBOOK_HOSTS, expandShareLink, isShareable } from "./expand";
import { facebookPost, facebookVideo, isFacebookPostUrl, isFacebookVideoUrl } from "./facebook";
import { fixServiceUrl } from "./fix-services";
import { instagramPost, instagramShortcode, isShortcode, type Post, type PostCache } from "./instagram";
import { renderOgPage } from "./og";
import { logSharedLink } from "./shared-link-log";
import { hasSharedLinkLog, sharedLinkLogPage } from "./shared-link-log-page";
import { summarize } from "./summary";

const CONVERT_HINT = "pass a percent-encoded http(s) URL as ?url=";
const IV_HINT = "pass the hex rhash of your Telegram Instant View template as &iv=";
const RHASH = /^[0-9a-f]+$/i;
const ITEM_SUFFIX = /^\/(p|reel)\/([^/]+)\/([1-9]\d?)\/?$/;

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

async function convert(
  requestUrl: URL,
  env: Env,
  ctx: ExecutionContext,
  deps: { cache: () => PostCache },
): Promise<Response> {
  const raw = requestUrl.searchParams.get("url");
  if (raw === null || raw === "") return text(400, CONVERT_HINT);
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return text(400, CONVERT_HINT);
  }
  if (!isShareable(target)) return text(400, CONVERT_HINT);
  const rawMode = requestUrl.searchParams.get("raw") === "1";
  const rhash = rawMode ? "" : (requestUrl.searchParams.get("iv") ?? "");
  if (rhash !== "" && !RHASH.test(rhash)) return text(400, IV_HINT);
  const cleaned = cleanUrl((await expandShareLink(target)) ?? target);
  const prefix = rawMode ? "https://" : `${requestUrl.origin}/`;
  const link = `${cleaned.host}${cleaned.pathname}${cleaned.search}`;
  logSharedLink(env, ctx, `https://${link}`, rawMode, () =>
    summarize(new URL(`https://${link}`), { origin: requestUrl.origin, cache: deps.cache() }),
  );
  const shareLink = `${prefix}${link}`;
  // Only pages the Worker renders itself carry the article an Instant View template reads;
  // a fix service's page would not match it.
  if (rhash === "" || ownPreview(cleaned) === null) return text(200, shareLink);
  return text(200, `https://t.me/iv?url=${encodeURIComponent(shareLink)}&rhash=${rhash}`);
}

type OwnPreview = { platform: "instagram"; shortcode: string; index: number } | { platform: "facebook" };

function ownPreview(cleaned: URL): OwnPreview | null {
  if (INSTAGRAM_HOSTS.has(cleaned.hostname)) {
    const instagram = instagramShortcode(cleaned.pathname);
    return instagram === null ? null : { platform: "instagram", ...instagram };
  }
  if (isFacebookPostUrl(cleaned) || isFacebookVideoUrl(cleaned)) return { platform: "facebook" };
  return null;
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
  const media = { ...item, url: mediaUrl };
  const page = renderOgPage({
    title: post.username,
    description: post.caption,
    url: cleaned.href,
    media,
    article: { heading: post.username, media: [media] },
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
    article: {
      heading: `@${post.username}`,
      media: post.media.map((each, i) => ({ ...each, url: `${requestUrl.origin}/media/${shortcode}/${i + 1}` })),
    },
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
  const own = ownPreview(cleaned);
  if (isCrawler(userAgent) && own?.platform === "instagram") {
    return instagramOg(requestUrl, landing, own.shortcode, own.index, deps);
  }
  if (isCrawler(userAgent) && own?.platform === "facebook") {
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
      if (url.pathname === "/") return convert(url, env, ctx, deps);
      if (url.pathname.startsWith("/media/")) return mediaRedirect(url, deps);
      if (url.pathname === "/log" && hasSharedLinkLog(env)) return sharedLinkLogPage(url, env, ctx);
      return shareRedirect(url, request.headers.get("User-Agent"), deps);
    },
  };
}

export default createWorker({ cache: () => caches.default }) satisfies ExportedHandler<Env>;
