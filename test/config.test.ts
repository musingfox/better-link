import { expect, test } from "bun:test";

const STORAGE_BINDING = /kv_namespaces|r2_buckets|d1_databases|durable_objects|queues/;

test("wrangler config names a main module and declares no storage binding", async () => {
  const text = await Bun.file(new URL("../wrangler.jsonc", import.meta.url)).text();
  expect(text).toContain('"main"');
  expect(text.match(STORAGE_BINDING)).toBeNull();
});

test("the storage-binding pattern matches a known-bad sample", () => {
  const sample = '{"kv_namespaces":[{"binding":"CACHE","id":"x"}]}';
  expect(sample.match(STORAGE_BINDING)).not.toBeNull();
});
