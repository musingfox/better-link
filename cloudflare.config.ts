import { defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "better-link",
		compatibilityDate: "2026-09-25",
		entrypoint: "src/index.ts",
		observability: {
			enabled: true,
		},
	},
});
