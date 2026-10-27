import { defineConfig, globalIgnores } from "eslint/config";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

export default defineConfig([
	globalIgnores(["node_modules/**", ".wrangler/**", "dist/**", "web/**", "worker-configuration.d.ts"]),
	...tseslint.configs.recommended,
	{
		plugins: { import: importPlugin },
		settings: {
			"import/core-modules": ["cloudflare:test", "cloudflare:workers"],
		},
		rules: {
			indent: ["error", "tab"],
			quotes: ["error", "double", { avoidEscape: true }],
			semi: ["error", "always"],
			"brace-style": ["error", "allman"],
			"keyword-spacing": ["error", { after: true }],
			"semi-spacing": ["error", { before: false, after: true }],
			curly: ["error", "multi-line", "consistent"],
			"nonblock-statement-body-position": ["error", "below"],
			"import/order": [
				"error",
				{
					groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
					"newlines-between": "never",
					alphabetize: { order: "asc", caseInsensitive: true },
				},
			],
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
		},
	},
]);
