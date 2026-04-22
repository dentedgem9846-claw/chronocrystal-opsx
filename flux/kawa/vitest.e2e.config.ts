import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Task 4.4 specified 60000/120000, but real LLM responses can take 30+ seconds
		// and the live message stream + followUp flow needs headroom. 180s keeps
		// tests reliable without false timeouts during model inference.
		testTimeout: 180000,
		hookTimeout: 180000,
		globals: true,
		include: ["tests/e2e/**/*.test.ts"],
	},
});