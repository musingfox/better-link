import { expect, test } from "bun:test";
import { bindings, exports, type WorkerConfig } from "cf/config";
import config from "../cloudflare.config";

const STORAGE_BINDING = /"type":"(kv|r2|d1|durable-object|queue)"/;

test("cf config names an entrypoint and declares no storage binding", () => {
  expect(config.worker.entrypoint).toBe("src/index.ts");
  expect(JSON.stringify(config).match(STORAGE_BINDING)).toBeNull();
});

test("the storage-binding pattern matches every storage binding cf/config can build", () => {
  const samples = [bindings.kv(), bindings.r2(), bindings.d1(), bindings.queue(), exports.durableObject({ storage: "sqlite" })];
  for (const sample of samples) {
    expect(JSON.stringify({ worker: { env: { X: sample } } }).match(STORAGE_BINDING)).not.toBeNull();
  }
});

test("cf config records every request in Workers Logs", () => {
  const observability: WorkerConfig["observability"] = config.worker.observability;
  expect(observability?.enabled).toBe(true);
  expect(observability?.headSamplingRate ?? 1).toBe(1);
  expect(observability?.logs?.headSamplingRate ?? 1).toBe(1);
});

test("no wrangler config file sits beside cloudflare.config.ts", async () => {
  for (const name of ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]) {
    expect(await Bun.file(new URL(`../${name}`, import.meta.url)).exists()).toBe(false);
  }
});

test("bun.lock stays at lockfile version 1 so Workers Builds' default Bun can install it", async () => {
  // Bun 1.2.15, the Workers Builds default, rejects lockfileVersion 2 under --frozen-lockfile.
  const text = await Bun.file(new URL("../bun.lock", import.meta.url)).text();
  expect(text).toMatch(/"lockfileVersion": 1,/);
});
