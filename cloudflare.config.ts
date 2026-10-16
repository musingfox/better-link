import { bindings, defineConfig } from "cf/config";

const buildEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

export default defineConfig({
	worker: {
		name: "better-link",
		compatibilityDate: "2026-09-25",
		entrypoint: "src/index.ts",
		observability: {
			enabled: true,
		},
		...(buildEnv?.LOG_SHARED_LINKS === "1" ? { env: { SHARED_LINKS: bindings.kv() } } : {}),
	},
});
