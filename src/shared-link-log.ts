const SHARED_LINK_TTL_SECONDS = 7_776_000;
const METADATA_LIMIT_BYTES = 1_024;

type SharedLinkStore = {
  put(key: string, value: string, options: { expirationTtl: number; metadata: object }): Promise<void>;
};

function metadataFor(url: string, at: string, raw: boolean): object {
  const base = raw ? { at, raw: true } : { at };
  const full = { url, ...base };
  const size = new TextEncoder().encode(JSON.stringify(full)).byteLength;
  return size <= METADATA_LIMIT_BYTES ? full : base;
}

export function logSharedLink(env: Env, ctx: ExecutionContext, url: string, raw: boolean): void {
  const store = (env as { SHARED_LINKS?: SharedLinkStore }).SHARED_LINKS;
  if (store === undefined) return;
  const at = new Date().toISOString();
  const metadata = metadataFor(url, at, raw);
  const write = async () => {
    try {
      await store.put(`${at}-${crypto.randomUUID()}`, url, { expirationTtl: SHARED_LINK_TTL_SECONDS, metadata });
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
