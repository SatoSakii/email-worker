import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
	...nextVitals,
	...nextTs,
	{
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
	globalIgnores(["**/.next/**", "**/out/**", "**/build/**", "**/node_modules/**", "next-env.d.ts"]),
]);

export default eslintConfig;
