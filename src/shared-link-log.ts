import type { Summary } from "./summary";

const SHARED_LINK_TTL_SECONDS = 7_776_000;
const METADATA_LIMIT_BYTES = 1_024;
const LATEST_MS = 9_999_999_999_999;
// Below the 30 s waitUntil limit, so a stuck upstream still leaves time to write the record.
const SUMMARY_TIMEOUT_MS = 10_000;

type SharedLinkStore = {
  put(key: string, value: string, options: { expirationTtl: number; metadata: object }): Promise<void>;
};

function sizeOf(value: object): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

// Adds the longest prefix of value that keeps the metadata within its limit.
function withPrefix(base: object, key: string, value: string): object {
  if (value === "") return base;
  if (sizeOf({ ...base, [key]: value }) <= METADATA_LIMIT_BYTES) return { ...base, [key]: value };
  // A code point takes at least one byte, so no more than the limit can fit.
  const chars = Array.from(value).slice(0, METADATA_LIMIT_BYTES);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (sizeOf({ ...base, [key]: chars.slice(0, mid).join("") }) <= METADATA_LIMIT_BYTES) low = mid;
    else high = mid - 1;
  }
  return low === 0 ? base : { ...base, [key]: chars.slice(0, low).join("") };
}

function metadataFor(url: string, at: string, raw: boolean, summary: Summary | null): object {
  const base = raw ? { at, raw: true } : { at };
  const full = { url, ...base };
  // Without the URL the page cannot show the record, so a summary would only make search match an empty row.
  if (sizeOf(full) > METADATA_LIMIT_BYTES) return base;
  if (summary === null) return full;
  return withPrefix(withPrefix(full, "author", summary.author), "text", summary.text);
}

async function summaryWithin(summarize: () => Promise<Summary | null>): Promise<Summary | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SUMMARY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([Promise.resolve().then(summarize).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function logSharedLink(
  env: Env,
  ctx: ExecutionContext,
  url: string,
  raw: boolean,
  summarize: () => Promise<Summary | null> = () => Promise.resolve(null),
): void {
  const store = (env as { SHARED_LINKS?: SharedLinkStore }).SHARED_LINKS;
  if (store === undefined) return;
  const now = Date.now();
  const at = new Date(now).toISOString();
  // KV lists keys in ascending byte order, so an inverted time lists the newest first.
  const newestFirst = String(LATEST_MS - now).padStart(13, "0");
  const write = async () => {
    try {
      const metadata = metadataFor(url, at, raw, await summaryWithin(summarize));
      await store.put(`${newestFirst}-${crypto.randomUUID()}`, url, { expirationTtl: SHARED_LINK_TTL_SECONDS, metadata });
    } catch {
      // Logging must never change the conversion response.
    }
  };
  try {
    ctx.waitUntil(write());
  } catch {
    // Same reason as above: a failing waitUntil is not the caller's problem.
  }
}
