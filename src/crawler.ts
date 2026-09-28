const CRAWLER_TOKENS = [
  "bot",
  "facebook",
  "embed",
  "got",
  "firefox/92",
  "firefox/38",
  "curl",
  "wget",
  "go-http",
  "yahoo",
  "generator",
  "whatsapp",
  "preview",
  "link",
  "proxy",
  "vkshare",
  "images",
  "analyzer",
  "index",
  "crawl",
  "spider",
  "python",
  "cfnetwork",
  "node",
  "mastodon",
  "http.rb",
  "discord",
  "ruby",
  "bun/",
  "fiddler",
  "revoltchat",
] as const;

export function isCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return CRAWLER_TOKENS.some((token) => ua.includes(token));
}
