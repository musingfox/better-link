const DESCRIPTION_LIMIT = 250;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncateDescription(description: string): string {
  const points = Array.from(description);
  if (points.length <= DESCRIPTION_LIMIT) return description;
  return points.slice(0, DESCRIPTION_LIMIT).join("") + "...";
}

type PageMedia =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string; width: number; height: number };

type OgPageMeta = {
  title: string;
  description: string;
  url: string;
  article?: { heading: string; media: PageMedia[] };
} & (
  | { image: string }
  | { video: { url: string; width: number; height: number } }
  | { media: PageMedia }
);

function pageMedia(meta: OgPageMeta): PageMedia {
  if ("media" in meta) return meta.media;
  if ("video" in meta) return { kind: "video", ...meta.video };
  return { kind: "image", url: meta.image };
}

function mediaTag(media: PageMedia): string {
  const src = escapeHtml(media.url);
  if (media.kind === "image") return `<img src="${src}">`;
  return `<video src="${src}" width="${media.width}" height="${media.height}"></video>`;
}

// Telegram Instant View builds its page from this body; the template is in
// docs/telegram-instant-view.iv and turns div.carousel into a slideshow.
function renderArticle(article: { heading: string; media: PageMedia[] }, caption: string): string {
  const paragraphs = caption
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`);
  const tags = article.media.map(mediaTag);
  const media =
    tags.length === 1 ? [`<figure>${tags[0]}</figure>`] : ['<div class="carousel">', ...tags, "</div>"];
  return ["<article>", `<h1>${escapeHtml(article.heading)}</h1>`, ...paragraphs, ...media, "</article>", ""].join(
    "\n",
  );
}

export function renderOgPage(meta: OgPageMeta): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(truncateDescription(meta.description));
  const url = escapeHtml(meta.url);
  const media = pageMedia(meta);
  const ogMedia =
    media.kind === "video"
      ? `<meta property="og:video" content="${escapeHtml(media.url)}">
<meta property="og:video:secure_url" content="${escapeHtml(media.url)}">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="${escapeHtml(String(media.width))}">
<meta property="og:video:height" content="${escapeHtml(String(media.height))}">`
      : `<meta property="og:image" content="${escapeHtml(media.url)}">`;
  const twitterMedia =
    media.kind === "video"
      ? `<meta name="twitter:player:width" content="${escapeHtml(String(media.width))}">
<meta name="twitter:player:height" content="${escapeHtml(String(media.height))}">
<meta name="twitter:player:stream" content="${escapeHtml(media.url)}">
<meta name="twitter:player:stream:content_type" content="video/mp4">`
      : `<meta name="twitter:image" content="${escapeHtml(media.url)}">`;
  const card = media.kind === "video" ? "player" : "summary_large_image";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
${ogMedia}
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="${card}">
<meta name="twitter:title" content="${title}">
${twitterMedia}
</head>
<body>
${meta.article ? renderArticle(meta.article, meta.description) : ""}<a href="${url}">${url}</a>
</body>
</html>
`;
}
