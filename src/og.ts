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

export function renderOgPage(meta: {
  title: string;
  description: string;
  image: string;
  url: string;
}): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(truncateDescription(meta.description));
  const image = escapeHtml(meta.image);
  const url = escapeHtml(meta.url);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:image" content="${image}">
<meta http-equiv="refresh" content="0; url=${url}">
</head>
<body>
<a href="${url}">${url}</a>
</body>
</html>
`;
}
