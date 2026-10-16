export type KvPut = {
  key: string;
  value: string;
  options: { expirationTtl: number; metadata: Record<string, unknown> };
};

export type KvMode = "ok" | "throw" | "reject" | "hang";

export function fakeKv(mode: KvMode = "ok"): {
  binding: { put(key: string, value: string, options: KvPut["options"]): Promise<void> };
  puts: KvPut[];
} {
  const puts: KvPut[] = [];
  const binding = {
    put(key: string, value: string, options: KvPut["options"]): Promise<void> {
      puts.push({ key, value, options });
      if (mode === "throw") throw new Error("boom s3cret");
      if (mode === "reject") return Promise.reject(new Error("boom s3cret"));
      if (mode === "hang") return new Promise<void>(() => {});
      return Promise.resolve();
    },
  };
  return { binding, puts };
}
