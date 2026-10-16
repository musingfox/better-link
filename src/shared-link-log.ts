export const SHARED_LINK_TTL_SECONDS = 7_776_000;

type SharedLinkStore = {
  put(key: string, value: string, options: { expirationTtl: number; metadata: object }): Promise<void>;
};

export function logSharedLink(env: Env, ctx: ExecutionContext, cleaned: URL, raw: boolean): void {
  const store = (env as { SHARED_LINKS?: SharedLinkStore }).SHARED_LINKS;
  if (store === undefined) return;
  const at = new Date().toISOString();
  const url = `https://${cleaned.host}${cleaned.pathname}${cleaned.search}`;
  const metadata = raw ? { url, at, raw: true } : { url, at };
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
