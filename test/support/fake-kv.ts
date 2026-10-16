export type KvPut = {
  key: string;
  value: string;
  options: { expirationTtl: number; metadata: Record<string, unknown> };
};

export type KvKey = { name: string; metadata?: Record<string, unknown> };

export type KvMode = "ok" | "throw" | "reject" | "hang";

export function fakeKv(
  mode: KvMode = "ok",
  keys: KvKey[] = [],
): {
  binding: {
    put(key: string, value: string, options: KvPut["options"]): Promise<void>;
    list(options: { prefix: string }): Promise<{ keys: KvKey[]; list_complete: boolean; cursor?: string }>;
  };
  puts: KvPut[];
  lists: { prefix: string }[];
} {
  const puts: KvPut[] = [];
  const lists: { prefix: string }[] = [];
  const binding = {
    put(key: string, value: string, options: KvPut["options"]): Promise<void> {
      puts.push({ key, value, options });
      if (mode === "throw") throw new Error("boom s3cret");
      if (mode === "reject") return Promise.reject(new Error("boom s3cret"));
      if (mode === "hang") return new Promise<void>(() => {});
      return Promise.resolve();
    },
    list(options: { prefix: string }): Promise<{ keys: KvKey[]; list_complete: boolean; cursor?: string }> {
      lists.push(options);
      if (mode === "throw") throw new Error("boom s3cret");
      if (mode === "reject") return Promise.reject(new Error("boom s3cret"));
      if (mode === "hang") return new Promise(() => {});
      const matched = keys.filter((key) => key.name.startsWith(options.prefix)).sort((a, b) => (a.name < b.name ? -1 : 1));
      return Promise.resolve({ keys: matched, list_complete: true });
    },
  };
  return { binding, puts, lists };
}
