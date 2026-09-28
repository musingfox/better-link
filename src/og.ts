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
  const description = escapeHtml(truncateDescription(meta.description));
  return `<meta property="og:description" content="${description}">`;
}
