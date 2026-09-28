import type { PostCache } from "../../src/instagram";

export function fakeCache(): {
  cache: PostCache;
  entries: Map<string, Response>;
  calls: { match: number; put: number };
} {
  const entries = new Map<string, Response>();
  const calls = { match: 0, put: 0 };
  const cache: PostCache = {
    match(key) {
      calls.match += 1;
      return Promise.resolve(entries.get(key)?.clone());
    },
    put(key, response) {
      calls.put += 1;
      entries.set(key, response);
      return Promise.resolve();
    },
  };
  return { cache, entries, calls };
}
