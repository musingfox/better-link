import { expect, test } from "bun:test";
import type { WorkerConfig } from "cf/config";
import config from "../cloudflare.config";

const STORAGE_BINDING = /"type":"(kv|r2|d1|durable-object|queue)"/;

test("cf config names an entrypoint and declares no storage binding", () => {
  expect(config.worker.entrypoint).toBe("src/index.ts");
  expect(JSON.stringify(config).match(STORAGE_BINDING)).toBeNull();
});

test("the storage-binding pattern matches a known-bad sample", () => {
  const sample = { worker: { env: { CACHE: { type: "kv" } }, exports: { Room: { type: "durable-object" } } } };
  expect(JSON.stringify(sample).match(STORAGE_BINDING)).not.toBeNull();
});

test("cf config records every request in Workers Logs", () => {
  const observability: WorkerConfig["observability"] = config.worker.observability;
  expect(observability?.enabled).toBe(true);
  expect(observability?.headSamplingRate ?? 1).toBe(1);
  expect(observability?.logs?.headSamplingRate ?? 1).toBe(1);
});

test("bun.lock stays at lockfile version 1 so Workers Builds' default Bun can install it", async () => {
  // Bun 1.2.15, the Workers Builds default, rejects lockfileVersion 2 under --frozen-lockfile.
  const text = await Bun.file(new URL("../bun.lock", import.meta.url)).text();
  expect(text).toMatch(/"lockfileVersion": 1,/);
});
