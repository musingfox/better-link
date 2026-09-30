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

test("wrangler config records every request in Workers Logs", async () => {
  const config = JSON.parse(await Bun.file(new URL("../wrangler.jsonc", import.meta.url)).text());
  expect(config.observability.enabled).toBe(true);
  expect(config.observability.head_sampling_rate ?? 1).toBe(1);
});

test("wrangler config is only wrangler.jsonc", async () => {
  expect(await Bun.file(new URL("../wrangler.toml", import.meta.url)).exists()).toBe(false);
  expect(await Bun.file(new URL("../wrangler.json", import.meta.url)).exists()).toBe(false);
});

test("bun.lock stays at lockfile version 1 so Workers Builds' default Bun can install it", async () => {
  // Bun 1.2.15, the Workers Builds default, rejects lockfileVersion 2 under --frozen-lockfile.
  const text = await Bun.file(new URL("../bun.lock", import.meta.url)).text();
  expect(text).toMatch(/"lockfileVersion": 1,/);
});
