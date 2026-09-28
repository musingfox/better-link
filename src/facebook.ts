import { FACEBOOK_HOSTS } from "./expand";

const POST_PATH = /^\/[^/]+\/posts\/[^/]+\/?$/;
const STORY_PATHS = new Set(["/permalink.php", "/story.php"]);
const PHOTO_PATHS = new Set(["/photo.php", "/photo", "/photo/"]);

function nonEmpty(url: URL, name: string): boolean {
  const value = url.searchParams.get(name);
  return value !== null && value !== "";
}

export function isFacebookPostUrl(url: URL): boolean {
  if (!FACEBOOK_HOSTS.has(url.hostname)) return false;
  if (POST_PATH.test(url.pathname)) return true;
  if (STORY_PATHS.has(url.pathname)) return nonEmpty(url, "story_fbid") && nonEmpty(url, "id");
  if (PHOTO_PATHS.has(url.pathname)) return nonEmpty(url, "fbid");
  return false;
}
