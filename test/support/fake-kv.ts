export type KvPut = {
  key: string;
  value: string;
  options: { expirationTtl: number; metadata: Record<string, unknown> };
};

// An expired key still counts toward a list page but is not returned, as KV does with expired keys.
export type KvKey = { name: string; metadata?: Record<string, unknown>; expired?: boolean };

export type KvListOptions = { prefix?: string; limit?: number; cursor?: string };

export type KvMode = "ok" | "throw" | "reject" | "hang";

export function fakeKv(
  mode: KvMode = "ok",
  keys: KvKey[] = [],
): {
  binding: {
    put(key: string, value: string, options: KvPut["options"]): Promise<void>;
    list(options: KvListOptions): Promise<{ keys: KvKey[]; list_complete: boolean; cursor?: string }>;
  };
  puts: KvPut[];
  lists: KvListOptions[];
} {
  const puts: KvPut[] = [];
  const lists: KvListOptions[] = [];
  const binding = {
    put(key: string, value: string, options: KvPut["options"]): Promise<void> {
      puts.push({ key, value, options });
      if (mode === "throw") throw new Error("boom s3cret");
      if (mode === "reject") return Promise.reject(new Error("boom s3cret"));
      if (mode === "hang") return new Promise<void>(() => {});
      return Promise.resolve();
    },
    list(options: KvListOptions): Promise<{ keys: KvKey[]; list_complete: boolean; cursor?: string }> {
      lists.push(options);
      if (mode === "throw") throw new Error("boom s3cret");
      if (mode === "reject") return Promise.reject(new Error("boom s3cret"));
      if (mode === "hang") return new Promise(() => {});
      const matched = keys
        .filter((key) => key.name.startsWith(options.prefix ?? ""))
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      const start = options.cursor === undefined ? 0 : Number(options.cursor);
      const end = start + (options.limit ?? 1_000);
      const page = matched.slice(start, end).filter((key) => key.expired !== true);
      return Promise.resolve(
        // A cursor even on the last page makes tests prove that only list_complete ends paging.
        { keys: page, list_complete: end >= matched.length, cursor: String(end) },
      );
    },
  };
  return { binding, puts, lists };
}
