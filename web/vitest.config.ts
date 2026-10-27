import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": path.join(import.meta.dirname, "src"),
		},
	},
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		env: {
			WORKER_URL: "https://worker.test",
			API_TOKEN: "secret-worker-token",
			MAIL_DOMAIN: "sato-mail.xyz",
			SESSION_SECRET: "test-session-secret-0123456789abcdef",
		},
	},
});
